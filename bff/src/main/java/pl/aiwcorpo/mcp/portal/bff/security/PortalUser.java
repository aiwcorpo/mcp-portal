package pl.aiwcorpo.mcp.portal.bff.security;

import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

import pl.aiwcorpo.mcp.portal.bff.web.ApiException;

/**
 * The logged-in user as the BFF knows it from the OIDC login (ID token and userinfo). {@code sub} and every other
 * attribute come from the IdP; the browser never supplies them.
 *
 * @param claims all identity claims of the login, for adapters that key users by a configurable claim
 */
public record PortalUser(
        String sub,
        String username,
        String displayName,
        String email,
        Set<String> groups,
        Instant authTime,
        String acr,
        Map<String, Object> claims) {

    public static final String ADMIN_GROUP = "mcp-platform-admin";

    /** {@code GroupName} of common.schema.json (C9). */
    private static final Pattern GROUP_NAME = Pattern.compile("^mcp-[A-Za-z0-9][A-Za-z0-9._-]*$");
    private static final int GROUP_NAME_MAX = 255;

    public static PortalUser from(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof OidcUser oidc)) {
            throw ApiException.unauthenticated();
        }
        String username = oidc.getPreferredUsername() != null ? oidc.getPreferredUsername() : oidc.getSubject();
        String displayName = oidc.getFullName() != null && !oidc.getFullName().isBlank() ? oidc.getFullName() : username;
        return new PortalUser(oidc.getSubject(), username, displayName, oidc.getEmail(),
                platformGroups(oidc.getClaimAsStringList("groups")),
                oidc.getAuthenticatedAt(), oidc.getAuthenticationContextClass(), nonNull(oidc.getClaims()));
    }

    /** Only C9 names; other IdP groups are none of the portal's business and would fail the Me schema. */
    static Set<String> platformGroups(List<String> claim) {
        Set<String> groups = new LinkedHashSet<>();
        if (claim != null) {
            for (String group : claim) {
                if (group != null && group.length() <= GROUP_NAME_MAX && GROUP_NAME.matcher(group).matches()) {
                    groups.add(group);
                }
            }
        }
        return Set.copyOf(groups);
    }

    private static Map<String, Object> nonNull(Map<String, Object> claims) {
        Map<String, Object> copy = new LinkedHashMap<>();
        claims.forEach((name, value) -> {
            if (value != null) {
                copy.put(name, value);
            }
        });
        return Collections.unmodifiableMap(copy);
    }

    public boolean isAdmin() {
        return groups.contains(ADMIN_GROUP);
    }

    @Override
    public String toString() {
        return "PortalUser[sub=" + sub + ", username=" + username + "]";
    }
}
