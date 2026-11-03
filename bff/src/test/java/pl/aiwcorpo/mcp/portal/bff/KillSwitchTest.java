package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.delete;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.put;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathMatching;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import com.github.tomakehurst.wiremock.verification.LoggedRequest;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.support.ContractSchemas;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;

/**
 * Emergency switch (A9, CC-194; C12 over C5): admin only, no second factor to switch off, a fresh MFA to lift, the
 * administrator's text checked and neutralized, and an audit event for every attempt that changed nothing.
 */
class KillSwitchTest extends PortalHarness {

    private static final String LIST = "/api/v1/admin/kill-switches";
    private static final String SERVER_TEMPLATE = "/api/v1/admin/registry/servers/{serverId}/kill-switch";
    private static final String TOOL_TEMPLATE = "/api/v1/admin/registry/servers/{serverId}/tools/{tool}/kill-switch";
    private static final String SERVER = "/api/v1/admin/registry/servers/mcp-jira/kill-switch";
    private static final String TOOL = "/api/v1/admin/registry/servers/mcp-jira/tools/update_issue/kill-switch";
    private static final String GATEWAY_LIST = "/admin/v1/kill-switches";
    private static final String GATEWAY_SERVER = "/admin/v1/registry/servers/mcp-jira/kill-switch";
    private static final String GATEWAY_TOOL = "/admin/v1/registry/servers/mcp-jira/tools/update_issue/kill-switch";
    private static final Map<String, String> SAME_ORIGIN = Map.of("Sec-Fetch-Site", "same-origin");
    private static final String REASON = "{\"reason\":\"Issue updates corrupt the workflow\"}";

    @AfterEach
    void defaultStubs() {
        GATEWAY.resetToDefaultMappings();
        GATEWAY.resetRequests();
    }

    private TestBrowser admin() {
        TestBrowser browser = login(CAROL, Instant.now());
        browser.get("/api/v1/me");
        return browser;
    }

    private TestBrowser adminWithStaleLogin() {
        TestBrowser browser = login(CAROL, Instant.now().minus(Duration.ofHours(2)));
        browser.get("/api/v1/me");
        return browser;
    }

    private static List<LoggedRequest> switchRequests() {
        return GATEWAY.findAll(anyRequestedFor(urlPathMatching("/admin/v1/registry/servers/.*/kill-switch")));
    }

    private static void stubSwitch(String method, String path, int status, String body) {
        var mapping = "PUT".equals(method) ? put(urlPathEqualTo(path)) : delete(urlPathEqualTo(path));
        GATEWAY.stubFor(mapping.atPriority(1).willReturn(aResponse().withStatus(status)
                .withHeader("Content-Type", "application/json").withBody(body)));
    }

    private static void stubList(int status, String body) {
        GATEWAY.stubFor(get(urlPathEqualTo(GATEWAY_LIST)).atPriority(1).willReturn(aResponse().withStatus(status)
                .withHeader("Content-Type", "application/json").withBody(body)));
    }

    @Test
    void theActiveSwitchesAreListedForAnAdmin() {
        JsonNode example = C12.responseExample("GET", LIST, 200, "one_switch");
        stubList(200, example.toString());

        HttpResponse<String> response = admin().get(LIST);

        C12.assertResponse("GET", LIST, response);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(JSON.readTree(response.body())).isEqualTo(example);
        assertThat(GATEWAY.findAll(anyRequestedFor(urlPathEqualTo(GATEWAY_LIST))).getLast().getHeader("Authorization"))
                .startsWith("Bearer xt-mcp-gateway-admin-");
    }

    @Test
    void theDefaultAnswerOfTheGatewayMockPassesTheChecks() {
        HttpResponse<String> response = admin().get(LIST);

        C12.assertResponse("GET", LIST, response);
        assertThat(response.statusCode()).isEqualTo(200);
    }

