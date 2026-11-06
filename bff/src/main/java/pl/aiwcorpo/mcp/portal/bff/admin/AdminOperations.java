package pl.aiwcorpo.mcp.portal.bff.admin;

import java.time.Clock;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.function.UnaryOperator;

import com.fasterxml.jackson.annotation.JsonInclude;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;

import pl.aiwcorpo.mcp.portal.bff.audit.AuditLog;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;
import pl.aiwcorpo.mcp.portal.bff.config.PublicUrls;
import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.security.StepUpPolicy;
import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import pl.aiwcorpo.mcp.portal.bff.token.UserTokens;
import pl.aiwcorpo.mcp.portal.bff.upstream.AdminPreconditions;
import pl.aiwcorpo.mcp.portal.bff.upstream.AdminReply;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerClient;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayAdminClient;
import pl.aiwcorpo.mcp.portal.bff.upstream.TextHygiene;
import pl.aiwcorpo.mcp.portal.bff.upstream.UpstreamException;
import pl.aiwcorpo.mcp.portal.bff.web.ApiError;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import pl.aiwcorpo.mcp.portal.bff.web.RequestIds;
import pl.aiwcorpo.mcp.portal.bff.web.ReturnPaths;
import tools.jackson.databind.JsonNode;

/**
 * The one path every administration mirror of C12 takes (servers, scope mapping, overrides, policy approval, broker
 * systems): the group {@code mcp-platform-admin} of the session, the fresh MFA where the contract asks for it, the call
 * with the exchanged token and the preconditions of the browser, the check of the answer and the mapping of the
 * upstream's refusals to the C12 answers. The gateway and the broker check the group and the freshness of the MFA again
 * on the token; an upstream {@code 401 step_up_required} therefore becomes the portal's own, pointing at the same login,
 * instead of a generic failure.
 */
@Component
class AdminOperations {

    enum Upstream { GATEWAY, BROKER }

    /**
     * One call.
     *
     * @param rejection   the {@code error} of the upstream's 422 that C12 passes on (for example {@code server_rejected})
     * @param conflict    the {@code error} of its 409 that C12 passes on, or null when the operation has none
     * @param stepUp      the operation needs a fresh MFA of the administrator
     * @param sameOrigin  the call must come from the portal page itself (it widens access for everyone)
     * @param view        the check of the answer (null: no body expected)
     * @param audit       what an audit event of a refused attempt says about an emergency override (null for other calls)
     */
    record Op(Upstream upstream, HttpMethod method, String uri, Object[] variables, JsonNode body,
              AdminPreconditions preconditions, boolean stepUp, boolean sameOrigin, UnaryOperator<JsonNode> view,
              String rejection, String conflict, AuditRef audit) {

        Op(Upstream upstream, HttpMethod method, String uri, Object[] variables, JsonNode body,
           AdminPreconditions preconditions, boolean stepUp, boolean sameOrigin, UnaryOperator<JsonNode> view,
           String rejection, String conflict) {
            this(upstream, method, uri, variables, body, preconditions, stepUp, sameOrigin, view, rejection, conflict, null);
        }

        static Op read(Upstream upstream, String uri, UnaryOperator<JsonNode> view, Object... variables) {
            return new Op(upstream, HttpMethod.GET, uri, variables, null, AdminPreconditions.NONE, false, false, view,
                    null, null);
        }
    }

    /** The override an attempt is about, as far as it is known: the id of the path, then the target and hash of the text. */
    record AuditRef(String overrideId, String overrideTarget, String textSha256) {
    }

    private final UserTokens tokens;
    private final GatewayAdminClient gateway;
    private final BrokerClient broker;
    private final AuditLog audit;
    private final Clock clock;
    private final StepUpPolicy stepUp;
    private final PublicUrls publicUrls;
    private final String returnPath;

    AdminOperations(UserTokens tokens, GatewayAdminClient gateway, BrokerClient broker, AuditLog audit, Clock clock,
                    StepUpPolicy stepUp, PublicUrls publicUrls, PortalProperties properties) {
        this.tokens = tokens;
        this.gateway = gateway;
        this.broker = broker;
        this.audit = audit;
        this.clock = clock;
        this.stepUp = stepUp;
        this.publicUrls = publicUrls;
        this.returnPath = properties.stepUp().adminReturnPath();
    }

