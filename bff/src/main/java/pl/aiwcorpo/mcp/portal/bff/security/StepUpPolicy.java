package pl.aiwcorpo.mcp.portal.bff.security;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import pl.aiwcorpo.mcp.portal.bff.config.DevMode;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import pl.aiwcorpo.mcp.portal.bff.web.ReturnPaths;

/** Decides whether the session's last interactive authentication is fresh enough for sensitive operations. */
@Component
public class StepUpPolicy {

    private final Duration maxAge;
    private final List<String> acrValues;
    private final Clock clock;

    public StepUpPolicy(PortalProperties properties, DevMode devMode, Clock clock) {
        this.maxAge = properties.stepUp().maxAge();
        this.acrValues = properties.stepUp().acrValues().stream().filter(value -> !value.isBlank()).toList();
        this.clock = clock;
        // Without acr levels a "step-up" is only a repeated password; acceptable against the dev realm only.
        devMode.require(acrValues.isEmpty(), "Step-up without portal.step-up.acr-values");
    }

    public boolean isFresh(PortalUser user) {
        return freshUntil(user) != null;
    }

    /** End of the freshness of the last interactive authentication, or null when it is not fresh now. */
    public Instant freshUntil(PortalUser user) {
        Instant authTime = user.authTime();
        if (authTime == null) {
            return null;
        }
        Instant now = clock.instant();
        if (authTime.isAfter(now.plusSeconds(30)) || Duration.between(authTime, now).compareTo(maxAge) > 0) {
            return null;
        }
        if (!acrValues.isEmpty() && (user.acr() == null || !acrValues.contains(user.acr()))) {
            return null;
        }
        return authTime.plus(maxAge);
    }

    /**
     * Passes when the session's login is a fresh MFA; otherwise ends the call with {@code 401 step_up_required}
     * pointing at the login that comes back to {@code returnPath} (C12 {@code StepUpRequired}, CC-048).
     */
    public void requireFresh(PortalUser user, String returnPath) {
        if (!isFresh(user)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, new StepUpRequired(stepUpUrl(returnPath)));
        }
    }

    /** Body of {@code 401 step_up_required}; no {@code requestId} field, the schema is closed. */
    public record StepUpRequired(String error, String stepUpUrl) {

        StepUpRequired(String stepUpUrl) {
            this("step_up_required", stepUpUrl);
        }
    }

    /** Space-separated acr_values for the step-up authorization request; null when none are configured. */
    public String acrValuesParameter() {
        return acrValues.isEmpty() ? null : String.join(" ", acrValues);
    }

    /** {@code stepUpUrl} of C12: the BFF login with {@code stepUp=true} and the page to come back to. */
    public static String stepUpUrl(String returnPath) {
        String target = ReturnPaths.isValid(returnPath) ? returnPath : ReturnPaths.DEFAULT;
        return "/api/v1/auth/login?stepUp=true&returnPath=" + encodeQueryValue(target);
    }

    // A valid return path has no '%', so only the characters that would end or alter the query value need encoding;
    // '+' is encoded because servlet containers decode it to a space.
    private static String encodeQueryValue(String value) {
        return value.replace("&", "%26").replace("=", "%3D").replace("+", "%2B");
    }
}
