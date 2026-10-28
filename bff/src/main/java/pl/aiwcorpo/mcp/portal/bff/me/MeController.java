package pl.aiwcorpo.mcp.portal.bff.me;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.security.StepUpPolicy;

/** {@code GET /api/v1/me}: identity from the OIDC login, no token material. */
@RestController
class MeController {

    private final StepUpPolicy stepUp;

    MeController(StepUpPolicy stepUp) {
        this.stepUp = stepUp;
    }

    @GetMapping("/api/v1/me")
    Me me(Authentication authentication) {
        PortalUser user = PortalUser.from(authentication);
        Instant freshUntil = stepUp.freshUntil(user);
        return new Me(user.username(), user.displayName(), user.groups().stream().sorted().toList(), user.isAdmin(),
                freshUntil == null ? null : freshUntil.truncatedTo(ChronoUnit.SECONDS).toString());
    }

    /** {@code mfaFreshUntil} is informational (CC-053): the operations that need a fresh MFA check it again. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Me(String username, String displayName, List<String> groups, boolean isAdmin, String mfaFreshUntil) {
    }
}
