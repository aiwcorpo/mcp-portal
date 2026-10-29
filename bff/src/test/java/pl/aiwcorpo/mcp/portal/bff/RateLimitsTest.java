package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.delete;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.put;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;

import com.github.tomakehurst.wiremock.client.MappingBuilder;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;
import pl.aiwcorpo.mcp.portal.bff.support.ContractSchemas;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;

/** Limits per session (CC-156): the BFF's own for a token write and the authenticator, and the limits of C4/C5 passed on. */
@TestPropertySource(properties = {
    "portal.limits.secret-write.max=3",
    "portal.limits.secret-write.window=60s",
    "portal.limits.authenticator.max=2",
    "portal.limits.authenticator.window=5m"})
class RateLimitsTest extends PortalHarness {

    private static final String SECRET = "/api/v1/connections/jira/secret";
    private static final String SECRET_TEMPLATE = "/api/v1/connections/{system}/secret";
    private static final String SECRET_BODY = "{\"secret\":\"test-only-token-rl\"}";
    private static final String AUTHENTICATOR = "/api/v1/authenticator";
    private static final String START = AUTHENTICATOR + "/enrollment";

    @AfterEach
    void defaultStubs() {
        BROKER.resetToDefaultMappings();
        BROKER.resetRequests();
        GATEWAY.resetToDefaultMappings();
    }

