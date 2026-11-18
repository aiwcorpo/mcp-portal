package pl.aiwcorpo.mcp.portal.bff.security;

import java.io.IOException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;

import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.web.AuthorizationRequestRepository;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import pl.aiwcorpo.mcp.portal.bff.web.ReturnPaths;

/** {@code GET /api/v1/auth/login} (C12, CC-023): one redirect straight to the IdP authorization endpoint. */
@RestController
class LoginController {

    private final SecurityConfig.LoginResolvers resolvers;
    private final AuthorizationRequestRepository<OAuth2AuthorizationRequest> authorizationRequests;
    private final String registrationId;
    private final int loginTimeoutSeconds;

    LoginController(SecurityConfig.LoginResolvers resolvers,
                    AuthorizationRequestRepository<OAuth2AuthorizationRequest> authorizationRequests,
                    PortalProperties properties) {
        this.resolvers = resolvers;
        this.authorizationRequests = authorizationRequests;
        this.registrationId = properties.registrationId();
        this.loginTimeoutSeconds = Math.toIntExact(properties.session().loginTimeout().toSeconds());
    }

    @GetMapping("/api/v1/auth/login")
    void login(@RequestParam(required = false) String returnPath,
               @RequestParam(defaultValue = "false") boolean stepUp,
               Authentication authentication,
               HttpServletRequest request, HttpServletResponse response) throws IOException {
        String target = returnPath == null ? ReturnPaths.DEFAULT : returnPath;
        if (!ReturnPaths.isValid(target)) {
            throw ApiException.badRequest();
        }
        boolean administrator = stepUp && authentication != null && authentication.getPrincipal() instanceof OidcUser
                && PortalUser.from(authentication).isAdmin();
        OAuth2AuthorizationRequest authorization = (administrator ? resolvers.stepUpAdmin()
                : stepUp ? resolvers.stepUp() : resolvers.standard()).resolve(request, registrationId);
        if (authorization == null) {
            throw new IllegalStateException("Unknown client registration " + registrationId);
        }
        HttpSession session = request.getSession(true);
        if (authentication == null || !(authentication.getPrincipal() instanceof OidcUser)) {
            // Anyone can start a login; until it completes the session must not live as long as a signed-in one.
            session.setMaxInactiveInterval(loginTimeoutSeconds);
        }
        session.setAttribute(SessionAttributes.LOGIN_RETURN_PATH, target);
        if (stepUp && authentication != null && authentication.getPrincipal() instanceof OidcUser current) {
            session.setAttribute(SessionAttributes.STEP_UP_SUB, current.getSubject());
        } else {
            session.removeAttribute(SessionAttributes.STEP_UP_SUB);
        }
        authorizationRequests.saveAuthorizationRequest(authorization, request, response);
        response.sendRedirect(authorization.getAuthorizationRequestUri());
    }
}
