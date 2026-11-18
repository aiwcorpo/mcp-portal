package pl.aiwcorpo.mcp.portal.bff.security;

import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.Set;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.web.HttpSessionOAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;

import pl.aiwcorpo.mcp.portal.bff.web.ReturnPaths;

/**
 * Ends the OIDC login. A step-up must authenticate the same {@code sub} as the session it was started from;
 * otherwise the session is dropped. After any login the session keeps only the new security context and its
 * tokens, so nothing of an earlier login (another user, an older MFA level) carries over.
 */
class LoginSuccessHandler implements AuthenticationSuccessHandler {

    // Name used by HttpSessionOAuth2AuthorizedClientRepository (private constant there).
    private static final String AUTHORIZED_CLIENTS =
            HttpSessionOAuth2AuthorizedClientRepository.class.getName() + ".AUTHORIZED_CLIENTS";
    private static final Set<String> KEEP = Set.of(
            HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, AUTHORIZED_CLIENTS);

    private final LoginRedirects redirects;

    LoginSuccessHandler(LoginRedirects redirects) {
        this.redirects = redirects;
    }

    @Override
    public void onAuthenticationSuccess(HttpServletRequest request, HttpServletResponse response,
                                        Authentication authentication) throws IOException {
        HttpSession session = request.getSession(false);
        String target = ReturnPaths.DEFAULT;
        if (session != null) {
            if (session.getAttribute(SessionAttributes.LOGIN_RETURN_PATH) instanceof String stored
                    && ReturnPaths.isValid(stored)) {
                target = stored;
            }
            Object stepUpSub = session.getAttribute(SessionAttributes.STEP_UP_SUB);
            String sub = authentication.getPrincipal() instanceof OidcUser oidc ? oidc.getSubject() : null;
            if (stepUpSub != null && !stepUpSub.equals(sub)) {
                session.invalidate();
                SecurityContextHolder.clearContext();
                redirects.redirectToError(request, response, LoginRedirects.STEP_UP_FAILED);
                return;
            }
            // Back from the short lifetime LoginController gives a session that only started a login.
            session.setMaxInactiveInterval(request.getServletContext().getSessionTimeout() * 60);
            List<String> names = Collections.list(session.getAttributeNames());
            for (String name : names) {
                if (!KEEP.contains(name)) {
                    session.removeAttribute(name);
                }
            }
        }
        // CsrfAuthenticationStrategy replaced the token on login; render the new one into the cookie right away.
        if (request.getAttribute(CsrfToken.class.getName()) instanceof CsrfToken csrf) {
            csrf.getToken();
        }
        redirects.redirect(request, response, target);
    }
}
