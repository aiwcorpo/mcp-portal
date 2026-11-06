package pl.aiwcorpo.mcp.portal.bff.admin;

import java.time.Clock;
import java.util.function.Consumer;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.audit.AuditLog;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;
import pl.aiwcorpo.mcp.portal.bff.config.PublicUrls;
import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.security.StepUpPolicy;
import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import pl.aiwcorpo.mcp.portal.bff.token.UserTokens;
import pl.aiwcorpo.mcp.portal.bff.upstream.ContractValues;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayAdminClient;
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
 * Emergency switch of a server or one tool (A9, CC-194; C12 over C5). Switching off is open to every administrator
 * without a second factor, because an incident must not wait for one; lifting the switch needs a fresh MFA, like the
 * approval that lowers a risk. The portal checks the group {@code mcp-platform-admin} of the session before it calls
 * the gateway, which checks it again on the exchanged token and records {@code kill_switch_set} and
 * {@code kill_switch_cleared}; the portal records only the attempts that changed nothing.
 */
@RestController
class KillSwitchController {

    private final UserTokens tokens;
    private final GatewayAdminClient gateway;
    private final AuditLog audit;
    private final Clock clock;
    private final StepUpPolicy stepUp;
    private final PublicUrls publicUrls;
    private final String returnPath;
    private final ObjectReader requestReader = StrictJson.builder().build()
            .readerFor(SwitchRequest.class)
            .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    KillSwitchController(UserTokens tokens, GatewayAdminClient gateway, AuditLog audit, Clock clock, StepUpPolicy stepUp,
                         PortalProperties properties, PublicUrls publicUrls) {
        this.tokens = tokens;
        this.gateway = gateway;
        this.audit = audit;
        this.clock = clock;
        this.stepUp = stepUp;
        this.publicUrls = publicUrls;
        this.returnPath = properties.stepUp().adminReturnPath();
    }

