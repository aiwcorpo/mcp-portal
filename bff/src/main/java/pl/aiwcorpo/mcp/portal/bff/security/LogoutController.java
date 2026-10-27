package pl.aiwcorpo.mcp.portal.bff.security;

import java.net.URI;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.web.authentication.logout.CookieClearingLogoutHandler;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfLogoutHandler;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import pl.aiwcorpo.mcp.portal.bff.config.IdpClientConfig;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;

/**
 * {@code POST /api/v1/auth/logout} (C12, CC-023). Ends the IdP session over the back channel with the
 * session's refresh token (OIDC RP-initiated logout as a POST, which Keycloak accepts from confidential clients),
 * so the browser gets a plain 204 instead of a redirect through the IdP.
 */
@RestController
class LogoutController {

    private static final Logger log = LoggerFactory.getLogger(LogoutController.class);
    private static final String SESSION_COOKIE = "__Host-session";

    private final OAuth2AuthorizedClientRepository authorizedClients;
    private final CookieCsrfTokenRepository csrfTokens;
    private final String registrationId;
    private final RestClient idp;

    LogoutController(OAuth2AuthorizedClientRepository authorizedClients, CookieCsrfTokenRepository csrfTokens,
                     PortalProperties properties, @Qualifier(IdpClientConfig.IDP_REST_CLIENT) RestClient idp) {
        this.idp = idp;
        this.authorizedClients = authorizedClients;
        this.csrfTokens = csrfTokens;
        this.registrationId = properties.registrationId();
    }

    @PostMapping("/api/v1/auth/logout")
    ResponseEntity<Void> logout(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        OAuth2AuthorizedClient client = authorizedClients.loadAuthorizedClient(registrationId, authentication, request);
        if (client != null) {
            endIdpSession(client);
            authorizedClients.removeAuthorizedClient(registrationId, authentication, request, response);
        }
        new SecurityContextLogoutHandler().logout(request, response, authentication);
        new CsrfLogoutHandler(csrfTokens).logout(request, response, authentication);
        new CookieClearingLogoutHandler(expiredSessionCookie()).logout(request, response, authentication);
        return ResponseEntity.noContent().build();
    }

    // __Host- cookies are only replaced by a Set-Cookie that is itself Secure with Path=/.
    private static Cookie expiredSessionCookie() {
        Cookie cookie = new Cookie(SESSION_COOKIE, "");
        cookie.setPath("/");
        cookie.setSecure(true);
        cookie.setHttpOnly(true);
        cookie.setMaxAge(0);
        cookie.setAttribute("SameSite", "Lax");
        return cookie;
    }

    private void endIdpSession(OAuth2AuthorizedClient client) {
        ClientRegistration registration = client.getClientRegistration();
        Object endpoint = registration.getProviderDetails().getConfigurationMetadata().get("end_session_endpoint");
        if (endpoint == null || client.getRefreshToken() == null) {
            return;
        }
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("client_id", registration.getClientId());
        form.add("client_secret", registration.getClientSecret());
        form.add("refresh_token", client.getRefreshToken().getTokenValue());
        try {
            idp.post().uri(URI.create(endpoint.toString()))
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientException e) {
            // The local session ends anyway; the IdP session then expires on its own idle timeout.
            log.warn("IdP logout failed: {}", e.getClass().getSimpleName());
        }
    }
}
