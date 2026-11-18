package pl.aiwcorpo.mcp.portal.bff.config;

import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;

/**
 * The scheme rule of {@link OidcRegistrationConfig} for a registration that Spring Boot built by discovery: the issuer
 * and every address it names carry the client secret, codes or tokens, so https, or http with the dev profile.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnExpression("'${portal.oidc.token-uri:}'.isBlank()")
class OidcDiscoveryCheck {

    @Bean
    SmartInitializingSingleton discoveredAddressesAreHttps(ClientRegistrationRepository registrations,
                                                           PortalProperties properties, Environment environment) {
        return () -> {
            DevMode devMode = DevMode.of(environment);
            ClientRegistration registration = registrations.findByRegistrationId(properties.registrationId());
            if (registration == null) {
                return;
            }
            ClientRegistration.ProviderDetails provider = registration.getProviderDetails();
            check(provider.getIssuerUri(), "issuer-uri", devMode);
            check(provider.getAuthorizationUri(), "authorization_endpoint", devMode);
            check(provider.getTokenUri(), "token_endpoint", devMode);
            check(provider.getJwkSetUri(), "jwks_uri", devMode);
            check(provider.getUserInfoEndpoint().getUri(), "userinfo_endpoint", devMode);
            if (provider.getConfigurationMetadata().get("end_session_endpoint") instanceof String endSession) {
                check(endSession, "end_session_endpoint", devMode);
            }
        };
    }

    private static void check(String uri, String name, DevMode devMode) {
        if (uri != null && !uri.isBlank()) {
            OidcRegistrationConfig.backChannel(uri, "OIDC " + name + " " + uri, devMode);
        }
    }
}
