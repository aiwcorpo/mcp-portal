package pl.aiwcorpo.mcp.portal.bff.admin;

import java.time.Clock;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.audit.AuditLog;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;
import pl.aiwcorpo.mcp.portal.bff.config.PublicUrls;
import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.security.StepUpPolicy;
import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import pl.aiwcorpo.mcp.portal.bff.token.UserTokens;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayAdminClient;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel;
import pl.aiwcorpo.mcp.portal.bff.upstream.RegistryData;
import pl.aiwcorpo.mcp.portal.bff.upstream.TextHygiene;
import pl.aiwcorpo.mcp.portal.bff.upstream.UpstreamException;
import pl.aiwcorpo.mcp.portal.bff.web.ApiError;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import pl.aiwcorpo.mcp.portal.bff.web.RequestIds;
import pl.aiwcorpo.mcp.portal.bff.web.ReturnPaths;
import pl.aiwcorpo.mcp.portal.bff.web.StrictJson;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectReader;

/**
 * Registry administration (C12 over C5, CC-097, CC-133, CC-162): the registered servers, the approved and pending
 * definition of one tool for a diff, and the approval of a pending definition. The portal checks the group
 * {@code mcp-platform-admin} of the session before it calls the gateway, and the gateway checks it again on the exchanged
 * token. What the gateway returns is checked against C5 and every text of a definition is neutralized before it
 * reaches the browser ({@link RegistryData}). An entry that comes from an adapter is approved together with its
 * classification (risk and action, CC-193), which the gateway checks (CC-207).
 */
@RestController
class RegistryAdminController {

    private static final String MANIFEST_REJECTED = "manifest_rejected";
    private static final String HASH_MISMATCH = "hash_mismatch";

    private final UserTokens tokens;
    private final GatewayAdminClient gateway;
    private final AuditLog audit;
    private final Clock clock;
    private final StepUpPolicy stepUp;
    private final String returnPath;
    private final PublicUrls publicUrls;
    private final ObjectReader approveReader = StrictJson.builder().build()
            .readerFor(ApproveBody.class)
            .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    RegistryAdminController(UserTokens tokens, GatewayAdminClient gateway, AuditLog audit, Clock clock,
                            StepUpPolicy stepUp, PortalProperties properties, PublicUrls publicUrls) {
        this.stepUp = stepUp;
        this.publicUrls = publicUrls;
        this.returnPath = properties.stepUp().adminReturnPath();
        this.tokens = tokens;
        this.gateway = gateway;
        this.audit = audit;
        this.clock = clock;
    }

