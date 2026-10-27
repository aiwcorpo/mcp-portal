package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.anyUrl;
import static com.github.tomakehurst.wiremock.client.WireMock.put;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.options;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.verification.LoggedRequest;
import com.networknt.schema.Schema;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import pl.aiwcorpo.mcp.portal.bff.support.ContractSchemas;
import pl.aiwcorpo.mcp.portal.bff.support.FakeIdp;
import pl.aiwcorpo.mcp.portal.bff.support.MutableClock;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The BFF over HTTP with a fake OIDC provider and the C4/C5 WireMock stubs of mcp-contracts 1.1.0. Every API
 * answer is checked against C12; at the end no recorded response or log line may contain a token or a secret.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(PortalApiTest.TestClock.class)
class PortalApiTest {

    static final FakeIdp IDP = new FakeIdp();
    static final WireMockServer BROKER = new WireMockServer(options().dynamicPort()
            .usingFilesUnderClasspath("mcp-contracts/mocks/wiremock/credential-broker"));
    static final WireMockServer GATEWAY = new WireMockServer(options().dynamicPort()
            .usingFilesUnderClasspath("mcp-contracts/mocks/wiremock/gateway-admin"));

    static final List<HttpResponse<String>> RESPONSES = new CopyOnWriteArrayList<>();
    static final List<String> SECRETS = new CopyOnWriteArrayList<>();
    static final ListAppender<ILoggingEvent> LOGS = new ListAppender<>();

    static final ContractSchemas C12 = ContractSchemas.openApi(ContractSchemas.PORTAL_BFF);
    static final ContractSchemas C4 = ContractSchemas.openApi(ContractSchemas.CREDENTIAL_BROKER);
    static final Schema AUDIT = ContractSchemas.jsonSchema("mcp-contracts/schemas/audit-event.schema.json");
    static final JsonMapper JSON = JsonMapper.builder().build();

    static final FakeIdp.User ALICE = new FakeIdp.User(UUID.randomUUID().toString(), "alice", "Alice Tester",
            List.of("mcp-jira-read", "mcp-jira-write", "mcp-jira-proj-ABC", "offline_access", "/legacy-path"));
    static final FakeIdp.User BOB = new FakeIdp.User(UUID.randomUUID().toString(), "bob", "Bob Reader",
            List.of("mcp-jira-read"));
    static final FakeIdp.User CAROL = new FakeIdp.User(UUID.randomUUID().toString(), "carol", "Carol Admin",
            List.of("mcp-platform-admin"));

    static {
        BROKER.start();
        GATEWAY.start();
    }

    @TestConfiguration
    static class TestClock {
        @Bean
        @Primary
        MutableClock mutableClock() {
            return new MutableClock();
        }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.security.oauth2.client.provider.keycloak.issuer-uri", IDP::issuer);
        registry.add("spring.security.oauth2.client.registration.keycloak.client-id", () -> FakeIdp.CLIENT_ID);
        registry.add("spring.security.oauth2.client.registration.keycloak.client-secret", () -> FakeIdp.CLIENT_SECRET);
        registry.add("portal.broker.base-url", BROKER::baseUrl);
        registry.add("portal.gateway-admin.base-url", GATEWAY::baseUrl);
        registry.add("portal.gateway.public-url", () -> "https://mcp-gateway.internal");
        registry.add("portal.web.dist-path", () -> "src/test/resources/spa-fixture");
    }

    @LocalServerPort
    int port;

    @Autowired
    MutableClock clock;

    @BeforeEach
    void setUp() {
        clock.reset();
        Logger root = ((LoggerContext) LoggerFactory.getILoggerFactory()).getLogger(Logger.ROOT_LOGGER_NAME);
        Logger audit = ((LoggerContext) LoggerFactory.getILoggerFactory()).getLogger("pl.aiwcorpo.mcp.audit");
        if (!LOGS.isStarted()) {
            LOGS.start();
        }
        if (root.getAppender(LOGS.getName()) == null) {
            LOGS.setName("test-capture");
            root.addAppender(LOGS);
            audit.addAppender(LOGS);
        }
    }

