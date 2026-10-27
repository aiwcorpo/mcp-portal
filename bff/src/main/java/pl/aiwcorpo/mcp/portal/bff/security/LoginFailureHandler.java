package pl.aiwcorpo.mcp.portal.bff.security;

import java.io.IOException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;

/** Failed OIDC login: back to the start page with a code from the closed list, never the IdP's own text. */
class LoginFailureHandler implements AuthenticationFailureHandler {

    private final LoginRedirects redirects;

    LoginFailureHandler(LoginRedirects redirects) {
        this.redirects = redirects;
    }

    @Override
    public void onAuthenticationFailure(HttpServletRequest request, HttpServletResponse response,
                                        AuthenticationException exception) throws IOException {
        redirects.redirectToError(request, response, code(exception));
    }

    static String code(AuthenticationException exception) {
        if (exception instanceof OAuth2AuthenticationException oauth) {
            return switch (oauth.getError().getErrorCode()) {
                case "access_denied" -> LoginRedirects.CANCELLED;
                // The authorization request (state, nonce, PKCE) is gone with the session or was never ours.
                case "authorization_request_not_found" -> LoginRedirects.SESSION_EXPIRED;
                default -> LoginRedirects.IDP_ERROR;
            };
        }
        return LoginRedirects.IDP_ERROR;
    }
}
