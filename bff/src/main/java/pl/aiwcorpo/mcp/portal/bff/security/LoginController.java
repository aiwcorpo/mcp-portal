package pl.aiwcorpo.mcp.portal.bff.security;

import java.io.IOException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.security.oauth2.client.web.AuthorizationRequestRepository;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
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

    LoginController(SecurityConfig.LoginResolvers resolvers,
                    AuthorizationRequestRepository<OAuth2AuthorizationRequest> authorizationRequests,
                    PortalProperties properties) {
        this.resolvers = resolvers;
        this.authorizationRequests = authorizationRequests;
        this.registrationId = properties.registrationId();
    }

    @GetMapping("/api/v1/auth/login")
    void login(@RequestParam(required = false) String returnPath,
               @RequestParam(defaultValue = "false") boolean stepUp,
               HttpServletRequest request, HttpServletResponse response) throws IOException {
        String target = returnPath == null ? ReturnPaths.DEFAULT : returnPath;
        if (!ReturnPaths.isValid(target)) {
            throw ApiException.badRequest();
        }
        OAuth2AuthorizationRequest authorization = (stepUp ? resolvers.stepUp() : resolvers.standard())
                .resolve(request, registrationId);
        if (authorization == null) {
            throw new IllegalStateException("Unknown client registration " + registrationId);
        }
        request.getSession(true).setAttribute(SessionAttributes.LOGIN_RETURN_PATH, target);
        authorizationRequests.saveAuthorizationRequest(authorization, request, response);
        response.sendRedirect(authorization.getAuthorizationRequestUri());
    }
}
