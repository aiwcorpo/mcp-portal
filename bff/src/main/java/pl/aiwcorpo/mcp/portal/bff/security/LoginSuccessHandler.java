package pl.aiwcorpo.mcp.portal.bff.security;

import java.io.IOException;
import java.net.URI;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;

import org.springframework.security.core.Authentication;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;

import pl.aiwcorpo.mcp.portal.bff.web.ReturnPaths;

/** Ends the OIDC login with a redirect to the return path stored by {@code GET /api/v1/auth/login}. */
class LoginSuccessHandler implements AuthenticationSuccessHandler {

    private final String returnOrigin;

    /** @param returnOrigin configured frontend origin for dev, or null to stay on the BFF origin */
    LoginSuccessHandler(URI returnOrigin) {
        this.returnOrigin = origin(returnOrigin);
    }

    private static String origin(URI uri) {
        if (uri == null || uri.toString().isEmpty()) {
            return null;
        }
        boolean plainOrigin = ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                && uri.getHost() != null && (uri.getRawPath() == null || uri.getRawPath().isEmpty())
                && uri.getRawQuery() == null && uri.getRawFragment() == null && uri.getRawUserInfo() == null;
        if (!plainOrigin) {
            throw new IllegalStateException("portal.web.login-return-origin must be scheme://host[:port]");
        }
        return uri.toString();
    }

    @Override
    public void onAuthenticationSuccess(HttpServletRequest request, HttpServletResponse response,
                                        Authentication authentication) throws IOException {
        String target = ReturnPaths.DEFAULT;
        HttpSession session = request.getSession(false);
        if (session != null) {
            if (session.getAttribute(SessionAttributes.LOGIN_RETURN_PATH) instanceof String stored
                    && ReturnPaths.isValid(stored)) {
                target = stored;
            }
            session.removeAttribute(SessionAttributes.LOGIN_RETURN_PATH);
            // A new login may be another user or a new MFA level; tokens exchanged for the previous one must go.
            session.removeAttribute(SessionAttributes.EXCHANGED_TOKENS);
        }
        response.sendRedirect(returnOrigin != null ? returnOrigin + target : request.getContextPath() + target);
    }
}
