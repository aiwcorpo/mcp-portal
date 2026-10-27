package pl.aiwcorpo.mcp.portal.bff.me;

import java.util.List;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;

/** {@code GET /api/v1/me}: identity from the OIDC login, no token material. */
@RestController
class MeController {

    @GetMapping("/api/v1/me")
    Me me(Authentication authentication) {
        PortalUser user = PortalUser.from(authentication);
        return new Me(user.username(), user.displayName(), user.groups().stream().sorted().toList(), user.isAdmin());
    }

    record Me(String username, String displayName, List<String> groups, boolean isAdmin) {
    }
}
