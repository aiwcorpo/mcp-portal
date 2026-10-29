package pl.aiwcorpo.mcp.portal.bff.authenticator;

import java.time.Clock;
import java.util.Objects;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.audit.AuditLog;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;
import pl.aiwcorpo.mcp.portal.bff.limits.SessionRateLimiter;
import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.security.SessionAttributes;
import pl.aiwcorpo.mcp.portal.bff.security.StepUpPolicy;
import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import pl.aiwcorpo.mcp.portal.bff.token.UserTokens;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerClient;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerData;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerModel;
import pl.aiwcorpo.mcp.portal.bff.upstream.ContractValues;
import pl.aiwcorpo.mcp.portal.bff.upstream.UpstreamException;
import pl.aiwcorpo.mcp.portal.bff.web.ApiError;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import pl.aiwcorpo.mcp.portal.bff.web.RequestIds;
import pl.aiwcorpo.mcp.portal.bff.web.StrictJson;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectReader;

/**
 * Registration of the TOTP authenticator (C12 over C4, CC-093). Starting a registration and removing one need a
 * fresh MFA in the IdP (step-up); confirming the first code does not, because the pending registration was created
 * under one. The seed leaves the broker in one answer only, is handed to the browser with {@code no-store} and is
 * not kept: not in the session, not in a log line, not in an audit event. Neither is a code. The session holds the
 * {@code enrollmentId} alone, so that nobody can confirm a registration that another session started.
 */
@RestController
class AuthenticatorController {

    private static final String ENROLLMENT_INVALID = "enrollment_invalid";
    private static final String INVALID_CODE = "invalid_code";
    private static final String ALREADY_REGISTERED = "already_registered";
    private static final String RATE_LIMITED = "rate_limited";

    private final UserTokens tokens;
    private final BrokerClient broker;
    private final StepUpPolicy stepUp;
    private final AuditLog audit;
    private final Clock clock;
    private final String returnPath;
    private final SessionRateLimiter limiter;
    private final ObjectReader confirmReader = StrictJson.builder().build()
            .readerFor(BrokerModel.AuthenticatorEnrollmentConfirm.class)
            .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    AuthenticatorController(UserTokens tokens, BrokerClient broker, StepUpPolicy stepUp, AuditLog audit, Clock clock,
                            PortalProperties properties, SessionRateLimiter limiter) {
        this.limiter = limiter;
        this.tokens = tokens;
        this.broker = broker;
        this.stepUp = stepUp;
        this.audit = audit;
        this.clock = clock;
        this.returnPath = properties.stepUp().authenticatorReturnPath();
    }

    @GetMapping("/api/v1/authenticator")
    ResponseEntity<BrokerModel.AuthenticatorStatus> status(Authentication authentication, HttpServletRequest request,
                                                           HttpServletResponse response) {
        PortalUser.from(authentication);
        BearerToken token = tokens.tokenFor(UserTokens.Audience.BROKER, authentication, request, response);
        return noStore(statusOf(broker.authenticatorStatus(token, RequestIds.of(request))));
    }

