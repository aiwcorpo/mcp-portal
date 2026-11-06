package pl.aiwcorpo.mcp.portal.bff.admin;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.web.ApiError;
import pl.aiwcorpo.mcp.portal.bff.web.RequestIds;

/**
 * Refuses an administration request whose declared {@code Content-Length} is above the limit before anything is read:
 * {@code 400 invalid_request} (the C12 operations list no 413, and a body that big is not a request of the contract). It
 * runs after the security filters, so an unauthenticated caller was already answered 401 and the CSRF check is done; a
 * caller without the administrator group is left to the controller, which answers 403 without reading the body. A body that
 * declares no length (chunked) is cut while it is read, in {@link AdminBody}.
 */
@Component
@Order(-50)
class AdminBodyLimitFilter extends OncePerRequestFilter {

    private static final String PREFIX = "/api/v1/admin/";

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith(PREFIX) || request.getContentLengthLong() <= AdminBody.MAX_BYTES;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!administrator()) {
            chain.doFilter(request, response);
            return;
        }
        response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        // The body is not read, so the connection cannot be reused for the next request.
        response.setHeader("Connection", "close");
        response.getWriter().write("{\"error\":\"" + ApiError.INVALID_REQUEST + "\",\"requestId\":\""
                + RequestIds.of(request) + "\"}");
    }

    private static boolean administrator() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null && authentication.getPrincipal() instanceof OidcUser
                && PortalUser.from(authentication).isAdmin();
    }
}