    @Test
    void hiddenCharactersInAReasonAreWrittenOutAndALoneToolOnAServerSwitchIsRefused() {
        stubList(200, "{\"switches\":[{\"scope\":\"server\",\"serverId\":\"mcp-jira\",\"setBy\":\"s\","
                + "\"setAt\":\"2026-11-03T09:12:44Z\",\"reason\":\"a\\u202Eb\"}]}");
        TestBrowser browser = admin();

        HttpResponse<String> response = browser.get(LIST);

        C12.assertResponse("GET", LIST, response);
        assertThat(JSON.readTree(response.body()).get("switches").get(0).get("reason").asString()).isEqualTo("a<U+202E>b");
        for (String broken : List.of(
                "{\"scope\":\"server\",\"serverId\":\"mcp-jira\",\"tool\":\"update_issue\",\"setBy\":\"s\",\"setAt\":\"2026-11-03T09:12:44Z\",\"reason\":\"r\"}",
                "{\"scope\":\"tool\",\"serverId\":\"mcp-jira\",\"setBy\":\"s\",\"setAt\":\"2026-11-03T09:12:44Z\",\"reason\":\"r\"}",
                "{\"scope\":\"tool\",\"serverId\":\"mcp-other\",\"tool\":\"update_issue\",\"setBy\":\"s\",\"setAt\":\"2026-11-03T09:12:44Z\",\"reason\":\"r\"}",
                "{\"scope\":\"server\",\"serverId\":\"mcp-jira\",\"setBy\":\"s\",\"setAt\":\"soon\",\"reason\":\"r\"}",
                "{\"scope\":\"server\",\"serverId\":\"mcp-jira\",\"setBy\":\"s\",\"setAt\":\"2026-11-03T09:12:44Z\",\"reason\":\"\"}",
                "{\"scope\":\"server\",\"serverId\":\"mcp-jira\",\"setBy\":\"s\",\"setAt\":\"2026-11-03T09:12:44Z\",\"reason\":\"r\",\"extra\":1}")) {
            stubList(200, "{\"switches\":[" + broken + "]}");
            assertThat(browser.get(LIST).statusCode()).as(broken).isEqualTo(503);
        }
        stubList(200, "[]");
        assertThat(browser.get(LIST).statusCode()).isEqualTo(503);
    }

    @Test
    void aUserWithoutTheAdminGroupGetsForbiddenAnswersWithoutAnyCallToTheGateway() {
        TestBrowser alice = login(ALICE, Instant.now());
        alice.get("/api/v1/me");
        Map<String, String> headers = SAME_ORIGIN;

        List<HttpResponse<String>> responses = List.of(alice.get(LIST), alice.put(SERVER, REASON, true),
                alice.delete(SERVER, true, headers), alice.put(TOOL, REASON, true), alice.delete(TOOL, true, headers));

        for (HttpResponse<String> response : responses) {
            assertThat(response.statusCode()).isEqualTo(403);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("access_denied");
        }
        assertThat(GATEWAY.findAll(anyRequestedFor(urlPathMatching("/admin/v1/(kill-switches|registry/servers/.*/kill-switch)"))))
                .isEmpty();
        JsonNode event = lastAuditEvent();
        assertThat(event.get("event").asString()).isEqualTo("admin_change");
        assertThat(event.get("decision").asString()).isEqualTo("deny");
        assertThat(event.get("server").asString()).isEqualTo("mcp-jira");
        ContractSchemas.assertValid(AUDIT, event);
    }

    @Test
    void switchingOffNeedsNoFreshMfaAndTheReasonGoesToTheGatewayUntouched() {
        TestBrowser stale = adminWithStaleLogin();
        int eventsBefore = auditEvents().size();

        HttpResponse<String> server = stale.put(SERVER, REASON, true);
        HttpResponse<String> tool = stale.put(TOOL, REASON, true);

        C12.assertResponse("PUT", SERVER_TEMPLATE, server);
        C12.assertResponse("PUT", TOOL_TEMPLATE, tool);
        assertThat(server.statusCode()).isEqualTo(204);
        assertThat(tool.statusCode()).isEqualTo(204);
        List<LoggedRequest> sent = switchRequests();
        assertThat(sent).hasSize(2);
        assertThat(sent.get(0).getUrl()).isEqualTo(GATEWAY_SERVER);
        assertThat(sent.get(1).getUrl()).isEqualTo(GATEWAY_TOOL);
        for (LoggedRequest request : sent) {
            assertThat(JSON.readTree(request.getBodyAsString())).isEqualTo(JSON.readTree(REASON));
            assertThat(request.getHeader("Authorization")).startsWith("Bearer xt-mcp-gateway-admin-");
        }
        // The gateway records kill_switch_set; the portal adds no second event for a switch that was changed.
        assertThat(auditEvents().subList(eventsBefore, auditEvents().size()))
                .noneMatch(event -> "admin_change".equals(event.get("event").asString()));
    }