    /** Idempotent; the broker also drops a pending registration and a disabled one. */
    @DeleteMapping("/api/v1/authenticator")
    ResponseEntity<Void> remove(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        PortalUser user = PortalUser.from(authentication);
        String requestId = RequestIds.of(request);
        long started = clock.millis();
        requireFreshMfa(user, requestId, started);
        limit(request, user, requestId, started);
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.BROKER, authentication, request, response);
            broker.deleteAuthenticator(token, requestId);
        } catch (RuntimeException e) {
            audit.authenticatorEvent(requestId, user, AuditLog.Outcome.ofFailure(e), clock.millis() - started);
            throw e;
        }
        forgetEnrollment(request);
        audit.authenticatorEvent(requestId, user, AuditLog.Outcome.ok("authenticator_removed"), clock.millis() - started);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/api/v1/authenticator/enrollment")
    ResponseEntity<BrokerModel.AuthenticatorEnrollment> startEnrollment(Authentication authentication,
                                                                       HttpServletRequest request,
                                                                       HttpServletResponse response) {
        PortalUser user = PortalUser.from(authentication);
        String requestId = RequestIds.of(request);
        long started = clock.millis();
        requireFreshMfa(user, requestId, started);
        limit(request, user, requestId, started);
        BrokerModel.AuthenticatorEnrollment enrollment;
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.BROKER, authentication, request, response);
            enrollment = BrokerData.validEnrollment(broker.startAuthenticatorEnrollment(token, requestId));
            if (enrollment == null) {
                throw new UpstreamException("credential broker", 502, null);
            }
        } catch (UpstreamException e) {
            if (e.status() == 409 && ALREADY_REGISTERED.equals(e.error())) {
                audit.authenticatorEvent(requestId, user, AuditLog.Outcome.denied("authenticator_enrollment_failed", null),
                        clock.millis() - started);
                throw new ApiException(HttpStatus.CONFLICT, ApiError.of(ALREADY_REGISTERED).withRequestId(requestId));
            }
            if (e.status() == 429 && RATE_LIMITED.equals(e.error())) {
                audit.authenticatorEvent(requestId, user,
                        AuditLog.Outcome.denied("authenticator_enrollment_failed", RATE_LIMITED), clock.millis() - started);
                throw ApiException.rateLimited(e.retryAfterSeconds() == null ? null : e.retryAfterSeconds().longValue());
            }
            audit.authenticatorEvent(requestId, user, AuditLog.Outcome.ofFailure(e), clock.millis() - started);
            throw e;
        } catch (RuntimeException e) {
            audit.authenticatorEvent(requestId, user, AuditLog.Outcome.ofFailure(e), clock.millis() - started);
            throw e;
        }
        request.getSession().setAttribute(SessionAttributes.AUTHENTICATOR_ENROLLMENT_ID, enrollment.enrollmentId());
        audit.authenticatorEvent(requestId, user, AuditLog.Outcome.ok("authenticator_enrollment_started"),
                clock.millis() - started);
        return ResponseEntity.status(HttpStatus.CREATED)
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header(HttpHeaders.PRAGMA, "no-cache")
                .body(enrollment);
    }

    /** The body is parsed here, not bound by Spring: a parse error must not quote the code. */
    @PostMapping("/api/v1/authenticator/enrollment/confirm")
    ResponseEntity<Object> confirmEnrollment(@RequestBody(required = false) byte[] rawBody, Authentication authentication,
                                             HttpServletRequest request, HttpServletResponse response) {
        PortalUser user = PortalUser.from(authentication);
        String requestId = RequestIds.of(request);
        long started = clock.millis();
        BrokerModel.AuthenticatorEnrollmentConfirm body = parse(rawBody);
        if (body == null) {
            throw ApiException.badRequest();
        }
        HttpSession session = request.getSession(false);
        Object pending = session == null ? null : session.getAttribute(SessionAttributes.AUTHENTICATOR_ENROLLMENT_ID);
        if (!Objects.equals(pending, body.enrollmentId())) {
            audit.authenticatorEvent(requestId, user,
                    AuditLog.Outcome.denied("authenticator_enrollment_failed", ApiError.NOT_FOUND_OR_DENIED),
                    clock.millis() - started);
            throw new ApiException(HttpStatus.NOT_FOUND, ApiError.of(ApiError.NOT_FOUND_OR_DENIED));
        }
        limit(request, user, requestId, started);
        BrokerModel.AuthenticatorStatus registered;
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.BROKER, authentication, request, response);
            registered = statusOf(broker.confirmAuthenticatorEnrollment(token, requestId, body));
        } catch (UpstreamException e) {
            if (e.status() == 422 && (INVALID_CODE.equals(e.error()) || ENROLLMENT_INVALID.equals(e.error()))) {
                if (ENROLLMENT_INVALID.equals(e.error())) {
                    forgetEnrollment(request);
                }
                audit.authenticatorEvent(requestId, user, AuditLog.Outcome.denied("authenticator_enrollment_failed", null),
                        clock.millis() - started);
                // AuthenticatorEnrollmentError is a closed schema: the code alone, the request id is in the header.
                return ResponseEntity.unprocessableEntity().body(new EnrollmentError(e.error()));
            }
            audit.authenticatorEvent(requestId, user, AuditLog.Outcome.ofFailure(e), clock.millis() - started);
            throw e;
        } catch (RuntimeException e) {
            audit.authenticatorEvent(requestId, user, AuditLog.Outcome.ofFailure(e), clock.millis() - started);
            throw e;
        }
        forgetEnrollment(request);
        audit.authenticatorEvent(requestId, user, AuditLog.Outcome.ok("authenticator_registered"), clock.millis() - started);
        return noStoreObject(registered);
    }

    record EnrollmentError(String error) {
    }

    /** The portal's limit per session; a refused request is audited and never reaches the broker. */
    private void limit(HttpServletRequest request, PortalUser user, String requestId, long started) {
        try {
            limiter.acquire(request, SessionRateLimiter.Kind.AUTHENTICATOR);
        } catch (ApiException e) {
            audit.authenticatorEvent(requestId, user, AuditLog.Outcome.denied("rate_limited", RATE_LIMITED),
                    clock.millis() - started);
            throw e;
        }
    }

    private void requireFreshMfa(PortalUser user, String requestId, long started) {
        try {
            stepUp.requireFresh(user, returnPath);
        } catch (ApiException e) {
            audit.authenticatorEvent(requestId, user, AuditLog.Outcome.stepUpRequired(), clock.millis() - started);
            throw e;
        }
    }

    private static BrokerModel.AuthenticatorStatus statusOf(BrokerModel.AuthenticatorStatus status) {
        BrokerModel.AuthenticatorStatus checked = BrokerData.validAuthenticatorStatus(status);
        if (checked == null) {
            throw new UpstreamException("credential broker", 502, null);
        }
        return checked;
    }

    private static void forgetEnrollment(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.removeAttribute(SessionAttributes.AUTHENTICATOR_ENROLLMENT_ID);
        }
    }

    private BrokerModel.AuthenticatorEnrollmentConfirm parse(byte[] rawBody) {
        if (rawBody == null || rawBody.length == 0) {
            return null;
        }
        try {
            BrokerModel.AuthenticatorEnrollmentConfirm body = confirmReader.readValue(rawBody);
            return body != null && body.enrollmentId() != null && body.code() != null
                    && ContractValues.ENROLLMENT_ID.matcher(body.enrollmentId()).matches()
                    && ContractValues.CONFIRMATION_CODE.matcher(body.code()).matches() ? body : null;
        } catch (JacksonException e) {
            return null;
        }
    }

    private static <T> ResponseEntity<T> noStore(T body) {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body(body);
    }

    private static ResponseEntity<Object> noStoreObject(Object body) {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body(body);
    }
}