    @AfterAll
    static void nothingLeaked() {
        List<String> forbidden = new ArrayList<>(IDP.issuedTokens());
        forbidden.addAll(SECRETS);
        assertThat(forbidden).isNotEmpty();
        assertThat(RESPONSES).isNotEmpty();
        for (HttpResponse<String> response : RESPONSES) {
            String everything = response.headers().map() + "\n" + response.body();
            for (String value : forbidden) {
                assertThat(everything).as("response of %s leaks a token or secret", response.uri()).doesNotContain(value);
            }
        }
        for (ILoggingEvent event : LOGS.list) {
            for (String value : forbidden) {
                assertThat(event.getFormattedMessage()).as("log line leaks a token or secret").doesNotContain(value);
            }
        }
        IDP.close();
        BROKER.stop();
        GATEWAY.stop();
    }

    private TestBrowser browser() {
        return new TestBrowser(URI.create("http://localhost:" + port), RESPONSES);
    }

    private TestBrowser login(FakeIdp.User user, Instant authTime) {
        TestBrowser browser = browser();
        HttpResponse<String> start = browser.get("/api/v1/auth/login?returnPath=/catalog");
        assertThat(start.statusCode()).isEqualTo(302);
        URI callback = IDP.approve(URI.create(start.headers().firstValue("Location").orElseThrow()), user, authTime, "1");
        HttpResponse<String> back = browser.get(callback.toString());
        assertThat(back.statusCode()).as("callback %s answered %s", callback.getPath(), back.body()).isEqualTo(302);
        assertThat(back.headers().firstValue("Location").orElseThrow()).endsWith("/catalog");
        return browser;
    }

    private static List<JsonNode> auditEvents() {
        List<JsonNode> events = new ArrayList<>();
        for (ILoggingEvent event : LOGS.list) {
            if ("pl.aiwcorpo.mcp.audit".equals(event.getLoggerName())) {
                events.add(JSON.readTree(event.getFormattedMessage()));
            }
        }
        return events;
    }

    private static JsonNode lastAuditEvent() {
        List<JsonNode> events = auditEvents();
        assertThat(events).isNotEmpty();
        return events.getLast();
    }

    // --- login, session, CSRF ---

    @Test
    void loginRedirectsStraightToTheIdpWithPkceAndNonce() {
        HttpResponse<String> response = browser().get("/api/v1/auth/login?returnPath=/catalog?system=jira");

        C12.assertResponse("GET", "/api/v1/auth/login", response);
        URI location = URI.create(response.headers().firstValue("Location").orElseThrow());
        assertThat(location.toString()).startsWith(IDP.authorizationEndpoint());
        Map<String, String> query = FakeIdp.parse(location.getRawQuery());
        assertThat(query).containsEntry("response_type", "code")
                .containsEntry("client_id", FakeIdp.CLIENT_ID)
                .containsEntry("code_challenge_method", "S256")
                .containsKeys("code_challenge", "state", "nonce", "redirect_uri")
                .doesNotContainKey("max_age");
        assertThat(query.get("scope")).contains("openid");
    }

    @Test
    void loginRejectsReturnPathsThatCouldLeaveThePortal() {
        for (String bad : List.of("//evil.example/x", "https://evil.example/", "/%2F%2Fevil", "/\\evil", "catalog")) {
            HttpResponse<String> response = browser().get("/api/v1/auth/login?returnPath="
                    + java.net.URLEncoder.encode(bad, java.nio.charset.StandardCharsets.UTF_8));
            C12.assertResponse("GET", "/api/v1/auth/login", response);
            assertThat(response.statusCode()).as(bad).isEqualTo(400);
        }
    }

