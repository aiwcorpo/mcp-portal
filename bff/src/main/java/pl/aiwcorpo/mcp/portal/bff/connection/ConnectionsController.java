package pl.aiwcorpo.mcp.portal.bff.connection;

import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Set;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.audit.AuditLog;
import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.security.StepUpPolicy;
import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import pl.aiwcorpo.mcp.portal.bff.token.UserTokens;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerClient;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerModel;
import pl.aiwcorpo.mcp.portal.bff.upstream.UpstreamException;
import pl.aiwcorpo.mcp.portal.bff.web.ApiError;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import pl.aiwcorpo.mcp.portal.bff.web.RequestIds;
import pl.aiwcorpo.mcp.portal.bff.web.ReturnPaths;

/**
 * Connections of the current user (C12 over C4). The secret of {@code PUT .../secret} lives only in the request
 * body object of this call: it goes to the broker and is dropped with the request; it is never logged, stored in
 * the session or echoed.
 */
@RestController
class ConnectionsController {

    private static final Set<String> SYSTEMS = Set.of("jira", "confluence", "gitlab", "servicedesk", "opensearch");
    private static final Set<String> BROKER_SECRET_ERRORS = Set.of("secret_invalid", "identity_mismatch");
    private static final int MAX_SECRET_LENGTH = 4096;

    private final UserTokens tokens;
    private final BrokerClient broker;
    private final StepUpPolicy stepUp;
    private final AuditLog audit;
    private final Clock clock;

    ConnectionsController(UserTokens tokens, BrokerClient broker, StepUpPolicy stepUp, AuditLog audit, Clock clock) {
        this.tokens = tokens;
        this.broker = broker;
        this.stepUp = stepUp;
        this.audit = audit;
        this.clock = clock;
    }

    @GetMapping("/api/v1/connections")
    List<BrokerModel.Connection> list(Authentication authentication, HttpServletRequest request,
                                      HttpServletResponse response) {
        PortalUser.from(authentication);
        BearerToken token = tokens.tokenFor(UserTokens.Audience.BROKER, authentication, request, response);
        return broker.listConnections(token, RequestIds.of(request));
    }

    @PutMapping("/api/v1/connections/{system}/secret")
    ResponseEntity<Object> putSecret(@PathVariable String system, @RequestBody BrokerModel.PutSecretRequest body,
                                     Authentication authentication, HttpServletRequest request,
                                     HttpServletResponse response) {
        PortalUser user = PortalUser.from(authentication);
        requireSystem(system);
        String requestId = RequestIds.of(request);
        long started = clock.millis();
        if (!stepUp.isFresh(user)) {
            audit.connectionChange(requestId, user, system, AuditLog.Outcome.stepUpRequired(), clock.millis() - started);
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(new StepUpRequired("step_up_required", StepUpPolicy.stepUpUrl(returnPathFrom(request))));
        }
        validate(body);
        BearerToken token = tokens.tokenFor(UserTokens.Audience.BROKER, authentication, request, response);
        try {
            BrokerModel.PutSecretResponse stored = broker.putSecret(token, requestId, system, body);
            audit.connectionChange(requestId, user, system, AuditLog.Outcome.ok(), clock.millis() - started);
            return ResponseEntity.ok(stored);
        } catch (UpstreamException e) {
            if (e.status() == 422 && BROKER_SECRET_ERRORS.contains(e.error())) {
                audit.connectionChange(requestId, user, system, AuditLog.Outcome.rejected(e.error()), clock.millis() - started);
                return ResponseEntity.status(422).body(ApiError.of(e.error()));
            }
            if (e.status() == 400) {
                audit.connectionChange(requestId, user, system, AuditLog.Outcome.rejected(ApiError.INVALID_REQUEST),
                        clock.millis() - started);
                throw ApiException.badRequest();
            }
            audit.connectionChange(requestId, user, system, AuditLog.Outcome.upstreamUnavailable(), clock.millis() - started);
            throw e;
        }
    }

    @DeleteMapping("/api/v1/connections/{system}")
    ResponseEntity<Void> disconnect(@PathVariable String system, Authentication authentication,
                                    HttpServletRequest request, HttpServletResponse response) {
        PortalUser user = PortalUser.from(authentication);
        requireSystem(system);
        String requestId = RequestIds.of(request);
        long started = clock.millis();
        BearerToken token = tokens.tokenFor(UserTokens.Audience.BROKER, authentication, request, response);
        try {
            broker.deleteConnection(token, requestId, system);
        } catch (UpstreamException e) {
            audit.connectionChange(requestId, user, system, AuditLog.Outcome.upstreamUnavailable(), clock.millis() - started);
            throw e;
        }
        audit.connectionChange(requestId, user, system, AuditLog.Outcome.ok(), clock.millis() - started);
        return ResponseEntity.noContent().build();
    }

    private static void requireSystem(String system) {
        if (!SYSTEMS.contains(system)) {
            throw ApiException.badRequest();
        }
    }

    private static void validate(BrokerModel.PutSecretRequest body) {
        if (body == null || body.secret() == null || body.secret().isEmpty() || body.secret().length() > MAX_SECRET_LENGTH) {
            throw ApiException.badRequest();
        }
        if (body.expiresAt() != null) {
            try {
                if (!body.expiresAt().endsWith("Z")) {
                    throw ApiException.badRequest();
                }
                Instant.parse(body.expiresAt());
            } catch (DateTimeParseException e) {
                throw ApiException.badRequest();
            }
        }
    }

    /**
     * Where the step-up login should come back to. C12 gives {@code PUT .../secret} no return path, so the page that
     * sent the request (same-origin Referer) is used; anything else falls back to the start page.
     */
    static String returnPathFrom(HttpServletRequest request) {
        String referer = request.getHeader(HttpHeaders.REFERER);
        if (referer == null) {
            return ReturnPaths.DEFAULT;
        }
        try {
            URI uri = URI.create(referer);
            boolean sameOrigin = request.getServerName().equalsIgnoreCase(uri.getHost())
                    && request.getScheme().equalsIgnoreCase(uri.getScheme())
                    && request.getServerPort() == port(uri);
            String path = uri.getRawPath() + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
            return sameOrigin && ReturnPaths.isValid(path) ? path : ReturnPaths.DEFAULT;
        } catch (IllegalArgumentException e) {
            return ReturnPaths.DEFAULT;
        }
    }

    private static int port(URI uri) {
        if (uri.getPort() != -1) {
            return uri.getPort();
        }
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    record StepUpRequired(String error, String stepUpUrl) {
    }
}
