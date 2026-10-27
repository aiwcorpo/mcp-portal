package pl.aiwcorpo.mcp.portal.bff.security;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

import pl.aiwcorpo.mcp.portal.bff.web.ApiException;

/**
 * The logged-in user as the BFF knows it from the OIDC login. {@code sub} always comes from the IdP; the browser
 * never supplies it.
 */
public record PortalUser(
        String sub,
        String username,
        String displayName,
        Set<String> groups,
        Instant authTime,
        String acr) {

    public static final String ADMIN_GROUP = "mcp-platform-admin";
    private static final String PLATFORM_GROUP_PREFIX = "mcp-";

    public static PortalUser from(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof OidcUser oidc)) {
            throw ApiException.unauthenticated();
        }
        String username = oidc.getPreferredUsername() != null ? oidc.getPreferredUsername() : oidc.getSubject();
        String displayName = oidc.getFullName() != null && !oidc.getFullName().isBlank() ? oidc.getFullName() : username;
        return new PortalUser(oidc.getSubject(), username, displayName, platformGroups(oidc.getClaimAsStringList("groups")),
                oidc.getAuthenticatedAt(), oidc.getAuthenticationContextClass());
    }

    /** Only C9 names; other IdP groups are none of the portal's business and would fail the Me schema. */
    static Set<String> platformGroups(List<String> claim) {
        Set<String> groups = new LinkedHashSet<>();
        if (claim != null) {
            for (String group : claim) {
                if (group != null && group.startsWith(PLATFORM_GROUP_PREFIX) && group.length() > PLATFORM_GROUP_PREFIX.length()) {
                    groups.add(group);
                }
            }
        }
        return Set.copyOf(groups);
    }

    public boolean isAdmin() {
        return groups.contains(ADMIN_GROUP);
    }
}