    @Test
    void loginCreatesHostPrefixedSessionAndCsrfCookie() {
        TestBrowser browser = browser();
        HttpResponse<String> start = browser.get("/api/v1/auth/login");
        URI callback = IDP.approve(URI.create(start.headers().firstValue("Location").orElseThrow()), ALICE, Instant.now(), "1");
        HttpResponse<String> back = browser.get(callback.toString());

        assertThat(back.headers().firstValue("Location").orElseThrow()).endsWith("/");
        List<String> session = browser.setCookieHeaders(back, "__Host-session");
        assertThat(session).hasSize(1);
        String cookie = session.getFirst().toLowerCase();
        assertThat(cookie).contains("; secure").contains("; httponly").contains("samesite=lax").contains("path=/")
                .doesNotContain("domain=");
        assertThat(browser.setCookieHeaders(back, "JSESSIONID")).isEmpty();

        HttpResponse<String> me = browser.get("/api/v1/me");
        assertThat(me.statusCode()).isEqualTo(200);
        String xsrf = browser.setCookieHeaders(back, "XSRF-TOKEN").stream()
                .filter(header -> !header.toLowerCase().contains("max-age=0"))
                .findFirst()
                .orElseGet(() -> browser.setCookieHeaders(me, "XSRF-TOKEN").getFirst())
                .toLowerCase();
        assertThat(xsrf).contains("; secure").contains("samesite=strict").contains("path=/").doesNotContain("httponly");
        assertThat(browser.cookie("XSRF-TOKEN")).isPresent();
    }

    @Test
    void apiWithoutSessionIsUnauthenticatedJson() {
        HttpResponse<String> me = browser().get("/api/v1/me", Map.of("Accept", "text/html"));
        C12.assertResponse("GET", "/api/v1/me", me);
        assertThat(me.statusCode()).isEqualTo(401);
        assertThat(me.body()).isEqualTo("{\"error\":\"unauthenticated\"}");

        HttpResponse<String> catalog = browser().get("/api/v1/catalog");
        C12.assertResponse("GET", "/api/v1/catalog", catalog);
        assertThat(catalog.statusCode()).isEqualTo(401);
    }

    @Test
    void modifyingCallsRequireTheCsrfHeader() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");

        HttpResponse<String> withoutHeader = browser.put("/api/v1/connections/jira/secret",
                "{\"secret\":\"test-only-csrf-probe\"}", false);
        C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", withoutHeader);
        assertThat(withoutHeader.statusCode()).isEqualTo(403);
        assertThat(withoutHeader.body()).contains("csrf_invalid");
        SECRETS.add("test-only-csrf-probe");

        HttpResponse<String> deleteWithout = browser.delete("/api/v1/connections/jira", false);
        C12.assertResponse("DELETE", "/api/v1/connections/{system}", deleteWithout);
        assertThat(deleteWithout.statusCode()).isEqualTo(403);

        HttpResponse<String> logoutWithout = browser.post("/api/v1/auth/logout", null, false);
        C12.assertResponse("POST", "/api/v1/auth/logout", logoutWithout);
        assertThat(logoutWithout.statusCode()).isEqualTo(403);

