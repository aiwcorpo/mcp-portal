package pl.aiwcorpo.mcp.portal.bff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpResponse;
import java.time.Instant;

import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import pl.aiwcorpo.mcp.portal.bff.PortalBffApplication;
import pl.aiwcorpo.mcp.portal.bff.support.FakeIdp;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;

/**
 * Explicit IdP addresses (portal.oidc.*): no discovery under the issuer, keys and tokens from the back-channel
 * addresses, the ID token still checked against the configured issuer.
 */
class BackchannelOidcTest extends PortalHarness {

    @DynamicPropertySource
    static void explicitAddresses(DynamicPropertyRegistry registry) {
        registry.add("portal.oidc.authorization-uri", IDP::authorizationEndpoint);
        registry.add("portal.oidc.token-uri", () -> IDP.issuer() + "/token");
        registry.add("portal.oidc.jwk-set-uri", () -> IDP.issuer() + "/jwks");
        registry.add("portal.oidc.user-info-uri", () -> IDP.issuer() + "/userinfo");
        registry.add("portal.oidc.end-session-uri", () -> IDP.issuer() + "/logout");
    }

    @Test
    void loginAndTokenExchangeWorkWithoutDiscovery() {
        int before = IDP.discoveryRequests();

        TestBrowser browser = login(ALICE, Instant.now());
        HttpResponse<String> catalog = browser.get("/api/v1/connections");

        assertThat(catalog.statusCode()).isEqualTo(200);
        assertThat(IDP.discoveryRequests()).as("discovery requests since the login").isEqualTo(before);
        assertThat(IDP.tokenRequests()).isNotEmpty();
        HttpResponse<String> logout = browser.post("/api/v1/auth/logout", null, true);
        assertThat(logout.statusCode()).isEqualTo(204);
        assertThat(IDP.logoutRequests()).isNotEmpty();
    }

    @Test
    void anIdTokenFromAnotherIssuerIsRefused() {
        try (ConfigurableApplicationContext context = new SpringApplicationBuilder(PortalBffApplication.class)
                .profiles("dev")
                .run("--server.port=0",
                        "--spring.security.oauth2.client.provider.keycloak.issuer-uri=https://idp.invalid/realms/other",
                        "--spring.security.oauth2.client.registration.keycloak.client-id=" + FakeIdp.CLIENT_ID,
                        "--spring.security.oauth2.client.registration.keycloak.client-secret=" + FakeIdp.CLIENT_SECRET,
                        "--spring.security.oauth2.client.registration.keycloak.redirect-uri={baseUrl}/api/v1/auth/callback",
                        "--portal.oidc.authorization-uri=" + IDP.authorizationEndpoint(),
                        "--portal.oidc.token-uri=" + IDP.issuer() + "/token",
                        "--portal.oidc.jwk-set-uri=" + IDP.issuer() + "/jwks",
                        "--portal.broker.base-url=http://127.0.0.1:9", "--portal.gateway-admin.base-url=http://127.0.0.1:9",
                        "--portal.tls.insecure-plain-http-for-tests=true", "--portal.public-base-url=https://mcp-gateway.internal",
                        "--portal.web.dist-path=src/test/resources/spa-fixture")) {
            int otherPort = Integer.parseInt(context.getEnvironment().getProperty("local.server.port"));
            TestBrowser browser = new TestBrowser(URI.create("http://localhost:" + otherPort), new java.util.ArrayList<>());
            HttpResponse<String> start = browser.get("/api/v1/auth/login");
            URI callback = IDP.approve(URI.create(start.headers().firstValue("Location").orElseThrow()), ALICE,
                    Instant.now(), "1");

            HttpResponse<String> back = browser.get(callback.toString());

            assertThat(back.statusCode()).isEqualTo(302);
            assertThat(back.headers().firstValue("Location").orElseThrow()).contains("loginError=");
            assertThat(browser.get("/api/v1/me").statusCode()).isEqualTo(401);
        }
    }

    @Test
    void anIncompleteSetOfAddressesIsAStartupError() {
        assertThatThrownBy(() -> new SpringApplicationBuilder(PortalBffApplication.class)
                .profiles("dev")
                .run("--server.port=0",
                        "--spring.security.oauth2.client.provider.keycloak.issuer-uri=" + IDP.issuer(),
                        "--spring.security.oauth2.client.registration.keycloak.client-id=" + FakeIdp.CLIENT_ID,
                        "--spring.security.oauth2.client.registration.keycloak.client-secret=" + FakeIdp.CLIENT_SECRET,
                        "--portal.oidc.token-uri=" + IDP.issuer() + "/token",
                        "--portal.broker.base-url=http://127.0.0.1:9", "--portal.gateway-admin.base-url=http://127.0.0.1:9",
                        "--portal.tls.insecure-plain-http-for-tests=true", "--portal.public-base-url=https://mcp-gateway.internal",
                        "--portal.web.dist-path=src/test/resources/spa-fixture"))
                .hasRootCauseMessage("portal.oidc.authorization-uri is required when portal.oidc is used instead of discovery");
    }

    @Test
    void anEmptyTokenUriMeansDiscovery() {
        try (ConfigurableApplicationContext context = new SpringApplicationBuilder(PortalBffApplication.class)
                .profiles("dev")
                .run("--server.port=0",
                        "--spring.security.oauth2.client.provider.keycloak.issuer-uri=" + IDP.issuer(),
                        "--spring.security.oauth2.client.registration.keycloak.client-id=" + FakeIdp.CLIENT_ID,
                        "--spring.security.oauth2.client.registration.keycloak.client-secret=" + FakeIdp.CLIENT_SECRET,
                        "--portal.oidc.token-uri=",
                        "--portal.broker.base-url=http://127.0.0.1:9", "--portal.gateway-admin.base-url=http://127.0.0.1:9",
                        "--portal.tls.insecure-plain-http-for-tests=true", "--portal.public-base-url=https://mcp-gateway.internal",
                        "--portal.web.dist-path=src/test/resources/spa-fixture")) {
            assertThat(context.isRunning()).isTrue();
        }
    }
}
