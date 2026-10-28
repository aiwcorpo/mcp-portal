package pl.aiwcorpo.mcp.portal.bff.config;

import java.net.URI;
import java.util.Map;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.security.oauth2.client.autoconfigure.OAuth2ClientProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.oidc.IdTokenClaimNames;

/**
 * Client registration from explicit addresses ({@code portal.oidc.*}) for a BFF that reaches the IdP on a different
 * address than the browser does, which makes OIDC discovery under the issuer unusable and removes the need for a relay
 * that answers on the public address. Without {@code portal.oidc.token-uri} Spring Boot builds the registration by
 * discovery as before. The ID token is still checked against the configured issuer, so the explicit addresses only
 * decide where keys and tokens are fetched from.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "portal.oidc", name = "token-uri")
class OidcRegistrationConfig {

    @Bean
    ClientRegistrationRepository clientRegistrationRepository(PortalProperties properties, Environment environment) {
        // Spring Boot registers its own properties bean only together with the discovery based repository.
        OAuth2ClientProperties boot = Binder.get(environment)
                .bind("spring.security.oauth2.client", OAuth2ClientProperties.class)
                .orElseThrow(() -> new IllegalStateException("spring.security.oauth2.client is not configured"));
        PortalProperties.Oidc oidc = properties.oidc();
        String id = properties.registrationId();
        OAuth2ClientProperties.Registration registration = boot.getRegistration().get(id);
        OAuth2ClientProperties.Provider provider = boot.getProvider().get(id);
        if (registration == null || provider == null || isBlank(provider.getIssuerUri())) {
            throw new IllegalStateException("Client registration and issuer-uri of '" + id + "' must be configured");
        }
        DevMode devMode = DevMode.of(environment);
        String authorizationUri = required(oidc.authorizationUri(), "portal.oidc.authorization-uri");
        String tokenUri = required(oidc.tokenUri(), "portal.oidc.token-uri");
        String jwkSetUri = required(oidc.jwkSetUri(), "portal.oidc.jwk-set-uri");
        publicAddress(authorizationUri, "portal.oidc.authorization-uri", devMode);
        backChannel(tokenUri, "portal.oidc.token-uri", devMode);
        backChannel(jwkSetUri, "portal.oidc.jwk-set-uri", devMode);
        ClientRegistration.Builder builder = ClientRegistration.withRegistrationId(id)
                .clientId(registration.getClientId())
                .clientSecret(registration.getClientSecret())
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri(registration.getRedirectUri())
                .scope(registration.getScope())
                .clientName(id)
                .issuerUri(provider.getIssuerUri())
                .authorizationUri(authorizationUri)
                .tokenUri(tokenUri)
                .jwkSetUri(jwkSetUri)
                .userNameAttributeName(IdTokenClaimNames.SUB);
        if (!isBlank(oidc.userInfoUri())) {
            backChannel(oidc.userInfoUri(), "portal.oidc.user-info-uri", devMode);
            builder.userInfoUri(oidc.userInfoUri());
        }
        if (!isBlank(oidc.endSessionUri())) {
            backChannel(oidc.endSessionUri(), "portal.oidc.end-session-uri", devMode);
            builder.providerConfigurationMetadata(Map.of("end_session_endpoint", oidc.endSessionUri()));
        }
        return new InMemoryClientRegistrationRepository(builder.build());
    }

    private static String required(String value, String name) {
        if (isBlank(value)) {
            throw new IllegalStateException(name + " is required when portal.oidc is used instead of discovery");
        }
        return value;
    }

    // The browser is sent here, so https; plain http only for a loopback address of the dev profile.
    private static void publicAddress(String uri, String name, DevMode devMode) {
        URI parsed = absolute(uri, name);
        if (!"https".equalsIgnoreCase(parsed.getScheme())) {
            boolean loopback = "localhost".equals(parsed.getHost()) || "127.0.0.1".equals(parsed.getHost());
            if (!"http".equalsIgnoreCase(parsed.getScheme()) || !loopback) {
                throw new IllegalStateException(name + " must be an https address");
            }
            devMode.require(true, name + " over http");
        }
    }

    // Client secret and tokens travel here: https, or http with the dev profile on an internal network name.
    private static void backChannel(String uri, String name, DevMode devMode) {
        URI parsed = absolute(uri, name);
        if (!"https".equalsIgnoreCase(parsed.getScheme())) {
            if (!"http".equalsIgnoreCase(parsed.getScheme())) {
                throw new IllegalStateException(name + " must be an http(s) address");
            }
            devMode.require(true, name + " over http");
        }
    }

    private static URI absolute(String uri, String name) {
        URI parsed = URI.create(uri);
        if (!parsed.isAbsolute() || parsed.getHost() == null) {
            throw new IllegalStateException(name + " must be an absolute address");
        }
        return parsed;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