        HttpResponse<String> wrongToken = browser.send(java.net.http.HttpRequest.newBuilder(
                        browser.origin().resolve("/api/v1/connections/jira")).DELETE(),
                Map.of("X-XSRF-TOKEN", "not-the-cookie-value"));
        assertThat(wrongToken.statusCode()).isEqualTo(403);
        assertThat(BROKER.findAll(anyRequestedFor(urlPathEqualTo("/v1/connections/jira")))).isEmpty();
    }

    @Test
    void sessionEndsAfterTheAbsoluteLifetime() {
        TestBrowser browser = login(ALICE, Instant.now());
        assertThat(browser.get("/api/v1/me").statusCode()).isEqualTo(200);

        clock.advance(Duration.ofHours(8).plusMinutes(1));

        HttpResponse<String> me = browser.get("/api/v1/me");
        C12.assertResponse("GET", "/api/v1/me", me);
        assertThat(me.statusCode()).isEqualTo(401);
    }

    @Test
    void logoutEndsLocalAndIdpSession() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        int idpLogoutsBefore = IDP.logoutRequests().size();

        HttpResponse<String> logout = browser.post("/api/v1/auth/logout", null, true);

        C12.assertResponse("POST", "/api/v1/auth/logout", logout);
        assertThat(logout.statusCode()).isEqualTo(204);
        assertThat(browser.setCookieHeaders(logout, "__Host-session")).anySatisfy(header ->
                assertThat(header.toLowerCase()).startsWith("__host-session=;").contains("expires=thu, 01 jan 1970")
                        .contains("secure").contains("path=/"));
        assertThat(IDP.logoutRequests()).hasSize(idpLogoutsBefore + 1);
        assertThat(IDP.logoutRequests().getLast()).containsKey("refresh_token");
        assertThat(browser.get("/api/v1/me").statusCode()).isEqualTo(401);
    }

    // --- me, catalog, connections ---

    @Test
    void meReturnsOnlyPlatformGroups() {
        TestBrowser browser = login(ALICE, Instant.now());
        HttpResponse<String> me = browser.get("/api/v1/me");

        C12.assertResponse("GET", "/api/v1/me", me);
        JsonNode body = JSON.readTree(me.body());
        assertThat(body.get("username").asString()).isEqualTo("alice");
        assertThat(body.get("displayName").asString()).isEqualTo("Alice Tester");
        assertThat(body.get("isAdmin").asBoolean()).isFalse();
        assertThat(body.get("groups").valueStream().map(JsonNode::asString))
                .containsExactly("mcp-jira-proj-ABC", "mcp-jira-read", "mcp-jira-write");

        HttpResponse<String> admin = login(CAROL, Instant.now()).get("/api/v1/me");
        C12.assertResponse("GET", "/api/v1/me", admin);
        assertThat(JSON.readTree(admin.body()).get("isAdmin").asBoolean()).isTrue();
    }

    @Test
    void catalogCombinesGatewayBrokerAndIga() {
        TestBrowser browser = login(ALICE, Instant.now());
        HttpResponse<String> response = browser.get("/api/v1/catalog");

        C12.assertResponse("GET", "/api/v1/catalog", response);
        JsonNode servers = JSON.readTree(response.body()).get("servers");
        // C5 stub: jira (get_issue granted, update_issue denied), gitlab (denied); C4 stub: jira connected,
        // gitlab expiring; IGA mock: alice has only a rejected request.
        JsonNode jira = servers.get(0);
        assertThat(jira.get("status").asString()).isEqualTo("connected");
        assertThat(jira.get("url").asString()).isEqualTo("https://mcp-gateway.internal/s/mcp-jira/mcp");
        assertThat(jira.get("actions").valueStream().map(JsonNode::asString))
                .containsExactly("copy_link", "request_access", "disconnect");
        JsonNode gitlab = servers.get(1);
        assertThat(gitlab.get("status").asString()).isEqualTo("no_access");
        assertThat(gitlab.get("actions").valueStream().map(JsonNode::asString))
                .containsExactly("request_access", "disconnect");

        assertThat(GATEWAY.findAll(anyRequestedFor(urlPathEqualTo("/admin/v1/catalog"))).getLast().getHeader("Authorization"))
                .startsWith("Bearer xt-mcp-gateway-admin-");
        assertThat(BROKER.findAll(anyRequestedFor(urlPathEqualTo("/v1/connections"))).getLast().getHeader("Authorization"))
                .startsWith("Bearer xt-mcp-credential-broker-");
        assertThat(IDP.tokenRequests()).anySatisfy(form -> assertThat(form)
                .containsEntry("grant_type", "urn:ietf:params:oauth:grant-type:token-exchange")
                .containsEntry("audience", "mcp-gateway-admin")
                .containsEntry("scope", "mcp-gateway-admin-audience"));
        assertThat(IDP.tokenRequests()).anySatisfy(form -> assertThat(form)
                .containsEntry("audience", "mcp-credential-broker")
                .containsEntry("scope", "mcp-credential-broker-audience"));
    }

    @Test
    void catalogShowsPendingRequestFromIga() {
        HttpResponse<String> response = login(BOB, Instant.now()).get("/api/v1/catalog");

        C12.assertResponse("GET", "/api/v1/catalog", response);
        JsonNode jira = JSON.readTree(response.body()).get("servers").get(0);
        assertThat(jira.get("actions").valueStream().map(JsonNode::asString))
                .containsExactly("copy_link", "view_request", "disconnect");
    }

    @Test
    void exchangedTokensAreReusedWithinTheSession() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/catalog");
        long exchanges = countExchanges();
        browser.get("/api/v1/catalog");
        browser.get("/api/v1/connections");
        assertThat(countExchanges()).isEqualTo(exchanges);
    }

    private static long countExchanges() {
        return IDP.tokenRequests().stream()
                .filter(form -> "urn:ietf:params:oauth:grant-type:token-exchange".equals(form.get("grant_type")))
                .count();
    }

    @Test
    void connectionsPassThroughWithoutValues() {
        HttpResponse<String> response = login(ALICE, Instant.now()).get("/api/v1/connections");

        C12.assertResponse("GET", "/api/v1/connections", response);
        assertThat(JSON.readTree(response.body())).hasSize(2);
    }

    @Test
    void upstreamFailureIsServiceUnavailableJson() {
        GATEWAY.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlPathEqualTo("/admin/v1/catalog"))
                .atPriority(1)
                .withHeader("X-Request-Id", com.github.tomakehurst.wiremock.client.WireMock.matching(".+"))
                .willReturn(aResponse().withStatus(500).withBody("<html>stack trace with internals</html>")));
        try {
            HttpResponse<String> response = login(ALICE, Instant.now()).get("/api/v1/catalog");
            assertThat(response.statusCode()).isEqualTo(503);
            assertThat(response.body()).isEqualTo("{\"error\":\"upstream_unavailable\"}");
        } finally {
            GATEWAY.resetToDefaultMappings();
        }
    }

    // --- secret with step-up ---

    @Test
    void secretWithFreshLoginGoesToBrokerAndIsAudited() {
        String secret = "test-only-secret-" + UUID.randomUUID();
        SECRETS.add(secret);
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");

        HttpResponse<String> response = browser.put("/api/v1/connections/jira/secret",
                "{\"secret\":\"" + secret + "\",\"expiresAt\":\"2027-01-31T00:00:00Z\"}", true);

        C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", response);
        assertThat(response.statusCode()).isEqualTo(200);
        LoggedRequest sent = BROKER.findAll(anyRequestedFor(urlPathEqualTo("/v1/connections/jira/secret"))).getLast();
        assertThat(sent.getHeader("Authorization")).startsWith("Bearer xt-mcp-credential-broker-");
        C4.assertComponent("PutSecretRequest", JSON.readTree(sent.getBodyAsString()));
        assertThat(JSON.readTree(sent.getBodyAsString()).get("secret").asString()).isEqualTo(secret);

        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("component").asString()).isEqualTo("portal");
        assertThat(event.get("event").asString()).isEqualTo("connection_change");
        assertThat(event.get("sub").asString()).isEqualTo(ALICE.sub());
        assertThat(event.get("server").asString()).isEqualTo("mcp-jira");
        assertThat(event.get("outcome").asString()).isEqualTo("ok");
        assertThat(event.get("requestId").asString())
                .isEqualTo(response.headers().firstValue("X-Request-Id").orElseThrow())
                .isEqualTo(sent.getHeader("X-Request-Id"));
    }

    @Test
    void secretWithoutFreshMfaNeedsStepUpThenSucceeds() {
        String secret = "test-only-secret-" + UUID.randomUUID();
        SECRETS.add(secret);
        TestBrowser browser = login(ALICE, Instant.now().minus(Duration.ofMinutes(10)));
        browser.get("/api/v1/me");
        browser.setReferer("/connections/jira?step=token");
        int brokerCallsBefore = BROKER.findAll(anyRequestedFor(urlPathEqualTo("/v1/connections/jira/secret"))).size();

        HttpResponse<String> denied = browser.put("/api/v1/connections/jira/secret",
                "{\"secret\":\"" + secret + "\"}", true);

        C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", denied);
        assertThat(denied.statusCode()).isEqualTo(401);
        JsonNode body = JSON.readTree(denied.body());
        assertThat(body.get("error").asString()).isEqualTo("step_up_required");
        String stepUpUrl = body.get("stepUpUrl").asString();
        assertThat(stepUpUrl).isEqualTo("/api/v1/auth/login?stepUp=true&returnPath=/connections/jira?step%3Dtoken");
        assertThat(BROKER.findAll(anyRequestedFor(urlPathEqualTo("/v1/connections/jira/secret")))).hasSize(brokerCallsBefore);
        JsonNode deniedEvent = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, deniedEvent);
        assertThat(deniedEvent.get("reason").asString()).isEqualTo("step_up_required");
        assertThat(deniedEvent.get("outcome").asString()).isEqualTo("denied");

        HttpResponse<String> stepUp = browser.get(stepUpUrl);
        C12.assertResponse("GET", "/api/v1/auth/login", stepUp);
        URI authorize = URI.create(stepUp.headers().firstValue("Location").orElseThrow());
        assertThat(FakeIdp.parse(authorize.getRawQuery())).containsEntry("max_age", "0");
        HttpResponse<String> back = browser.get(IDP.approve(authorize, ALICE, Instant.now(), "1").toString());
        assertThat(back.headers().firstValue("Location").orElseThrow()).endsWith("/connections/jira?step=token");

        browser.get("/api/v1/me");
        HttpResponse<String> stored = browser.put("/api/v1/connections/jira/secret", "{\"secret\":\"" + secret + "\"}", true);
        C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", stored);
        assertThat(stored.statusCode()).isEqualTo(200);
    }

    @Test
    void secretRejectedByTheBrokerIs422() {
        BROKER.stubFor(put(urlPathEqualTo("/v1/connections/confluence/secret")).atPriority(1)
                .withHeader("Authorization", com.github.tomakehurst.wiremock.client.WireMock.matching("^Bearer .+$"))
                .willReturn(aResponse().withStatus(422).withHeader("Content-Type", "application/json")
                        .withBody("{\"error\":\"identity_mismatch\"}")));
        String secret = "test-only-secret-" + UUID.randomUUID();
        SECRETS.add(secret);
        try {
            TestBrowser browser = login(ALICE, Instant.now());
            browser.get("/api/v1/me");
            HttpResponse<String> response = browser.put("/api/v1/connections/confluence/secret",
                    "{\"secret\":\"" + secret + "\"}", true);

            C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", response);
            assertThat(response.statusCode()).isEqualTo(422);
            assertThat(response.body()).isEqualTo("{\"error\":\"identity_mismatch\"}");
            JsonNode event = lastAuditEvent();
            ContractSchemas.assertValid(AUDIT, event);
            assertThat(event.get("outcome").asString()).isEqualTo("error");
            assertThat(event.get("reason").asString()).isEqualTo("identity_mismatch");
        } finally {
            BROKER.resetToDefaultMappings();
        }
    }

    @Test
    void malformedSecretRequestsAreRejectedBeforeTheBroker() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        int before = BROKER.findAll(anyRequestedFor(anyUrl())).size();
        SECRETS.add("test-only-unknown-field");

        for (String body : List.of("{}", "{\"secret\":\"\"}", "{\"secret\":\"x\",\"sub\":\"someone-else\"}",
                "{\"secret\":\"test-only-unknown-field\",\"expiresAt\":\"tomorrow\"}", "not json")) {
            HttpResponse<String> response = browser.put("/api/v1/connections/jira/secret", body, true);
            C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", response);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
        }
        HttpResponse<String> unknownSystem = browser.put("/api/v1/connections/sharepoint/secret", "{\"secret\":\"x\"}", true);
        assertThat(unknownSystem.statusCode()).isEqualTo(400);
        assertThat(BROKER.findAll(anyRequestedFor(anyUrl()))).hasSize(before);
    }

    @Test
    void disconnectCallsBrokerAndIsAudited() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");

        HttpResponse<String> response = browser.delete("/api/v1/connections/gitlab", true);

        C12.assertResponse("DELETE", "/api/v1/connections/{system}", response);
        assertThat(response.statusCode()).isEqualTo(204);
        assertThat(BROKER.findAll(anyRequestedFor(urlPathEqualTo("/v1/connections/gitlab")))).isNotEmpty();
        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("server").asString()).isEqualTo("mcp-gitlab");
        assertThat(event.get("outcome").asString()).isEqualTo("ok");
    }

    // --- SPA ---

    @Test
    void spaRoutesServeIndexWithNonceAndSecurityHeaders() {
        for (String route : List.of("/", "/index.html", "/login", "/logout", "/catalog", "/connections/jira", "/confirm/cnf_123", "/a/b/c?x=1")) {
            HttpResponse<String> response = browser().get(route);
            assertThat(response.statusCode()).as(route).isEqualTo(200);
            assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("text/html");
            String csp = response.headers().firstValue("Content-Security-Policy").orElseThrow();
            assertThat(csp).doesNotContain("unsafe-inline").doesNotContain("unsafe-eval")
                    .contains("default-src 'self'").contains("frame-ancestors 'none'").contains("script-src 'self';");
            String nonce = csp.replaceAll(".*style-src 'self' 'nonce-([^']+)'.*", "$1");
            assertThat(response.body()).contains("ngCspNonce=\"" + nonce + "\"").doesNotContain("__CSP_NONCE__");
            assertThat(response.headers().firstValue("Strict-Transport-Security").orElseThrow())
                    .contains("max-age=31536000").contains("includeSubDomains");
            assertThat(response.headers().firstValue("Cache-Control").orElseThrow()).contains("no-store");
        }
    }

    @Test
    void buildFilesAreServedAsTheyAre() {
        HttpResponse<String> response = browser().get("/assets/app.js");
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Content-Type").orElse("")).contains("javascript");
        assertThat(response.body()).contains("fixture");
        assertThat(response.headers().firstValue("Content-Security-Policy")).isPresent();
    }

    @Test
    void apiPathsNeverAnswerWithHtml() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        List<HttpResponse<String>> responses = List.of(
                browser.get("/api/v1/does-not-exist", Map.of("Accept", "text/html")),
                browser.get("/api/v1/../v1/nothing", Map.of("Accept", "text/html")),
                browser.get("/api", Map.of("Accept", "text/html")),
                browser.post("/api/v1/me", null, true),
                browser().get("/api/v1/unknown", Map.of("Accept", "text/html")));
        for (HttpResponse<String> response : responses) {
            assertThat(response.statusCode()).as(response.uri().toString()).isBetween(400, 499);
            assertThat(response.headers().firstValue("Content-Type").orElse(""))
                    .as(response.uri().toString()).startsWith("application/json");
            assertThat(response.body()).doesNotContainIgnoringCase("<html");
            C12.assertComponent("Error", JSON.readTree(response.body()));
        }
    }
}