    /**
     * Runs a read: the group of the session, then the call. A refusal is not audited (nothing changes), as for the
     * registry views.
     */
    ResponseEntity<Object> read(Authentication authentication, HttpServletRequest request, HttpServletResponse response,
                                Supplier<Op> prepare) {
        AdminTargets.requireAdmin(authentication);
        Op op = prepare.get();
        try {
            return execute(op, authentication, request, response);
        } catch (UpstreamException e) {
            throw refusal(e, op, request);
        }
    }

    /**
     * Runs a write. {@code serverId} is the server the call names (null when none, or not a valid id); the attempts that
     * end without a change are audited with it.
     */
    ResponseEntity<Object> write(String serverId, Authentication authentication, HttpServletRequest request,
                                 HttpServletResponse response, Supplier<Op> prepare) {
        return write(serverId, null, authentication, request, response, prepare);
    }

    /** As above for the operations on an emergency override: {@code overrideId} is the id of the path when it is a valid one. */
    ResponseEntity<Object> write(String serverId, String overrideId, Authentication authentication,
                                 HttpServletRequest request, HttpServletResponse response, Supplier<Op> prepare) {
        PortalUser user = PortalUser.from(authentication);
        String requestId = RequestIds.of(request);
        long started = clock.millis();
        AuditRef[] ref = {new AuditRef(overrideId, null, null)};
        Consumer<AuditLog.Outcome> refused = outcome -> audit.adminChangeFailed(requestId, user, serverId,
                ref[0].overrideId(), ref[0].overrideTarget(), ref[0].textSha256(), outcome, clock.millis() - started);
        if (!user.isAdmin()) {
            refused.accept(AuditLog.Outcome.notAdmin());
            throw AdminTargets.forbidden();
        }
        Op op;
        try {
            op = prepare.get();
        } catch (ApiException e) {
            refused.accept(outcomeOf(e));
            throw e;
        }
        if (op.audit() != null) {
            ref[0] = op.audit();
        }
        if (op.sameOrigin() && !"same-origin".equals(request.getHeader("Sec-Fetch-Site"))) {
            refused.accept(AuditLog.Outcome.accessDenied());
            throw new ApiException(HttpStatus.FORBIDDEN, ApiError.of(ApiError.CSRF_INVALID));
        }
        if (op.stepUp()) {
            try {
                stepUp.requireFresh(user, ReturnPaths.pageOf(request, publicUrls, returnPath));
            } catch (ApiException e) {
                refused.accept(AuditLog.Outcome.stepUpRequired());
                throw e;
            }
        }
        try {
            return execute(op, authentication, request, response);
        } catch (UpstreamException e) {
            RuntimeException mapped = refusal(e, op, request);
            refused.accept(mapped instanceof ApiException api ? outcomeOf(api, e) : AuditLog.Outcome.ofFailure(e));
            throw mapped;
        } catch (RuntimeException e) {
            refused.accept(AuditLog.Outcome.upstreamUnavailable());
            throw e;
        }
    }

    private ResponseEntity<Object> execute(Op op, Authentication authentication, HttpServletRequest request,
                                           HttpServletResponse response) {
        String requestId = RequestIds.of(request);
        AdminReply reply = switch (op.upstream()) {
            case GATEWAY -> gateway.admin(op.method(), op.uri(), op.variables(),
                    tokens.adminTokenFor(UserTokens.Audience.GATEWAY_ADMIN, authentication, request, response), requestId,
                    op.preconditions(), op.body());
            case BROKER -> broker.admin(op.method(), op.uri(), op.variables(),
                    tokens.adminTokenFor(UserTokens.Audience.BROKER, authentication, request, response), requestId,
                    op.preconditions(), op.body());
        };
        JsonNode shown = null;
        if (op.view() != null) {
            shown = reply.body() == null ? null : op.view().apply(reply.body());
            if (shown == null) {
                throw new UpstreamException(op.upstream() == Upstream.GATEWAY ? "gateway admin" : "credential broker", 502, null);
            }
        }
        ResponseEntity.BodyBuilder answer = ResponseEntity.status(op.view() == null ? HttpStatus.NO_CONTENT
                : HttpStatus.valueOf(reply.status()));
        if (reply.etag() != null) {
            answer.header(HttpHeaders.ETAG, reply.etag());
        }
        return shown == null ? answer.build() : answer.contentType(MediaType.APPLICATION_JSON).body(shown);
    }

