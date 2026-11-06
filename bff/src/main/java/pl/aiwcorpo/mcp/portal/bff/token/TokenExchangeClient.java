package pl.aiwcorpo.mcp.portal.bff.token;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

import com.fasterxml.jackson.annotation.JsonProperty;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * RFC 8693 token exchange at the IdP token endpoint. Keycloak (26.x, standard exchange) needs both
 * {@code audience} and the optional client scope that carries that audience.
 */
class TokenExchangeClient {

    static final String GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
    static final String ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

    private final RestClient http;
    private final Clock clock;

    TokenExchangeClient(RestClient http, Clock clock) {
        this.http = http;
        this.clock = clock;
    }

    BearerToken exchange(ClientRegistration registration, String subjectToken, String audience, String scope) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", GRANT_TYPE);
        form.add("subject_token", subjectToken);
        form.add("subject_token_type", ACCESS_TOKEN_TYPE);
        form.add("requested_token_type", ACCESS_TOKEN_TYPE);
        form.add("audience", audience);
        if (scope != null && !scope.isBlank()) {
            form.add("scope", scope);
        }
        Instant requestedAt = clock.instant();
        TokenResponse response = post(registration, form, "token exchange for " + audience);
        long lifetime = response.expiresIn() == null ? 60 : response.expiresIn();
        return new BearerToken(response.accessToken(), requestedAt.plusSeconds(lifetime));
    }

    /** What a narrowed refresh gives: the token for one audience and, when the IdP rotates them, the next refresh token. */
    record Refreshed(BearerToken token, String refreshToken) {

        @Override
        public String toString() {
            return "Refreshed[token=" + token + "]";
        }
    }

    /**
     * Refresh grant narrowed to the scope of one audience (RFC 6749 section 6: a scope may only be narrowed). Unlike an
     * exchange, the IdP keeps the level of the login in the new token ({@code acr}, {@code auth_time}), which is what the
     * gateway and the broker ask for on a write that needs fresh MFA.
     */
    Refreshed refresh(ClientRegistration registration, String refreshToken, String scope, Duration maxLifetime) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "refresh_token");
        form.add("refresh_token", refreshToken);
        form.add("scope", "openid " + scope);
        Instant requestedAt = clock.instant();
        TokenResponse response = post(registration, form, "refresh for " + scope);
        long lifetime = Math.min(response.expiresIn() == null ? 60 : response.expiresIn(), maxLifetime.toSeconds());
        return new Refreshed(new BearerToken(response.accessToken(), requestedAt.plusSeconds(lifetime)),
                response.refreshToken());
    }

    private TokenResponse post(ClientRegistration registration, MultiValueMap<String, String> form, String what) {
        boolean basic = !ClientAuthenticationMethod.CLIENT_SECRET_POST.equals(registration.getClientAuthenticationMethod());
        if (!basic) {
            form.add("client_id", registration.getClientId());
            form.add("client_secret", registration.getClientSecret());
        }
        TokenResponse response;
        try {
            response = http.post()
                    .uri(registration.getProviderDetails().getTokenUri())
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .accept(MediaType.APPLICATION_JSON)
                    .headers(headers -> {
                        if (basic) {
                            headers.setBasicAuth(HttpHeaders.encodeBasicAuth(
                                    registration.getClientId(), registration.getClientSecret(), null));
                        }
                    })
                    .body(form)
                    .retrieve()
                    .body(TokenResponse.class);
        } catch (RestClientException e) {
            throw new TokenUnavailableException(what + " failed: " + e.getClass().getSimpleName());
        }
        if (response == null || response.accessToken() == null || response.accessToken().isBlank()) {
            throw new TokenUnavailableException(what + " returned no access token");
        }
        return response;
    }

    record TokenResponse(@JsonProperty("access_token") String accessToken,
                         @JsonProperty("expires_in") Long expiresIn,
                         @JsonProperty("refresh_token") String refreshToken) {

        @Override
        public String toString() {
            return "TokenResponse[expiresIn=" + expiresIn + "]";
        }
    }
}
