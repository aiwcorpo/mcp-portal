package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.anyUrl;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.options;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
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
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import pl.aiwcorpo.mcp.portal.bff.support.ContractSchemas;
import pl.aiwcorpo.mcp.portal.bff.support.FakeIdp;
import pl.aiwcorpo.mcp.portal.bff.support.MutableClock;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Shared setup of the API tests: the BFF over HTTP with a fake OIDC provider and the C4/C5 WireMock stubs of
 * mcp-contracts 2.2.1. Subclasses check every answer against C12; after each class no recorded response or log line
 * may contain a token or a secret, and every request to the stubs must be an operation of C4 or C5.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("dev")
@Import(PortalHarness.TestClock.class)
abstract class PortalHarness {

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
    static final FakeIdp.User MALLORY = new FakeIdp.User(UUID.randomUUID().toString(), "mallory", "Mallory Nogroups",
            List.of());
    static final FakeIdp.User CAROL = new FakeIdp.User(UUID.randomUUID().toString(), "carol", "Carol Admin",
            List.of("mcp-platform-admin"));

    static {
        BROKER.start();
        GATEWAY.start();
        // Shared by every test class that extends this one, so nobody stops them in an @AfterAll.
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            IDP.close();
            BROKER.stop();
            GATEWAY.stop();
        }));
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
        registry.add("portal.public-base-url", () -> "https://mcp-gateway.internal");
        // The tests browse the random local port, so the callback must come back to the address of the request.
        registry.add("spring.security.oauth2.client.registration.keycloak.redirect-uri",
                () -> "{baseUrl}/api/v1/auth/callback");
        registry.add("portal.web.dist-path", () -> "src/test/resources/spa-fixture");
        registry.add("portal.tls.insecure-plain-http-for-tests", () -> "true");
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
        assertOutboundRequestsFollowContracts();
    }

    /** Every request the BFF sent to the C4/C5 stubs is an operation of the contract with a valid body and a bearer token. */
    private static void assertOutboundRequestsFollowContracts() {
        ContractSchemas c5 = ContractSchemas.openApi(ContractSchemas.GATEWAY_ADMIN);
        List<LoggedRequest> brokerRequests = BROKER.findAll(anyRequestedFor(anyUrl()));
        List<LoggedRequest> gatewayRequests = GATEWAY.findAll(anyRequestedFor(anyUrl()));
        for (LoggedRequest request : brokerRequests) {
            C4.assertRequest(request.getMethod().getName(), request.getUrl(), request.getBodyAsString());
            assertThat(request.getHeader("Authorization")).startsWith("Bearer xt-mcp-credential-broker-");
            assertThat(request.getHeader("X-Request-Id")).matches("^[0-9a-f]{8}-[0-9a-f]{4}-7.*");
        }
        for (LoggedRequest request : gatewayRequests) {
            c5.assertRequest(request.getMethod().getName(), request.getUrl(), request.getBodyAsString());
            assertThat(request.getHeader("Authorization")).startsWith("Bearer xt-mcp-gateway-admin-");
        }
    }

    TestBrowser browser() {
        return new TestBrowser(URI.create("http://localhost:" + port), RESPONSES);
    }

    TestBrowser login(FakeIdp.User user, Instant authTime) {
        TestBrowser browser = browser();
        HttpResponse<String> start = browser.get("/api/v1/auth/login?returnPath=/catalog");
        assertThat(start.statusCode()).isEqualTo(302);
        URI callback = IDP.approve(URI.create(start.headers().firstValue("Location").orElseThrow()), user, authTime, "1");
        HttpResponse<String> back = browser.get(callback.toString());
        assertThat(back.statusCode()).as("callback %s answered %s", callback.getPath(), back.body()).isEqualTo(302);
        assertThat(back.headers().firstValue("Location").orElseThrow()).endsWith("/catalog");
        return browser;
    }

    static List<JsonNode> auditEvents() {
        List<JsonNode> events = new ArrayList<>();
        for (ILoggingEvent event : LOGS.list) {
            if ("pl.aiwcorpo.mcp.audit".equals(event.getLoggerName())) {
                events.add(JSON.readTree(event.getFormattedMessage()));
            }
        }
        return events;
    }

    static JsonNode lastAuditEvent() {
        List<JsonNode> events = auditEvents();
        assertThat(events).isNotEmpty();
        return events.getLast();
    }

}
