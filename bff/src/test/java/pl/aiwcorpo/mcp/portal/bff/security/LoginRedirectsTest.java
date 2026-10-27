package pl.aiwcorpo.mcp.portal.bff.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;

import pl.aiwcorpo.mcp.portal.bff.config.DevMode;

class LoginRedirectsTest {

    @Test
    void returnOriginOnlyInDevAndOnlyAsPlainOrigin() {
        assertThatThrownBy(() -> new LoginRedirects(URI.create("http://localhost:4200"), new DevMode(false)))
                .hasMessageContaining("profile 'dev'");
        assertThatThrownBy(() -> new LoginRedirects(URI.create("http://localhost:4200/x"), new DevMode(true)))
                .hasMessageContaining("scheme://host");
        new LoginRedirects(null, new DevMode(false));
        new LoginRedirects(URI.create("http://localhost:4200"), new DevMode(true));
    }

    @Test
    void failuresMapToTheClosedList() {
        assertThat(LoginFailureHandler.code(new OAuth2AuthenticationException(new OAuth2Error("access_denied"))))
                .isEqualTo("cancelled");
        assertThat(LoginFailureHandler.code(new OAuth2AuthenticationException(
                new OAuth2Error("authorization_request_not_found")))).isEqualTo("session_expired");
        assertThat(LoginFailureHandler.code(new OAuth2AuthenticationException(new OAuth2Error("invalid_id_token"))))
                .isEqualTo("idp_error");
    }
}
