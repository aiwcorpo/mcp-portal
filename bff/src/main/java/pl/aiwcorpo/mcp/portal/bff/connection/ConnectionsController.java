package pl.aiwcorpo.mcp.portal.bff.connection;

import java.time.Clock;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.audit.AuditLog;
import pl.aiwcorpo.mcp.portal.bff.limits.SessionRateLimiter;
import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import pl.aiwcorpo.mcp.portal.bff.token.UserTokens;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerClient;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerData;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerModel;
import pl.aiwcorpo.mcp.portal.bff.upstream.UpstreamException;
import pl.aiwcorpo.mcp.portal.bff.web.ApiError;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import pl.aiwcorpo.mcp.portal.bff.web.RequestIds;
import pl.aiwcorpo.mcp.portal.bff.web.StrictJson;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectReader;
import tools.jackson.databind.json.JsonMapper;

/**
 * Connections of the current user (C12 over C4). The secret of {@code PUT .../secret} lives only in the request
 * body object of this call: it goes to the broker and is dropped with the request; it is never logged, stored in
 * the session or echoed. Writing a token needs a session and the CSRF header only (CC-090); the broker's validity
 * check (C4.1) is what protects the write, and its {@code secret_invalid} is passed on as a code without any
 * text of the target system. The answer carries {@code backendUser}: the portal shows which account was linked.
 */
@RestController
class ConnectionsController {

    private static final Set<String> BROKER_SECRET_ERRORS = Set.of("secret_invalid");
    private static final int MAX_SECRET_LENGTH = 4096;

    private final UserTokens tokens;
    private final BrokerClient broker;
    private final AuditLog audit;
    private static final Pattern USERNAME = Pattern.compile(
            "^[^:\\p{Cc}\\p{Cf}\\p{Cs}\\u2028\\u2029\\ufdd0-\\ufdef\\ufffe\\uffff\\u034f\\u115f\\u1160\\u3164\\uffa0\\u2800\\ufe00-\\ufe0f]+$");

    private final Clock clock;
    private final SessionRateLimiter limiter;
    private final JsonMapper secretTreeReader = StrictJson.builder().build();
    private final ObjectReader secretReader = StrictJson.builder().build()
            .readerFor(BrokerModel.PutSecretRequest.class)
            .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    ConnectionsController(UserTokens tokens, BrokerClient broker, AuditLog audit, Clock clock,
                          SessionRateLimiter limiter) {
        this.tokens = tokens;
        this.broker = broker;
        this.audit = audit;
        this.clock = clock;
        this.limiter = limiter;
    }

    @GetMapping("/api/v1/connections")
    List<BrokerModel.Connection> list(Authentication authentication, HttpServletRequest request,
                                      HttpServletResponse response) {
        PortalUser.from(authentication);
        BearerToken token = tokens.tokenFor(UserTokens.Audience.BROKER, authentication, request, response);
        return BrokerData.validConnections(broker.listConnections(token, RequestIds.of(request)));
    }