    private TestBrowser fresh() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        return browser;
    }

    private static int brokerCalls(String path) {
        return BROKER.findAll(anyRequestedFor(urlPathEqualTo(path))).size();
    }

    private static void stub(MappingBuilder builder, int status, String body, String retryAfter) {
        var response = aResponse().withStatus(status).withHeader("Content-Type", "application/json").withBody(body);
        if (retryAfter != null) {
            response = response.withHeader("Retry-After", retryAfter);
        }
        BROKER.stubFor(builder.atPriority(1).willReturn(response));
    }

    @Test
    void aTokenWriteOverTheLimitIsRefusedWithRetryAfterAndNeverReachesTheBroker() {
        SECRETS.add("test-only-token-rl");
        TestBrowser browser = fresh();
        int before = brokerCalls("/v1/connections/jira/secret");
        for (int i = 0; i < 3; i++) {
            HttpResponse<String> ok = browser.put(SECRET, SECRET_BODY, true);
            C12.assertResponse("PUT", SECRET_TEMPLATE, ok);
            assertThat(ok.statusCode()).isEqualTo(200);
        }

        HttpResponse<String> limited = browser.put(SECRET, SECRET_BODY, true);

        C12.assertResponse("PUT", SECRET_TEMPLATE, limited);
        assertThat(limited.statusCode()).isEqualTo(429);
        assertThat(JSON.readTree(limited.body()).get("error").asString()).isEqualTo("rate_limited");
        assertThat(JSON.readTree(limited.body()).get("requestId").asString())
                .isEqualTo(limited.headers().firstValue("X-Request-Id").orElseThrow());
        long retryAfter = Long.parseLong(limited.headers().firstValue("Retry-After").orElseThrow());
        assertThat(retryAfter).isBetween(1L, 60L);
        assertThat(limited.headers().map().keySet().stream().map(String::toLowerCase)).noneMatch(name -> name.startsWith("x-ratelimit"));
        assertThat(brokerCalls("/v1/connections/jira/secret") - before).isEqualTo(3);
        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("event").asString()).isEqualTo("connection_change");
        assertThat(event.get("reason").asString()).isEqualTo("rate_limited");
        assertThat(event.get("errorCode").asString()).isEqualTo("rate_limited");
        assertThat(event.get("outcome").asString()).isEqualTo("denied");

        clock.advance(Duration.ofSeconds(61));
        assertThat(browser.put(SECRET, SECRET_BODY, true).statusCode()).isEqualTo(200);
    }

    @Test
    void theLimitBelongsToTheSessionNotToTheUserAndRequestsThatNeverReachTheBrokerAreNotCounted() {
        TestBrowser first = fresh();
        for (String body : new String[] {"", "{}", "{\"secret\":5}", "not json", "{\"secret\":\"x\",\"y\":1}"}) {
            assertThat(first.put(SECRET, body, true).statusCode()).isEqualTo(400);
        }
        for (int i = 0; i < 3; i++) {
            assertThat(first.put(SECRET, SECRET_BODY, true).statusCode()).isEqualTo(200);
        }
        assertThat(first.put(SECRET, SECRET_BODY, true).statusCode()).isEqualTo(429);

        TestBrowser second = fresh();
        assertThat(second.put(SECRET, SECRET_BODY, true).statusCode()).isEqualTo(200);
    }

    @Test
    void authenticatorWritesShareOneWindowAndAStaleMfaIsNotCounted() {
        TestBrowser stale = login(ALICE, Instant.now().minus(Duration.ofHours(2)));
        stale.get("/api/v1/me");
        for (int i = 0; i < 4; i++) {
            HttpResponse<String> response = stale.post(START, null, true);
            assertThat(response.statusCode()).isEqualTo(401);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("step_up_required");
        }

        TestBrowser browser = fresh();
        assertThat(browser.delete(AUTHENTICATOR, true).statusCode()).isEqualTo(204);
        assertThat(browser.post(START, null, true).statusCode()).isEqualTo(201);
        int removals = brokerCalls("/v1/authenticator");

        HttpResponse<String> limited = browser.delete(AUTHENTICATOR, true);

        C12.assertResponse("DELETE", AUTHENTICATOR, limited);
        assertThat(limited.statusCode()).isEqualTo(429);
        assertThat(Long.parseLong(limited.headers().firstValue("Retry-After").orElseThrow())).isBetween(1L, 300L);
        assertThat(brokerCalls("/v1/authenticator")).isEqualTo(removals);
        HttpResponse<String> limitedStart = browser.post(START, null, true);
        C12.assertResponse("POST", START, limitedStart);
        assertThat(limitedStart.statusCode()).isEqualTo(429);
        HttpResponse<String> limitedConfirm = browser.post(START + "/confirm",
                "{\"enrollmentId\":\"enr_8Hq2Zk5LpW9vXc3N\",\"code\":\"938475\"}", true);
        assertThat(limitedConfirm.statusCode()).isEqualTo(429);
        ContractSchemas.assertValid(AUDIT, lastAuditEvent());
        // Reading the status is not a write.
        assertThat(browser.get(AUTHENTICATOR).statusCode()).isEqualTo(200);
    }

    @Test
    void theLimitOfTheBrokerIsPassedOnWithItsRetryAfter() {
        TestBrowser browser = fresh();
        stub(put(urlPathEqualTo("/v1/connections/jira/secret")), 429, "{\"error\":\"rate_limited\"}", "7");
        HttpResponse<String> secret = browser.put(SECRET, SECRET_BODY, true);
        C12.assertResponse("PUT", SECRET_TEMPLATE, secret);
        assertThat(secret.statusCode()).isEqualTo(429);
        assertThat(secret.headers().firstValue("Retry-After")).hasValue("7");
        assertThat(lastAuditEvent().get("reason").asString()).isEqualTo("rate_limited");

        stub(post(urlPathEqualTo("/v1/authenticator/enrollment")), 429, "{\"error\":\"rate_limited\"}", "600");
        HttpResponse<String> enrollment = browser.post(START, null, true);
        C12.assertResponse("POST", START, enrollment);
        assertThat(enrollment.statusCode()).isEqualTo(429);
        assertThat(enrollment.headers().firstValue("Retry-After")).hasValue("600");

        stub(post(urlPathEqualTo("/v1/connections/gitlab/oauth/start")), 429, "{\"error\":\"rate_limited\"}", "30");
        HttpResponse<String> oauth = browser.post("/api/v1/connections/gitlab/oauth", "{}", true);
        assertThat(oauth.statusCode()).isEqualTo(429);
        assertThat(oauth.headers().firstValue("Retry-After")).hasValue("30");
        assertThat(JSON.readTree(oauth.body()).get("error").asString()).isEqualTo("rate_limited");
    }

    @Test
    void aLimitWithoutAUsableRetryAfterLeavesTheHeaderOutAndTheGatewayLimitIsPassedOn() {
        // A new session per request: the BFF's own limit of three writes must not answer in place of the broker's.
        for (String header : new String[] {null, "soon", "Wed, 21 Oct 2026 07:28:00 GMT", "-5", "99999999999"}) {
            stub(put(urlPathEqualTo("/v1/connections/jira/secret")), 429, "{\"error\":\"rate_limited\"}", header);
            HttpResponse<String> response = fresh().put(SECRET, SECRET_BODY, true);
            assertThat(response.statusCode()).isEqualTo(429);
            assertThat(response.headers().firstValue("Retry-After")).as(String.valueOf(header)).isEmpty();
        }
        stub(put(urlPathEqualTo("/v1/connections/jira/secret")), 429, "{\"error\":\"rate_limited\"}", "0");
        assertThat(fresh().put(SECRET, SECRET_BODY, true).headers().firstValue("Retry-After")).hasValue("1");

        GATEWAY.stubFor(get(urlPathEqualTo("/admin/v1/catalog")).atPriority(1).willReturn(aResponse().withStatus(429)
                .withHeader("Retry-After", "12").withHeader("Content-Type", "application/json")
                .withBody("{\"error\":\"rate_limited\"}")));
        HttpResponse<String> catalog = fresh().get("/api/v1/catalog");
        assertThat(catalog.statusCode()).isEqualTo(429);
        assertThat(catalog.headers().firstValue("Retry-After")).hasValue("12");
    }

    @Test
    void aLimitNeedsAPositiveCountAndAWindowOfAtLeastASecond() {
        assertThatThrownBy(() -> new PortalProperties.SessionLimit(0, Duration.ofMinutes(1)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PortalProperties.SessionLimit(5, Duration.ofMillis(500)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(new PortalProperties.SessionLimit(5, Duration.ofSeconds(1)).max()).isEqualTo(5);
    }
}
