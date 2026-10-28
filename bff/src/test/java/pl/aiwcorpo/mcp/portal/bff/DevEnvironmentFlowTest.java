package pl.aiwcorpo.mcp.portal.bff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.net.URI;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import pl.aiwcorpo.mcp.portal.bff.support.ContractSchemas;
import pl.aiwcorpo.mcp.portal.bff.support.DevEnvironment;
import pl.aiwcorpo.mcp.portal.bff.support.MutableClock;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * End to end against mcp-platform-dev: Keycloak realm corp (real login, refresh, token exchange, back-channel
 * logout) and the C4/C5 contract stubs over mTLS with pinned TLS names. The BFF listens on 18090 because that is
 * the redirect URI registered for {@code mcp-portal-bff}. Run with {@code ./mvnw test -Pdev-env} after
 * {@code make up}.
 */
@Tag("dev-env")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT)
@ActiveProfiles("dev")
@Import(DevEnvironmentFlowTest.TestClock.class)
class DevEnvironmentFlowTest {

    @TestConfiguration
    static class TestClock {
        @Bean
        @Primary
        MutableClock mutableClock() {
            return new MutableClock();
        }
    }

    @Autowired
    MutableClock clock;

    static final DevEnvironment DEV = DevEnvironment.locate();
    static final ContractSchemas C12 = ContractSchemas.openApi(ContractSchemas.PORTAL_BFF);
    static final JsonMapper JSON = JsonMapper.builder().build();
    static final List<HttpResponse<String>> RESPONSES = new CopyOnWriteArrayList<>();
    static final String PORTAL = "http://localhost:18090";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        assumeTrue(DEV.keycloakReachable(), "mcp-platform-dev is not running (make up)");
        registry.add("server.port", () -> "18090");
        registry.add("spring.security.oauth2.client.provider.keycloak.issuer-uri", DEV::issuer);
        registry.add("spring.security.oauth2.client.registration.keycloak.client-secret",
                () -> DEV.value("KC_CLIENT_MCP_PORTAL_BFF_SECRET"));
        registry.add("portal.broker.base-url", () -> "https://localhost:" + DEV.value("BROKER_MOCK_PORT"));
        registry.add("portal.broker.tls-name", () -> DEV.value("MCP_BROKER_TLS_NAME"));
        registry.add("portal.gateway-admin.base-url", () -> "https://localhost:" + DEV.value("GATEWAY_ADMIN_MOCK_PORT"));
        registry.add("portal.gateway-admin.tls-name", () -> DEV.value("MCP_GATEWAY_INTERNAL_TLS_NAME"));
        registry.add("portal.public-base-url", () -> "http://localhost:" + DEV.value("GATEWAY_PORT"));
        registry.add("portal.tls.keystore", () -> DEV.certs().resolve("mcp-portal-bff/keystore.p12").toString());
        registry.add("portal.tls.keystore-password", () -> DEV.value("TLS_STORE_PASSWORD"));
        registry.add("portal.tls.truststore", () -> DEV.certs().resolve("ca/truststore.p12").toString());
        registry.add("portal.tls.truststore-password", () -> DEV.value("TLS_STORE_PASSWORD"));
        registry.add("portal.web.dist-path", () -> "src/test/resources/spa-fixture");
        registry.add("portal.step-up.max-age", () -> "5m");
    }

    private static TestBrowser portal() {
        return new TestBrowser(URI.create(PORTAL), RESPONSES);
    }

    private static TestBrowser keycloak() {
        return new TestBrowser(URI.create(DEV.issuer()).resolve("/"), new ArrayList<>());
    }

    private static void login(TestBrowser portal, TestBrowser keycloak, String user, String loginPath) {
        HttpResponse<String> start = portal.get(loginPath);
        C12.assertResponse("GET", "/api/v1/auth/login", start);
        URI authorize = URI.create(start.headers().firstValue("Location").orElseThrow());
        assertThat(authorize.toString()).startsWith(DEV.issuer());
        URI callback = DEV.keycloakLogin(keycloak, authorize, user);
        assertThat(callback.toString()).startsWith(PORTAL + "/login/oauth2/code/keycloak");
        HttpResponse<String> back = portal.get(callback.toString());
        assertThat(back.statusCode()).as("callback answered %s", back.body()).isEqualTo(302);
    }

    @Test
    void aliceUsesThePortalAgainstKeycloakAndContractStubs() {
        clock.reset();
        TestBrowser portal = portal();
        TestBrowser keycloak = keycloak();
        login(portal, keycloak, "alice", "/api/v1/auth/login?returnPath=/catalog");

        HttpResponse<String> me = portal.get("/api/v1/me");
        C12.assertResponse("GET", "/api/v1/me", me);
        JsonNode meBody = JSON.readTree(me.body());
        assertThat(meBody.get("username").asString()).isEqualTo("alice");
        assertThat(meBody.get("groups").valueStream().map(JsonNode::asString))
                .contains("mcp-jira-read", "mcp-jira-proj-ABC", "mcp-gitlab-write");

        HttpResponse<String> catalog = portal.get("/api/v1/catalog");
        C12.assertResponse("GET", "/api/v1/catalog", catalog);
        assertThat(catalog.statusCode()).isEqualTo(200);
        assertThat(JSON.readTree(catalog.body()).get("servers").get(0).get("url").asString())
                .isEqualTo("http://localhost:" + DEV.value("GATEWAY_PORT") + "/s/mcp-jira/mcp");

        HttpResponse<String> connections = portal.get("/api/v1/connections");
        C12.assertResponse("GET", "/api/v1/connections", connections);
        assertThat(connections.statusCode()).isEqualTo(200);

        HttpResponse<String> stored = portal.put("/api/v1/connections/jira/secret", "{\"secret\":\"alice-pat\"}", true);
        C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", stored);
        assertThat(stored.statusCode()).isEqualTo(200);

        clock.advance(Duration.ofMinutes(6));
        portal.setReferer("/connections/jira");
        HttpResponse<String> stale = portal.put("/api/v1/connections/jira/secret", "{\"secret\":\"alice-pat\"}", true);
        C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", stale);
        assertThat(stale.statusCode()).isEqualTo(401);
        String stepUpUrl = JSON.readTree(stale.body()).get("stepUpUrl").asString();

        // max_age=0 must make Keycloak ask for credentials although the SSO session is alive.
        HttpResponse<String> stepUp = portal.get(stepUpUrl);
        URI reauthorize = URI.create(stepUp.headers().firstValue("Location").orElseThrow());
        assertThat(reauthorize.getRawQuery()).contains("max_age=0");
        URI callback = DEV.keycloakLogin(keycloak, reauthorize, "alice");
        HttpResponse<String> back = portal.get(callback.toString());
        assertThat(back.headers().firstValue("Location").orElseThrow()).endsWith("/connections/jira");

        clock.reset();
        HttpResponse<String> fresh = portal.put("/api/v1/connections/jira/secret", "{\"secret\":\"alice-pat\"}", true);
        C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", fresh);
        assertThat(fresh.statusCode()).isEqualTo(200);

        HttpResponse<String> disconnect = portal.delete("/api/v1/connections/jira", true);
        C12.assertResponse("DELETE", "/api/v1/connections/{system}", disconnect);
        assertThat(disconnect.statusCode()).isEqualTo(204);

        HttpResponse<String> logout = portal.post("/api/v1/auth/logout", null, true);
        C12.assertResponse("POST", "/api/v1/auth/logout", logout);
        assertThat(logout.statusCode()).isEqualTo(204);
        assertThat(portal.get("/api/v1/me").statusCode()).isEqualTo(401);

        // The IdP session ended as well: a new login has to ask for credentials again.
        HttpResponse<String> again = portal.get("/api/v1/auth/login");
        assertThat(DEV.asksForCredentials(keycloak, URI.create(again.headers().firstValue("Location").orElseThrow())))
                .isTrue();

        for (HttpResponse<String> response : RESPONSES) {
            assertThat(response.body()).doesNotContain("alice-pat").doesNotContain("eyJ");
            assertThat(response.headers().map().toString()).doesNotContain("eyJ");
        }
    }

    @Test
    void stepUpWithAnotherKeycloakAccountIsRejected() {
        clock.reset();
        TestBrowser portal = portal();
        TestBrowser keycloak = keycloak();
        login(portal, keycloak, "alice", "/api/v1/auth/login");
        HttpResponse<String> stepUp = portal.get("/api/v1/auth/login?stepUp=true&returnPath=/connections");
        // A browser without alice's SSO cookie, so Keycloak lets another account answer the step-up request.
        URI callback = DEV.keycloakLogin(keycloak(), URI.create(stepUp.headers().firstValue("Location").orElseThrow()), "bob");

        HttpResponse<String> back = portal.get(callback.toString());

        assertThat(back.headers().firstValue("Location").orElseThrow()).endsWith("/?loginError=step_up_failed");
        assertThat(portal.get("/api/v1/me").statusCode()).isEqualTo(401);
    }

    @Test
    void userWithoutGroupsSeesNoAccess() {
        TestBrowser portal = portal();
        login(portal, keycloak(), "mallory", "/api/v1/auth/login");

        HttpResponse<String> me = portal.get("/api/v1/me");
        C12.assertResponse("GET", "/api/v1/me", me);
        assertThat(JSON.readTree(me.body()).get("groups")).isEmpty();
    }
}
