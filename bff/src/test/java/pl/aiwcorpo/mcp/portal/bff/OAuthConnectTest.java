package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.anyUrl;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.github.tomakehurst.wiremock.verification.LoggedRequest;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.support.ConnectRedirectRules;
import pl.aiwcorpo.mcp.portal.bff.support.ContractSchemas;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;

/** Connecting an account through OAuth: start, callback, and every way the callback can go wrong (CC-086). */
class OAuthConnectTest extends PortalHarness {

    private static final String START = "/v1/connections/gitlab/oauth/start";
    private static final String COMPLETE = "/v1/connections/gitlab/oauth/complete";
    private static final String CALLBACK = "/api/v1/oauth/callback";

    @AfterEach
    void defaultStubs() {
        BROKER.resetToDefaultMappings();
    }

    private static String authorizeUrl(String state) {
        return "https://gitlab.internal/oauth/authorize?client_id=mcp-broker&response_type=code&state=" + state
                + "&code_challenge=Zx8-test&code_challenge_method=S256&redirect_uri=https%3A%2F%2Fmcp.aiwcorpo.pl%2Fapi%2Fv1%2Foauth%2Fcallback";
    }

    private static void stubStart(String authorize, String flowId) {
        BROKER.stubFor(post(urlPathEqualTo(START)).atPriority(1).willReturn(aResponse().withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"authorizeUrl\":\"" + authorize + "\",\"flowId\":\"" + flowId + "\"}")));
    }

    private static void stubComplete(int status, String body) {
        BROKER.stubFor(post(urlPathEqualTo(COMPLETE)).atPriority(1).willReturn(aResponse().withStatus(status)
                .withHeader("Content-Type", "application/json").withBody(body)));
    }

    private static List<LoggedRequest> completions() {
        return BROKER.findAll(postRequestedFor(urlPathEqualTo(COMPLETE)));
    }

    private static String location(HttpResponse<String> response) {
        return response.headers().firstValue("Location").orElseThrow();
    }

    private static HttpResponse<String> start(TestBrowser browser, String body) {
        browser.get("/api/v1/me");
        return browser.post("/api/v1/connections/gitlab/oauth", body, true);
    }

    private static String state() {
        return "st-" + UUID.randomUUID();
    }

    @Test
    void startReturnsOnlyTheProviderUrlAndKeepsTheFlowServerSide() {
        String state = state();
        stubStart(authorizeUrl(state), "flow-secret-id-1");
        TestBrowser browser = login(ALICE, Instant.now());

        HttpResponse<String> response = start(browser, "{\"returnPath\":\"/catalog?view=all\"}");

        C12.assertResponse("POST", "/api/v1/connections/{system}/oauth", response);
        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode body = JSON.readTree(response.body());
        assertThat(body.get("authorizeUrl").asString()).isEqualTo(authorizeUrl(state));
        assertThat(response.body()).doesNotContain("flow-secret-id-1").doesNotContain("flowId");
        LoggedRequest sent = BROKER.findAll(postRequestedFor(urlPathEqualTo(START))).getLast();
        C4.assertComponent("OAuthStartRequest", JSON.readTree(sent.getBodyAsString()));
        assertThat(JSON.readTree(sent.getBodyAsString()).get("returnPath").asString()).isEqualTo("/catalog?view=all");
        assertThat(sent.getHeader("Authorization")).startsWith("Bearer xt-mcp-credential-broker-");
        assertThat(sent.getHeader("X-Request-Id")).isEqualTo(response.headers().firstValue("X-Request-Id").orElseThrow());
    }

    @Test
    void startWithoutBodyUsesTheStartPage() {
        stubStart(authorizeUrl(state()), "flow-1");
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");

        HttpResponse<String> response = browser.post("/api/v1/connections/gitlab/oauth", null, true);

        C12.assertResponse("POST", "/api/v1/connections/{system}/oauth", response);
        assertThat(response.statusCode()).isEqualTo(200);
        LoggedRequest sent = BROKER.findAll(postRequestedFor(urlPathEqualTo(START))).getLast();
        assertThat(JSON.readTree(sent.getBodyAsString()).get("returnPath").asString()).isEqualTo("/");
    }

    @Test
    void startRefusesWhatTheContractDoesNot() {
        stubStart(authorizeUrl(state()), "flow-1");
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        int before = BROKER.findAll(anyRequestedFor(anyUrl())).size();

        for (String body : List.of("{\"returnPath\":\"//evil.test/x\"}", "{\"returnPath\":\"https://evil.test/\"}",
                "{\"returnPath\":\"/a%2Fb\"}", "{\"returnPath\":\"/ok\",\"flowId\":\"x\"}", "not json", "[]", "null")) {
            HttpResponse<String> response = browser.post("/api/v1/connections/gitlab/oauth", body, true);
            C12.assertResponse("POST", "/api/v1/connections/{system}/oauth", response);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
        }
        HttpResponse<String> unknownSystem = browser.post("/api/v1/connections/sharepoint/oauth", "{}", true);
        assertThat(unknownSystem.statusCode()).isEqualTo(400);
        assertThat(BROKER.findAll(anyRequestedFor(anyUrl()))).hasSize(before);
    }

    @Test
    void startNeedsSessionAndCsrfHeader() {
        TestBrowser stranger = browser();
        stranger.get("/api/v1/me");
        HttpResponse<String> anonymous = stranger.post("/api/v1/connections/gitlab/oauth", "{}", true);
        C12.assertResponse("POST", "/api/v1/connections/{system}/oauth", anonymous);
        assertThat(anonymous.statusCode()).isEqualTo(401);

        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        HttpResponse<String> noHeader = browser.post("/api/v1/connections/gitlab/oauth", "{}", false);
        C12.assertResponse("POST", "/api/v1/connections/{system}/oauth", noHeader);
        assertThat(noHeader.statusCode()).isEqualTo(403);
        assertThat(BROKER.findAll(postRequestedFor(urlPathEqualTo(START)))).isEmpty();
    }

    @Test
    void brokerAnswersThatCannotBeSentToTheBrowserAreServiceUnavailable() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        for (String url : List.of("javascript:alert(1)", "https://user:pw@gitlab.internal/oauth/authorize?state=s",
                "https://gitlab.internal/oauth/authorize?client_id=x", "not a url")) {
            stubStart(url, "flow-1");
            HttpResponse<String> response = browser.post("/api/v1/connections/gitlab/oauth", "{}", true);
            C12.assertResponse("POST", "/api/v1/connections/{system}/oauth", response);
            assertThat(response.statusCode()).as(url).isEqualTo(503);
            assertThat(response.body()).doesNotContain("gitlab.internal").doesNotContain("javascript");
        }
        stubStart(authorizeUrl(state()), "");
        assertThat(browser.post("/api/v1/connections/gitlab/oauth", "{}", true).statusCode()).isEqualTo(503);
    }

    @Test
    void callbackCompletesTheFlowAndReturnsToThePortalPath() {
        String state = state();
        stubStart(authorizeUrl(state), "flow-77");
        stubComplete(200, "{\"status\":\"connected\",\"backendUser\":\"alice\"}");
        TestBrowser browser = login(ALICE, Instant.now());
        start(browser, "{\"returnPath\":\"/catalog\"}");
        String code = "test-only-code-" + UUID.randomUUID();
        SECRETS.add(code);

        HttpResponse<String> back = browser.get(CALLBACK + "?code=" + code + "&state=" + state);

        C12.assertResponse("GET", "/api/v1/oauth/callback", back);
        assertThat(back.statusCode()).isEqualTo(302);
        assertThat(location(back)).isEqualTo("/catalog?connected=gitlab");
        assertThat(ConnectRedirectRules.isValid(location(back))).isTrue();
        assertThat(back.headers().firstValue("Cache-Control").orElse("")).contains("no-store");
        LoggedRequest sent = completions().getLast();
        C4.assertComponent("OAuthCompleteRequest", JSON.readTree(sent.getBodyAsString()));
        JsonNode body = JSON.readTree(sent.getBodyAsString());
        assertThat(body.get("flowId").asString()).isEqualTo("flow-77");
        assertThat(body.get("code").asString()).isEqualTo(code);
        assertThat(body.get("state").asString()).isEqualTo(state);
        assertThat(sent.getHeader("Authorization")).startsWith("Bearer xt-mcp-credential-broker-");
        assertThat(sent.getHeader("X-Request-Id")).isEqualTo(back.headers().firstValue("X-Request-Id").orElseThrow());

        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("event").asString()).isEqualTo("connection_change");
        assertThat(event.get("server").asString()).isEqualTo("mcp-gitlab");
        assertThat(event.get("outcome").asString()).isEqualTo("ok");
        assertThat(event.get("requestId").asString()).isEqualTo(back.headers().firstValue("X-Request-Id").orElseThrow());
    }

    @Test
    void returnPathWithAQueryGetsAnAmpersand() {
        String state = state();
        stubStart(authorizeUrl(state), "flow-q");
        stubComplete(200, "{\"status\":\"connected\",\"backendUser\":\"alice\"}");
        TestBrowser browser = login(ALICE, Instant.now());
        start(browser, "{\"returnPath\":\"/connect/gitlab?step=2\"}");

        HttpResponse<String> back = browser.get(CALLBACK + "?code=c1&state=" + state);

        assertThat(location(back)).isEqualTo("/connect/gitlab?step=2&connected=gitlab");
        assertThat(ConnectRedirectRules.isValid(location(back))).isTrue();
    }

    @Test
    void aFlowCanBeUsedOnlyOnce() {
        String state = state();
        stubStart(authorizeUrl(state), "flow-once");
        stubComplete(200, "{\"status\":\"connected\",\"backendUser\":\"alice\"}");
        TestBrowser browser = login(ALICE, Instant.now());
        start(browser, "{\"returnPath\":\"/catalog\"}");
        browser.get(CALLBACK + "?code=c1&state=" + state);
        int completed = completions().size();

        HttpResponse<String> replay = browser.get(CALLBACK + "?code=c2&state=" + state);

        assertThat(location(replay)).isEqualTo("/?connectError=flow_invalid");
        assertThat(completions()).hasSize(completed);
    }

    @Test
    void anotherUsersLinkDoesNotCompleteAnything() {
        String state = state();
        stubStart(authorizeUrl(state), "flow-alice");
        stubComplete(200, "{\"status\":\"connected\",\"backendUser\":\"mallory\"}");
        TestBrowser alice = login(ALICE, Instant.now());
        start(alice, "{\"returnPath\":\"/catalog\"}");
        TestBrowser bob = login(BOB, Instant.now());
        bob.get("/api/v1/me");
        int completed = completions().size();

        // Bob follows a callback link made from Alice's state (CSRF on the connection flow).
        HttpResponse<String> foreign = bob.get(CALLBACK + "?code=attacker-code&state=" + state);

        C12.assertResponse("GET", "/api/v1/oauth/callback", foreign);
        assertThat(location(foreign)).isEqualTo("/?connectError=flow_invalid");
        assertThat(completions()).hasSize(completed);
        // Alice's own flow is untouched by that attempt.
        HttpResponse<String> own = alice.get(CALLBACK + "?code=c1&state=" + state);
        assertThat(location(own)).isEqualTo("/catalog?connected=gitlab");
    }

    @Test
    void unknownOrMissingStateIsFlowInvalid() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        int completed = completions().size();
        for (String query : List.of("?code=c1&state=never-issued", "?code=c1", "?state=", "")) {
            HttpResponse<String> response = browser.get(CALLBACK + query);
            C12.assertResponse("GET", "/api/v1/oauth/callback", response);
            assertThat(location(response)).as(query).isEqualTo("/?connectError=flow_invalid");
        }
        assertThat(completions()).hasSize(completed);
        assertThat(lastAuditEvent().get("reason").asString()).isEqualTo("flow_invalid");
    }

    @Test
    void userCancellingAtTheProviderIsCancelled() {
        String state = state();
        stubStart(authorizeUrl(state), "flow-c");
        TestBrowser browser = login(ALICE, Instant.now());
        start(browser, "{\"returnPath\":\"/catalog\"}");
        int completed = completions().size();

        HttpResponse<String> back = browser.get(CALLBACK + "?error=access_denied&state=" + state);

        C12.assertResponse("GET", "/api/v1/oauth/callback", back);
        assertThat(location(back)).isEqualTo("/catalog?connectError=cancelled");
        assertThat(ConnectRedirectRules.isValid(location(back))).isTrue();
        assertThat(completions()).hasSize(completed);
    }

    @Test
    void anyOtherProviderErrorIsProviderErrorWithoutDetails() {
        String state = state();
        stubStart(authorizeUrl(state), "flow-p");
        TestBrowser browser = login(ALICE, Instant.now());
        start(browser, "{\"returnPath\":\"/catalog\"}");

        HttpResponse<String> back = browser.get(CALLBACK + "?error=server_error&error_description=invalid_client_secret_abc&state=" + state);

        assertThat(location(back)).isEqualTo("/catalog?connectError=provider_error");
        assertThat(back.headers().map().toString()).doesNotContain("invalid_client_secret_abc");
    }

    @Test
    void identityMismatchAndFlowInvalidFromTheBrokerArePassedAsCodes() {
        TestBrowser browser = login(ALICE, Instant.now());
        for (String error : List.of("identity_mismatch", "flow_invalid")) {
            String state = state();
            stubStart(authorizeUrl(state), "flow-" + error);
            stubComplete(422, "{\"error\":\"" + error + "\"}");
            start(browser, "{\"returnPath\":\"/catalog\"}");

            HttpResponse<String> back = browser.get(CALLBACK + "?code=c1&state=" + state);

            assertThat(location(back)).isEqualTo("/catalog?connectError=" + error);
            assertThat(ConnectRedirectRules.isValid(location(back))).isTrue();
            JsonNode event = lastAuditEvent();
            ContractSchemas.assertValid(AUDIT, event);
            assertThat(event.get("reason").asString()).isEqualTo(error);
            assertThat(event.get("outcome").asString()).isEqualTo("error");
        }
    }

    @Test
    void brokerFailureIsProviderErrorAndNeverShowsItsText() {
        for (int status : List.of(503, 500, 403)) {
            String state = state();
            stubStart(authorizeUrl(state), "flow-f" + status);
            stubComplete(status, "{\"error\":\"upstream_unavailable\",\"message\":\"jira.corp.internal exploded\"}");
            TestBrowser browser = login(ALICE, Instant.now());
            start(browser, "{\"returnPath\":\"/catalog\"}");

            HttpResponse<String> back = browser.get(CALLBACK + "?code=c1&state=" + state);

            assertThat(location(back)).as("status " + status).isEqualTo("/catalog?connectError=provider_error");
            assertThat(back.headers().map().toString()).doesNotContain("exploded");
            assertThat(lastAuditEvent().get("reason").asString()).isEqualTo("upstream_unavailable");
        }
    }

    @Test
    void callbackWithoutASessionGoesToTheLoginErrorPage() {
        int before = BROKER.findAll(anyRequestedFor(anyUrl())).size();

        HttpResponse<String> response = browser().get(CALLBACK + "?code=c1&state=whatever", Map.of("Accept", "application/json"));

        C12.assertResponse("GET", "/api/v1/oauth/callback", response);
        assertThat(response.statusCode()).isEqualTo(302);
        assertThat(location(response)).isEqualTo("/?loginError=session_expired");
        assertThat(ConnectRedirectRules.isValid(location(response))).isTrue();
        assertThat(response.body()).isEmpty();
        assertThat(BROKER.findAll(anyRequestedFor(anyUrl()))).hasSize(before);
    }

    @Test
    void callbackAfterTheSessionEndedGoesToTheLoginErrorPage() {
        String state = state();
        stubStart(authorizeUrl(state), "flow-late");
        TestBrowser browser = login(ALICE, Instant.now());
        start(browser, "{\"returnPath\":\"/catalog\"}");
        browser.post("/api/v1/auth/logout", null, true);

        HttpResponse<String> response = browser.get(CALLBACK + "?code=c1&state=" + state);

        assertThat(location(response)).isEqualTo("/?loginError=session_expired");
        assertThat(completions().stream().filter(r -> r.getBodyAsString().contains("flow-late"))).isEmpty();
    }
}