    @Test
    void aReasonThatIsNotAKillSwitchRequestNeverReachesTheGateway() {
        TestBrowser browser = admin();
        for (String body : List.of("", "{}", "{\"reason\":\"\"}", "{\"reason\":5}", "{\"reason\":null}",
                "{\"reason\":\"" + "x".repeat(201) + "\"}", "{\"reason\":\"a\\u202Eb\"}", "{\"reason\":\"line\\nbreak\"}",
                "{\"reason\":\"r\",\"extra\":true}", "not json")) {
            HttpResponse<String> server = browser.put(SERVER, body, true);
            HttpResponse<String> tool = browser.put(TOOL, body, true);
            C12.assertResponse("PUT", SERVER_TEMPLATE, server);
            C12.assertResponse("PUT", TOOL_TEMPLATE, tool);
            assertThat(server.statusCode()).as(body).isEqualTo(400);
            assertThat(tool.statusCode()).as(body).isEqualTo(400);
        }
        assertThat(switchRequests()).isEmpty();
        assertThat(browser.put(SERVER, "{\"reason\":\"" + "x".repeat(200) + "\"}", true).statusCode()).isEqualTo(204);
        assertThat(lastAuditEvent().get("outcome").asString()).isEqualTo("error");
    }

    @Test
    void liftingNeedsAFreshMfaAndTheStepUpComesBackToThePageThatSentIt() {
        TestBrowser stale = adminWithStaleLogin();

        HttpResponse<String> refused = stale.delete(SERVER, true, Map.of("Sec-Fetch-Site", "same-origin", "Referer", "https://mcp-gateway.internal/admin/kill-switches"));
        HttpResponse<String> refusedTool = stale.delete(TOOL, true, SAME_ORIGIN);

        C12.assertResponse("DELETE", SERVER_TEMPLATE, refused);
        C12.assertResponse("DELETE", TOOL_TEMPLATE, refusedTool);
        assertThat(refused.statusCode()).isEqualTo(401);
        JsonNode body = JSON.readTree(refused.body());
        assertThat(body.get("error").asString()).isEqualTo("step_up_required");
        assertThat(body.get("stepUpUrl").asString()).isEqualTo("/api/v1/auth/login?stepUp=true&returnPath=/admin/kill-switches");
        assertThat(JSON.readTree(refusedTool.body()).get("stepUpUrl").asString())
                .isEqualTo("/api/v1/auth/login?stepUp=true&returnPath=/admin");
        assertThat(switchRequests()).isEmpty();
        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("outcome").asString()).isEqualTo("denied");
        assertThat(event.get("errorCode").asString()).isEqualTo("step_up_required");
        assertThat(event.get("tool").asString()).isEqualTo("update_issue");
    }

    @Test
    void aFreshMfaLiftsTheSwitchOfAServerAndOfATool() {
        TestBrowser browser = admin();

        HttpResponse<String> server = browser.delete(SERVER, true, SAME_ORIGIN);
        HttpResponse<String> tool = browser.delete(TOOL, true, SAME_ORIGIN);

        C12.assertResponse("DELETE", SERVER_TEMPLATE, server);
        C12.assertResponse("DELETE", TOOL_TEMPLATE, tool);
        assertThat(server.statusCode()).isEqualTo(204);
        assertThat(tool.statusCode()).isEqualTo(204);
        List<LoggedRequest> sent = switchRequests();
        assertThat(sent).extracting(LoggedRequest::getUrl).containsExactly(GATEWAY_SERVER, GATEWAY_TOOL);
        assertThat(sent).allMatch(request -> request.getBody().length == 0);
    }

    @Test
    void anUnknownServerOrToolIsNotFoundAndNothingIsSent() {
        TestBrowser browser = admin();
        for (String path : List.of("/api/v1/admin/registry/servers/mcp-other/kill-switch",
                "/api/v1/admin/registry/servers/mcp-jira/tools/Update-Issue/kill-switch",
                "/api/v1/admin/registry/servers/mcp-jira/tools/a__b/kill-switch")) {
            HttpResponse<String> put = browser.put(path, REASON, true);
            HttpResponse<String> delete = browser.delete(path, true, SAME_ORIGIN);
            assertThat(put.statusCode()).as(path).isEqualTo(404);
            assertThat(delete.statusCode()).as(path).isEqualTo(404);
            assertThat(JSON.readTree(put.body()).get("error").asString()).isEqualTo("not_found_or_denied");
        }
        assertThat(switchRequests()).isEmpty();
    }

    @Test
    void liftingNeedsTheRequestToComeFromThePortalPage() {
        TestBrowser browser = admin();
        for (Map<String, String> headers : List.of(Map.<String, String>of(), Map.of("Sec-Fetch-Site", "cross-site"),
                Map.of("Sec-Fetch-Site", "same-site"))) {
            HttpResponse<String> response = browser.delete(SERVER, true, headers);
            C12.assertResponse("DELETE", SERVER_TEMPLATE, response);
            assertThat(response.statusCode()).isEqualTo(403);
        }
        assertThat(switchRequests()).isEmpty();
        assertThat(browser.put(SERVER, REASON, true).statusCode()).as("switching off is not restricted").isEqualTo(204);
    }

    @Test
    void anUnreadableSwitchStoreMakesTheCatalog503WithoutAnyDetail() {
        GATEWAY.stubFor(get(urlPathEqualTo("/admin/v1/catalog")).atPriority(1).willReturn(aResponse().withStatus(503)
                .withHeader("Retry-After", "10").withHeader("Content-Type", "application/json")
                .withBody("{\"error\":\"upstream_unavailable\",\"message\":\"switch table kill_switches unreadable\"}")));

        HttpResponse<String> response = admin().get("/api/v1/catalog");

        C12.assertResponse("GET", "/api/v1/catalog", response);
        assertThat(response.statusCode()).isEqualTo(503);
        assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("upstream_unavailable");
        assertThat(response.body()).doesNotContain("kill_switches");
    }

    @Test
    void theCsrfHeaderIsRequired() {
        TestBrowser browser = admin();

        assertThat(browser.put(SERVER, REASON, false).statusCode()).isEqualTo(403);
        assertThat(browser.delete(TOOL, false, SAME_ORIGIN).statusCode()).isEqualTo(403);
        assertThat(switchRequests()).isEmpty();
    }

    @Test
    void gatewayAnswersAreMappedToTheContractStatusesAndAuditedWhenNothingChanged() {
        TestBrowser browser = admin();
        stubSwitch("PUT", GATEWAY_TOOL, 404, "{\"error\":\"not_found_or_denied\"}");
        HttpResponse<String> missing = browser.put(TOOL, REASON, true);
        C12.assertResponse("PUT", TOOL_TEMPLATE, missing);
        assertThat(missing.statusCode()).isEqualTo(404);
        assertThat(lastAuditEvent().get("errorCode").asString()).isEqualTo("not_found_or_denied");

        stubSwitch("PUT", GATEWAY_TOOL, 403, "{\"error\":\"access_denied\"}");
        HttpResponse<String> denied = browser.put(TOOL, REASON, true);
        C12.assertResponse("PUT", TOOL_TEMPLATE, denied);
        assertThat(denied.statusCode()).isEqualTo(403);

        stubSwitch("PUT", GATEWAY_TOOL, 400, "{\"error\":\"invalid_request\"}");
        HttpResponse<String> rejected = browser.put(TOOL, REASON, true);
        C12.assertResponse("PUT", TOOL_TEMPLATE, rejected);
        assertThat(rejected.statusCode()).isEqualTo(400);

        stubSwitch("PUT", GATEWAY_TOOL, 503, "{\"error\":\"upstream_unavailable\",\"message\":\"database host db-1 refused\"}");
        HttpResponse<String> unavailable = browser.put(TOOL, REASON, true);
        C12.assertResponse("PUT", TOOL_TEMPLATE, unavailable);
        assertThat(unavailable.statusCode()).isEqualTo(503);
        assertThat(unavailable.body()).doesNotContain("db-1");
        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("errorCode").asString()).isEqualTo("upstream_unavailable");

        stubSwitch("DELETE", GATEWAY_SERVER, 503, "{\"error\":\"upstream_unavailable\"}");
        HttpResponse<String> notLifted = browser.delete(SERVER, true, SAME_ORIGIN);
        C12.assertResponse("DELETE", SERVER_TEMPLATE, notLifted);
        assertThat(notLifted.statusCode()).isEqualTo(503);
    }

    @Test
    void theReasonNeverReachesTheAuditLog() {
        TestBrowser browser = admin();
        stubSwitch("PUT", GATEWAY_SERVER, 503, "{\"error\":\"upstream_unavailable\"}");

        browser.put(SERVER, "{\"reason\":\"vendor incident INC-4711\"}", true);

        assertThat(auditEvents()).isNotEmpty().noneMatch(event -> event.toString().contains("INC-4711"));
    }
}