    /**
     * What C12 says for a refusal of the upstream; anything it does not list stays an {@link UpstreamException} (503).
     * An unusable token (401) that is not a missing step-up is the portal's problem, not the administrator's.
     */
    private RuntimeException refusal(UpstreamException e, Op op, HttpServletRequest request) {
        switch (e.status()) {
            case 400:
                return ApiException.badRequest();
            case 401:
                if ("step_up_required".equals(e.error())) {
                    return stepUp.required(ReturnPaths.pageOf(request, publicUrls, returnPath));
                }
                return e;
            case 403:
                return AdminTargets.forbidden();
            case 404:
                return AdminTargets.notFound();
            case 409:
                if (op.conflict() != null && op.conflict().equals(e.error())) {
                    return new ApiException(HttpStatus.CONFLICT, ApiError.of(op.conflict()));
                }
                return e;
            case 412:
                return new ApiException(HttpStatus.PRECONDITION_FAILED, ApiError.of("precondition_failed"));
            case 422:
                if (op.rejection() != null && op.rejection().equals(e.error())) {
                    return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, rejected(e));
                }
                return e;
            case 428:
                return new ApiException(HttpStatus.PRECONDITION_REQUIRED, ApiError.of("precondition_required"));
            default:
                return e;
        }
    }

    private static Rejected rejected(UpstreamException e) {
        String message = e.upstreamMessage() == null ? null
                : TextHygiene.cutAtNotation(TextHygiene.neutralize(e.upstreamMessage()), 500);
        return new Rejected(e.error(), e.reason(), message);
    }

    private static AuditLog.Outcome outcomeOf(ApiException e) {
        return outcomeOf(e, null);
    }

    private static AuditLog.Outcome outcomeOf(ApiException e, UpstreamException cause) {
        return switch (e.status()) {
            case BAD_REQUEST -> AuditLog.Outcome.rejected(ApiError.INVALID_REQUEST);
            case FORBIDDEN -> AuditLog.Outcome.accessDenied();
            case NOT_FOUND -> AuditLog.Outcome.notFoundOrDenied();
            case UNAUTHORIZED -> AuditLog.Outcome.stepUpRequired();
            case CONFLICT -> AuditLog.Outcome.rejected(((ApiError) e.body()).error());
            case PRECONDITION_FAILED -> AuditLog.Outcome.rejected("precondition_failed");
            case PRECONDITION_REQUIRED -> AuditLog.Outcome.rejected("precondition_required");
            case UNPROCESSABLE_ENTITY -> AuditLog.Outcome.rejected(cause != null && cause.reason() != null
                    ? cause.reason() : ((Rejected) e.body()).error());
            default -> AuditLog.Outcome.upstreamUnavailable();
        };
    }

    /**
     * {@code If-Match} of an operation that needs it: missing is {@code 428}, malformed is {@code 400} (CC-243: input that
     * is not shaped right is never a 404 or a 412; {@code 412} is a well-formed tag that is no longer current).
     */
    static AdminPreconditions ifMatchRequired(HttpServletRequest request) {
        String ifMatch = request.getHeader(HttpHeaders.IF_MATCH);
        if (ifMatch == null) {
            throw new ApiException(HttpStatus.PRECONDITION_REQUIRED, ApiError.of("precondition_required"));
        }
        if (!AdminInput.wellFormedEtag(ifMatch)) {
            throw ApiException.badRequest();
        }
        return new AdminPreconditions(ifMatch, false);
    }

    /** A create sends {@code If-None-Match: *}, a replace {@code If-Match}; both or neither is refused. */
    static AdminPreconditions createOrReplace(HttpServletRequest request) {
        String ifMatch = request.getHeader(HttpHeaders.IF_MATCH);
        String ifNoneMatch = request.getHeader(HttpHeaders.IF_NONE_MATCH);
        if (ifMatch == null && ifNoneMatch == null) {
            throw new ApiException(HttpStatus.PRECONDITION_REQUIRED, ApiError.of("precondition_required"));
        }
        if (ifMatch != null && ifNoneMatch != null || ifMatch != null && !AdminInput.wellFormedEtag(ifMatch)
                || ifNoneMatch != null && !"*".equals(ifNoneMatch)) {
            throw ApiException.badRequest();
        }
        return new AdminPreconditions(ifMatch, ifNoneMatch != null);
    }

    /** {@code If-Match} when the browser sent one (a change that may go without), malformed is {@code 400}. */
    static AdminPreconditions ifMatchOptional(HttpServletRequest request) {
        String ifMatch = request.getHeader(HttpHeaders.IF_MATCH);
        if (ifMatch != null && !AdminInput.wellFormedEtag(ifMatch)) {
            throw ApiException.badRequest();
        }
        return new AdminPreconditions(ifMatch, false);
    }

    /** {@code 422} body of C12: the code, the machine reason when the upstream gave a well-formed one, the safe message. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Rejected(String error, String reason, String message) {
    }
}