    @GetMapping("/api/v1/admin/registry")
    List<JsonNode> registry(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        AdminTargets.requireAdmin(authentication);
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.GATEWAY_ADMIN, authentication, request, response);
            List<JsonNode> servers = RegistryData.validRegistry(gateway.registry(token, RequestIds.of(request)));
            if (servers == null) {
                throw new UpstreamException("gateway admin", 502, null);
            }
            return servers;
        } catch (UpstreamException e) {
            throw viewFailure(e);
        }
    }

    @GetMapping("/api/v1/admin/registry/servers/{serverId}/tools/{tool}/pending")
    JsonNode pending(@PathVariable String serverId, @PathVariable String tool, Authentication authentication,
                     HttpServletRequest request, HttpServletResponse response) {
        AdminTargets.requireAdmin(authentication);
        AdminTargets.requireTarget(serverId, tool);
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.GATEWAY_ADMIN, authentication, request, response);
            JsonNode pending = RegistryData.validPending(gateway.pendingTool(token, RequestIds.of(request), serverId, tool), tool);
            if (pending == null) {
                throw new UpstreamException("gateway admin", 502, null);
            }
            return pending;
        } catch (UpstreamException e) {
            throw viewFailure(e);
        }
    }

    /** The body is parsed here, so that the attempt is audited whatever is wrong with it. */
    @PostMapping("/api/v1/admin/registry/servers/{serverId}/tools/{tool}/approve")
    ResponseEntity<Object> approve(@PathVariable String serverId, @PathVariable String tool,
                                   @RequestBody(required = false) byte[] rawBody, Authentication authentication,
                                   HttpServletRequest request, HttpServletResponse response) {
        PortalUser user = PortalUser.from(authentication);
        String requestId = RequestIds.of(request);
        long started = clock.millis();
        String target = AdminTargets.SERVER_IDS.contains(serverId) ? serverId : null;
        if (!user.isAdmin()) {
            audit.definitionApprovalFailed(requestId, user, target, AdminTargets.validTool(tool), null, AuditLog.Outcome.accessDenied(),
                    clock.millis() - started);
            throw AdminTargets.forbidden();
        }
        // Approval unblocks a changed definition for everyone, so it must come from the portal page itself (as `viewed`).
        if (!"same-origin".equals(request.getHeader("Sec-Fetch-Site"))) {
            audit.definitionApprovalFailed(requestId, user, target, AdminTargets.validTool(tool), null, AuditLog.Outcome.accessDenied(),
                    clock.millis() - started);
            throw new ApiException(HttpStatus.FORBIDDEN, ApiError.of(ApiError.CSRF_INVALID));
        }
        if (target == null || AdminTargets.validTool(tool).isEmpty()) {
            audit.definitionApprovalFailed(requestId, user, target, AdminTargets.validTool(tool), null, AuditLog.Outcome.notFoundOrDenied(),
                    clock.millis() - started);
            throw AdminTargets.notFound();
        }
        ApproveBody body = parse(rawBody);
        if (body == null) {
            audit.definitionApprovalFailed(requestId, user, target, tool, null, AuditLog.Outcome.rejected(ApiError.INVALID_REQUEST),
                    clock.millis() - started);
            throw ApiException.badRequest();
        }
        String hash = body.definitionHash();
        boolean lowering = Boolean.TRUE.equals(body.acceptRiskLowering());
        // Whether the pair fits the entry (only an adapter entry takes one) and each other is the gateway's to say (422).
        if (!RegistryData.validClassification(body.risk(), body.action())) {
            audit.definitionApprovalFailed(requestId, user, target, tool, hash, AuditLog.Outcome.rejected(ApiError.INVALID_REQUEST),
                    clock.millis() - started);
            throw ApiException.badRequest();
        }
        if (lowering) {
            // The only way to lower a risk (CC-167): the administrator has to prove a fresh second factor first.
            try {
                stepUp.requireFresh(user, ReturnPaths.pageOf(request, publicUrls, returnPath));
            } catch (ApiException e) {
                audit.definitionApprovalFailed(requestId, user, serverId, tool, hash, AuditLog.Outcome.stepUpRequired(),
                        clock.millis() - started);
                throw e;
            }
        }
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.GATEWAY_ADMIN, authentication, request, response);
            gateway.approveTool(token, requestId, serverId, tool,
                    new GatewayModel.ApproveRequest(hash, lowering ? Boolean.TRUE : null, body.risk(), body.action()));
        } catch (UpstreamException e) {
            return approvalFailure(e, user, requestId, serverId, tool, hash, started);
        } catch (RuntimeException e) {
            audit.definitionApprovalFailed(requestId, user, serverId, tool, hash, AuditLog.Outcome.upstreamUnavailable(),
                    clock.millis() - started);
            throw e;
        }
        // The gateway records the approval (admin_change, definition_approved, sub of the administrator); the portal
        // records only attempts that did not end in one, so a count of approvals is not doubled.
        return ResponseEntity.noContent().build();
    }

    private ResponseEntity<Object> approvalFailure(UpstreamException e, PortalUser user, String requestId, String serverId,
                                                   String tool, String hash, long started) {
        long latency = clock.millis() - started;
        switch (e.status()) {
            case 403 -> {
                audit.definitionApprovalFailed(requestId, user, serverId, tool, hash, AuditLog.Outcome.accessDenied(), latency);
                throw AdminTargets.forbidden();
            }
            case 404 -> {
                audit.definitionApprovalFailed(requestId, user, serverId, tool, hash, AuditLog.Outcome.notFoundOrDenied(), latency);
                throw AdminTargets.notFound();
            }
            case 409 -> {
                if (HASH_MISMATCH.equals(e.error())) {
                    audit.definitionApprovalFailed(requestId, user, serverId, tool, hash, AuditLog.Outcome.rejected(HASH_MISMATCH), latency);
                    throw new ApiException(HttpStatus.CONFLICT, ApiError.of(HASH_MISMATCH));
                }
            }
            case 422 -> {
                if (MANIFEST_REJECTED.equals(e.error())) {
                    audit.definitionApprovalFailed(requestId, user, serverId, tool, hash,
                            AuditLog.Outcome.rejected(e.reason() == null ? MANIFEST_REJECTED : e.reason()), latency);
                    throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, rejected(e));
                }
            }
            default -> {
            }
        }
        audit.definitionApprovalFailed(requestId, user, serverId, tool, hash, AuditLog.Outcome.upstreamUnavailable(), latency);
        throw e;
    }

    /** {@code ManifestRejected}: the code, the machine reason when the gateway gave a well-formed one, the message as safe text. */
    private static ManifestRejected rejected(UpstreamException e) {
        String message = e.upstreamMessage() == null ? null
                : TextHygiene.cutAtNotation(TextHygiene.neutralize(e.upstreamMessage()), 500);
        return new ManifestRejected(MANIFEST_REJECTED, e.reason(), message);
    }

    /** A view that the gateway refuses is shown as the contract says; everything else is an unavailable upstream. */
    private static RuntimeException viewFailure(UpstreamException e) {
        return switch (e.status()) {
            case 403 -> AdminTargets.forbidden();
            case 404 -> AdminTargets.notFound();
            default -> e;
        };
    }

    private ApproveBody parse(byte[] rawBody) {
        if (rawBody == null || rawBody.length == 0) {
            return null;
        }
        try {
            ApproveBody body = approveReader.readValue(rawBody);
            return body != null && body.definitionHash() != null
                    && RegistryData.DEFINITION_HASH.matcher(body.definitionHash()).matches() ? body : null;
        } catch (JacksonException e) {
            return null;
        }
    }

    /**
     * {@code acceptRiskLowering} false, null or absent is a plain approval. {@code risk} and {@code action} are the
     * classification of an adapter tool (CC-193), sent to the gateway only when the administrator gave them.
     */
    record ApproveBody(String definitionHash, Boolean acceptRiskLowering, String risk, String action) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record ManifestRejected(String error, String reason, String message) {
    }
}
