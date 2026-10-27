package pl.aiwcorpo.mcp.portal.bff.token;

import java.time.Clock;
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
        boolean basic = !ClientAuthenticationMethod.CLIENT_SECRET_POST.equals(registration.getClientAuthenticationMethod());
        if (!basic) {
            form.add("client_id", registration.getClientId());
            form.add("client_secret", registration.getClientSecret());
        }
        Instant requestedAt = clock.instant();
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
            throw new TokenUnavailableException("token exchange for " + audience + " failed: " + e.getClass().getSimpleName());
        }
        if (response == null || response.accessToken() == null || response.accessToken().isBlank()) {
            throw new TokenUnavailableException("token exchange for " + audience + " returned no access token");
        }
        long lifetime = response.expiresIn() == null ? 60 : response.expiresIn();
        return new BearerToken(response.accessToken(), requestedAt.plusSeconds(lifetime));
    }

    record TokenResponse(@JsonProperty("access_token") String accessToken,
                         @JsonProperty("expires_in") Long expiresIn) {

        @Override
        public String toString() {
            return "TokenResponse[expiresIn=" + expiresIn + "]";
        }
    }
}