    /** The body is read here rather than bound by Spring, so that malformed requests are audited as well. */
    @PutMapping("/api/v1/connections/{system}/secret")
    ResponseEntity<Object> putSecret(@PathVariable String system, @RequestBody(required = false) byte[] rawBody,
                                     Authentication authentication, HttpServletRequest request,
                                     HttpServletResponse response) {
        PortalUser user = PortalUser.from(authentication);
        String requestId = RequestIds.of(request);
        long started = clock.millis();
        requireSystem(system, user, requestId, started);
        BrokerModel.PutSecretRequest body = parse(rawBody);
        if (body == null) {
            audit.connectionChange(requestId, user, system, AuditLog.Outcome.rejected(ApiError.INVALID_REQUEST),
                    clock.millis() - started);
            throw ApiException.badRequest();
        }
        // Each attempt is a check of the token at the target system, so the limit counts attempts that reach the broker.
        try {
            limiter.acquire(request, SessionRateLimiter.Kind.SECRET_WRITE);
        } catch (ApiException e) {
            audit.connectionChange(requestId, user, system, AuditLog.Outcome.rateLimited(), clock.millis() - started);
            throw e;
        }
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.BROKER, authentication, request, response);
            BrokerModel.PutSecretResponse stored = broker.putSecret(token, requestId, system, body);
            audit.connectionChange(requestId, user, system, stored == null ? null : stored.backendUser(),
                    AuditLog.Outcome.ok(), clock.millis() - started);
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
            AuditLog.Outcome outcome = e.status() == 422 && "system_not_configured".equals(e.error())
                    ? AuditLog.Outcome.systemNotConfigured() : AuditLog.Outcome.ofFailure(e);
            audit.connectionChange(requestId, user, system, outcome, clock.millis() - started);
            throw ApiException.limitOf(e);
        } catch (RuntimeException e) {
            // Token refresh or exchange failed: the change did not happen and that is worth an event too.
            audit.connectionChange(requestId, user, system, AuditLog.Outcome.upstreamUnavailable(), clock.millis() - started);
            throw e;
        }
    }

    @DeleteMapping("/api/v1/connections/{system}")
    ResponseEntity<Void> disconnect(@PathVariable String system, Authentication authentication,
                                    HttpServletRequest request, HttpServletResponse response) {
        PortalUser user = PortalUser.from(authentication);
        String requestId = RequestIds.of(request);
        long started = clock.millis();
        requireSystem(system, user, requestId, started);
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.BROKER, authentication, request, response);
            broker.deleteConnection(token, requestId, system);
        } catch (RuntimeException e) {
            audit.connectionChange(requestId, user, system, AuditLog.Outcome.upstreamUnavailable(), clock.millis() - started);
            throw e;
        }
        audit.connectionChange(requestId, user, system, AuditLog.Outcome.ok(), clock.millis() - started);
        return ResponseEntity.noContent().build();
    }

    private void requireSystem(String system, PortalUser user, String requestId, long started) {
        if (!BrokerData.SYSTEMS.contains(system)) {
            audit.connectionChange(requestId, user, null, AuditLog.Outcome.rejected(ApiError.INVALID_REQUEST),
                    clock.millis() - started);
            throw ApiException.badRequest();
        }
    }

    /** Strict parse of {@code PutSecretRequest}; null for anything the contract does not allow. */
    private BrokerModel.PutSecretRequest parse(byte[] rawBody) {
        if (rawBody == null || rawBody.length == 0) {
            return null;
        }
        BrokerModel.PutSecretRequest body;
        try {
            // A null login is not a missing one: the contract has no null for a string field.
            JsonNode tree = secretTreeReader.readTree(rawBody);
            if (tree != null && tree.has("username") && !tree.get("username").isString()) {
                return null;
            }
            body = secretReader.readValue(rawBody);
        } catch (JacksonException e) {
            return null;
        }
        return valid(body) ? body : null;
    }

    /**
     * {@code username} of C12 (CC-222): 1..255 characters, no ':' (RFC 7617) and the character set of {@code backendUser}
     * (CC-121), so no control, format or surrogate characters, separators or invisible fillers. Whether the system takes a
     * login at all is the broker's to say (400); the login is not logged, not audited and not returned.
     */
    private static boolean validUsername(String username) {
        return username.codePointCount(0, username.length()) <= 255 && USERNAME.matcher(username).matches();
    }

    private static boolean valid(BrokerModel.PutSecretRequest body) {
        if (body == null || body.secret() == null || body.secret().isEmpty() || body.secret().length() > MAX_SECRET_LENGTH) {
            return false;
        }
        if (body.username() != null && !validUsername(body.username())) {
            return false;
        }
        if (body.expiresAt() == null) {
            return true;
        }
        try {
            Instant.parse(body.expiresAt());
            return body.expiresAt().endsWith("Z");
        } catch (DateTimeParseException e) {
            return false;
        }
    }
}