    @GetMapping("/api/v1/admin/kill-switches")
    JsonNode list(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        AdminTargets.requireAdmin(authentication);
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.GATEWAY_ADMIN, authentication, request, response);
            JsonNode switches = RegistryData.validKillSwitches(gateway.killSwitches(token, RequestIds.of(request)));
            if (switches == null) {
                throw new UpstreamException("gateway admin", 502, null);
            }
            return switches;
        } catch (UpstreamException e) {
            throw viewFailure(e);
        }
    }

    @PutMapping("/api/v1/admin/registry/servers/{serverId}/kill-switch")
    ResponseEntity<Void> switchOffServer(@PathVariable String serverId,
                                         Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        return change(serverId, null, false, authentication, request, response);
    }

    @DeleteMapping("/api/v1/admin/registry/servers/{serverId}/kill-switch")
    ResponseEntity<Void> switchOnServer(@PathVariable String serverId, Authentication authentication,
                                        HttpServletRequest request, HttpServletResponse response) {
        return change(serverId, null, true, authentication, request, response);
    }

    @PutMapping("/api/v1/admin/registry/servers/{serverId}/tools/{tool}/kill-switch")
    ResponseEntity<Void> switchOffTool(@PathVariable String serverId, @PathVariable String tool,
                                       Authentication authentication,
                                       HttpServletRequest request, HttpServletResponse response) {
        return change(serverId, tool, false, authentication, request, response);
    }

    @DeleteMapping("/api/v1/admin/registry/servers/{serverId}/tools/{tool}/kill-switch")
    ResponseEntity<Void> switchOnTool(@PathVariable String serverId, @PathVariable String tool, Authentication authentication,
                                      HttpServletRequest request, HttpServletResponse response) {
        return change(serverId, tool, true, authentication, request, response);
    }

    /** {@code tool} is null for the switch of a whole server; {@code lift} is the DELETE, which needs the fresh MFA. */
    private ResponseEntity<Void> change(String serverId, String tool, boolean lift,
                                        Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        PortalUser user = PortalUser.from(authentication);
        String requestId = RequestIds.of(request);
        long started = clock.millis();
        String target = ContractValues.isServerId(serverId) ? serverId : null;
        String toolName = tool == null ? null : AdminTargets.validTool(tool);
        Consumer<AuditLog.Outcome> refused = outcome ->
                audit.killSwitchFailed(requestId, user, target, toolName, outcome, clock.millis() - started);
        if (!user.isAdmin()) {
            refused.accept(AuditLog.Outcome.accessDenied());
            throw AdminTargets.forbidden();
        }
        // Lifting a switch gives the tool back to everyone, so it must come from the portal page itself, like an approval.
        if (lift && !"same-origin".equals(request.getHeader("Sec-Fetch-Site"))) {
            refused.accept(AuditLog.Outcome.accessDenied());
            throw new ApiException(HttpStatus.FORBIDDEN, ApiError.of(ApiError.CSRF_INVALID));
        }
        if (target == null || tool != null && toolName.isEmpty()) {
            refused.accept(AuditLog.Outcome.notFoundOrDenied());
            throw AdminTargets.notFound();
        }
        String reason = null;
        if (!lift) {
            reason = reasonOf(AdminBody.read(request));
            if (reason == null) {
                refused.accept(AuditLog.Outcome.rejected("invalid_request"));
                throw ApiException.badRequest();
            }
        } else {
            try {
                stepUp.requireFresh(user, ReturnPaths.pageOf(request, publicUrls, returnPath));
            } catch (ApiException e) {
                refused.accept(AuditLog.Outcome.stepUpRequired());
                throw e;
            }
        }
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.GATEWAY_ADMIN, authentication, request, response);
            send(token, requestId, serverId, toolName, reason, lift);
        } catch (UpstreamException e) {
            refused.accept(outcomeOf(e));
            throw switch (e.status()) {
                case 400 -> ApiException.badRequest();
                case 403 -> AdminTargets.forbidden();
                case 404 -> AdminTargets.notFound();
                default -> e;
            };
        } catch (RuntimeException e) {
            refused.accept(AuditLog.Outcome.upstreamUnavailable());
            throw e;
        }
        return ResponseEntity.noContent().build();
    }

    private void send(BearerToken token, String requestId, String serverId, String tool, String reason, boolean lift) {
        if (tool == null && lift) {
            gateway.switchOnServer(token, requestId, serverId);
        } else if (tool == null) {
            gateway.switchOffServer(token, requestId, serverId, reason);
        } else if (lift) {
            gateway.switchOnTool(token, requestId, serverId, tool);
        } else {
            gateway.switchOffTool(token, requestId, serverId, tool, reason);
        }
    }

    private static AuditLog.Outcome outcomeOf(UpstreamException e) {
        return switch (e.status()) {
            case 400 -> AuditLog.Outcome.rejected("invalid_request");
            case 403 -> AuditLog.Outcome.accessDenied();
            case 404 -> AuditLog.Outcome.notFoundOrDenied();
            default -> AuditLog.Outcome.upstreamUnavailable();
        };
    }

    /** The text of the administrator, or null when the body is not {@code KillSwitchRequest} (1..200 characters, no hidden ones). */
    private String reasonOf(byte[] rawBody) {
        if (rawBody == null || rawBody.length == 0) {
            return null;
        }
        try {
            SwitchRequest body = requestReader.readValue(rawBody);
            String reason = body == null ? null : body.reason();
            return reason != null && !reason.isEmpty() && reason.length() <= 200 && TextHygiene.isClean(reason, false)
                    ? reason : null;
        } catch (JacksonException e) {
            return null;
        }
    }

    private static RuntimeException viewFailure(UpstreamException e) {
        return switch (e.status()) {
            case 403 -> AdminTargets.forbidden();
            default -> e;
        };
    }

    record SwitchRequest(String reason) {
    }
}
