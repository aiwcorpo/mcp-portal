package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathMatching;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.List;

import com.github.tomakehurst.wiremock.verification.LoggedRequest;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.support.ContractSchemas;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;

/** Registry administration (C12 over C5): admin only, checked views, neutralized definition text, approval with its audit. */
class RegistryAdminTest extends PortalHarness {

    private static final String REGISTRY = "/api/v1/admin/registry";
    private static final String PENDING_TEMPLATE = "/api/v1/admin/registry/servers/{serverId}/tools/{tool}/pending";
    private static final String APPROVE_TEMPLATE = "/api/v1/admin/registry/servers/{serverId}/tools/{tool}/approve";
    private static final String PENDING = "/api/v1/admin/registry/servers/mcp-jira/tools/update_issue/pending";
    private static final String APPROVE = "/api/v1/admin/registry/servers/mcp-jira/tools/update_issue/approve";
    private static final String GATEWAY_REGISTRY = "/admin/v1/registry/servers";
    private static final String HASH = "sha256:a8f67fd1227b134a398c4ffabfc32ebf9a64dbc15c4e9001b288341990e44aeb";
    private static final String BODY = "{\"definitionHash\":\"" + HASH + "\"}";

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

    private static List<LoggedRequest> gatewayRegistryRequests() {
        return GATEWAY.findAll(anyRequestedFor(urlPathMatching(GATEWAY_REGISTRY + ".*")));
    }

    private static void stubGet(String path, int status, String body) {
        GATEWAY.stubFor(get(urlPathEqualTo(path)).atPriority(1).willReturn(aResponse().withStatus(status)
                .withHeader("Content-Type", "application/json").withBody(body)));
    }

    private static void stubApprove(int status, String body) {
        GATEWAY.stubFor(post(urlPathMatching(GATEWAY_REGISTRY + "/.*/approve")).atPriority(1).willReturn(aResponse()
                .withStatus(status).withHeader("Content-Type", "application/json").withBody(body)));
    }

    @Test
    void theRegistryIsShownToAnAdminWithTheStatusSourceAndVersions() {
        HttpResponse<String> response = admin().get(REGISTRY);

        C12.assertResponse("GET", REGISTRY, response);
        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode tools = JSON.readTree(response.body()).get(0).get("tools");
        JsonNode pending = null;
        for (JsonNode tool : tools) {
            if ("pending_approval".equals(tool.get("status").asString())) {
                pending = tool;
            }
        }
        assertThat(pending).isNotNull();
        assertThat(pending.get("change").asString()).isIn("new", "changed");
        assertThat(pending.get("source").asString()).isIn("ci", "server");
        LoggedRequest sent = gatewayRegistryRequests().getLast();
        assertThat(sent.getHeader("Authorization")).startsWith("Bearer xt-mcp-gateway-admin-");
    }

    @Test
    void aUserWithoutTheAdminGroupGetsAForbiddenAnswerWithoutAnyCallToTheGateway() {
        TestBrowser alice = login(ALICE, Instant.now());
        alice.get("/api/v1/me");

        for (HttpResponse<String> response : List.of(alice.get(REGISTRY), alice.get(PENDING),
                alice.post(APPROVE, BODY, true))) {
            assertThat(response.statusCode()).isEqualTo(403);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("access_denied");
            assertThat(response.headers().firstValue("X-Request-Id")).isPresent();
        }
        C12.assertResponse("GET", REGISTRY, alice.get(REGISTRY));
        assertThat(gatewayRegistryRequests()).isEmpty();
        JsonNode event = lastAuditEvent();
        assertThat(event.get("event").asString()).isEqualTo("admin_change");
        assertThat(event.get("decision").asString()).isEqualTo("deny");
        ContractSchemas.assertValid(AUDIT, event);
    }

    @Test
    void theDiffCarriesBothEntriesTheVersionsAndTheSource() {
        HttpResponse<String> response = admin().get(PENDING);

        C12.assertResponse("GET", PENDING_TEMPLATE, response);
        JsonNode pending = JSON.readTree(response.body());
        assertThat(pending.get("pendingVersion").asString()).isNotEmpty();
        assertThat(pending.get("source").asString()).isIn("ci", "server");
        assertThat(pending.get("pendingHash").asString()).isEqualTo(pending.get("pendingEntry").get("definitionHash").asString());
    }

    @Test
    void aDefinitionChangedOnTheServerShowsItsSourceAndKeepsTheHashes() {
        JsonNode example = C12.responseExample("GET", PENDING_TEMPLATE, 200, "changed_on_server");
        stubGet(GATEWAY_REGISTRY + "/mcp-jira/tools/update_issue/pending", 200, example.toString());

        HttpResponse<String> response = admin().get(PENDING);

        C12.assertResponse("GET", PENDING_TEMPLATE, response);
        JsonNode pending = JSON.readTree(response.body());
        assertThat(pending.get("source").asString()).isEqualTo("server");
        assertThat(pending.get("pendingHash").asString()).isEqualTo(example.get("pendingHash").asString());
        assertThat(pending.get("approvedEntry").get("definition").get("description").asString())
                .isNotEqualTo(pending.get("pendingEntry").get("definition").get("description").asString());
    }

    @Test
    void hiddenCharactersInADefinitionAreWrittenOutNotShownAsTheyAre() {
        JsonNode example = C12.responseExample("GET", PENDING_TEMPLATE, 200, "changed_on_server");
        String tampered = example.toString().replace("send the issue text", "send\u202E the issue\u200B text");
        stubGet(GATEWAY_REGISTRY + "/mcp-jira/tools/update_issue/pending", 200, tampered);

        HttpResponse<String> response = admin().get(PENDING);

        C12.assertResponse("GET", PENDING_TEMPLATE, response);
        String description = JSON.readTree(response.body()).get("pendingEntry").get("definition").get("description").asString();
        assertThat(description).contains("send<U+202E> the issue<U+200B> text").doesNotContain("\u202E").doesNotContain("\u200B");
        assertThat(JSON.readTree(response.body()).get("pendingHash").asString())
                .isEqualTo(example.get("pendingHash").asString());
    }

    @Test
    void aRegistryOrDiffOutsideTheContractIsRefusedWhole() {
        TestBrowser browser = admin();
        String pendingWithoutSource = """
                [{"serverId":"mcp-jira","system":"jira","version":"1.4.0","tools":[{"name":"update_issue","risk":"UPDATE",
                  "action":"update","resourceRefs":[],"definition":{"name":"update_issue"},"definitionHash":"%s",
                  "status":"pending_approval","change":"new"}]}]""".formatted(HASH);
        String unknownField = """
                [{"serverId":"mcp-jira","system":"jira","version":"1.4.0","extra":true,"tools":[]}]""";
        String wrongSystem = """
                [{"serverId":"mcp-jira","system":"gitlab","version":"1.4.0","tools":[]}]""";
        for (String body : List.of(pendingWithoutSource, unknownField, wrongSystem, "{}", "[null]")) {
            stubGet(GATEWAY_REGISTRY, 200, body);
            HttpResponse<String> response = browser.get(REGISTRY);
            C12.assertResponse("GET", REGISTRY, response);
            assertThat(response.statusCode()).as(body).isEqualTo(503);
        }
        stubGet(GATEWAY_REGISTRY + "/mcp-jira/tools/update_issue/pending", 200,
                "{\"approvedEntry\":null,\"pendingEntry\":{},\"pendingHash\":\"" + HASH + "\",\"pendingVersion\":\"1.0.0\",\"source\":\"ci\"}");
        assertThat(browser.get(PENDING).statusCode()).isEqualTo(503);
    }

    @Test
    void anApprovalGoesToTheGatewayWithTheHashAndLeavesAnAuditEvent() {
        HttpResponse<String> response = admin().post(APPROVE, BODY, true);

        C12.assertResponse("POST", APPROVE_TEMPLATE, response);
        assertThat(response.statusCode()).isEqualTo(204);
        LoggedRequest sent = GATEWAY.findAll(anyRequestedFor(urlPathEqualTo(GATEWAY_REGISTRY + "/mcp-jira/tools/update_issue/approve")))
                .getLast();
        assertThat(sent.getBodyAsString()).isEqualTo(BODY);
        assertThat(sent.getHeader("Authorization")).startsWith("Bearer xt-mcp-gateway-admin-");
        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("event").asString()).isEqualTo("admin_change");
        assertThat(event.get("component").asString()).isEqualTo("portal");
        assertThat(event.get("reason").asString()).isEqualTo("definition_approved");
        assertThat(event.get("definitionHash").asString()).isEqualTo(HASH);
        assertThat(event.get("server").asString()).isEqualTo("mcp-jira");
        assertThat(event.get("tool").asString()).isEqualTo("update_issue");
        assertThat(event.get("username").asString()).isEqualTo("carol");
        assertThat(event.get("outcome").asString()).isEqualTo("ok");
    }

    @Test
    void aHashThatNoLongerMatchesIsAConflictAndTheRiskLoweredRejectionIsPassedOn() {
        TestBrowser browser = admin();
        stubApprove(409, "{\"error\":\"hash_mismatch\"}");
        HttpResponse<String> mismatch = browser.post(APPROVE, BODY, true);
        C12.assertResponse("POST", APPROVE_TEMPLATE, mismatch);
        assertThat(mismatch.statusCode()).isEqualTo(409);
        assertThat(JSON.readTree(mismatch.body()).get("error").asString()).isEqualTo("hash_mismatch");
        ContractSchemas.assertValid(AUDIT, lastAuditEvent());
        assertThat(lastAuditEvent().get("outcome").asString()).isEqualTo("error");

        stubApprove(422, "{\"error\":\"manifest_rejected\",\"reason\":\"risk_lowered\","
                + "\"message\":\"update_issue lowers risk from UPDATE to READ_ONLY\"}");
        HttpResponse<String> lowered = browser.post(APPROVE, BODY, true);
        C12.assertResponse("POST", APPROVE_TEMPLATE, lowered);
        assertThat(lowered.statusCode()).isEqualTo(422);
        JsonNode rejected = JSON.readTree(lowered.body());
        assertThat(rejected.get("error").asString()).isEqualTo("manifest_rejected");
        assertThat(rejected.get("reason").asString()).isEqualTo("risk_lowered");
        assertThat(rejected.get("message").asString()).isEqualTo("update_issue lowers risk from UPDATE to READ_ONLY");
        ContractSchemas.assertValid(AUDIT, lastAuditEvent());
    }

    @Test
    void aRejectionWithoutAWellFormedReasonOrWithHiddenTextInTheMessageIsMadeSafe() {
        TestBrowser browser = admin();
        stubApprove(422, "{\"error\":\"manifest_rejected\",\"reason\":\"Risk Lowered!\",\"message\":\"a\\u202Eb\"}");

        HttpResponse<String> response = browser.post(APPROVE, BODY, true);

        C12.assertResponse("POST", APPROVE_TEMPLATE, response);
        JsonNode rejected = JSON.readTree(response.body());
        assertThat(rejected.has("reason")).isFalse();
        assertThat(rejected.get("message").asString()).isEqualTo("a<U+202E>b");
        stubApprove(422, "{\"error\":\"manifest_rejected\"}");
        JsonNode bare = JSON.readTree(browser.post(APPROVE, BODY, true).body());
        assertThat(bare.propertyNames()).containsExactly("error");
    }

    @Test
    void gatewayAnswersAreMappedToTheContractStatuses() {
        TestBrowser browser = admin();
        stubApprove(404, "{\"error\":\"not_found_or_denied\"}");
        HttpResponse<String> missing = browser.post(APPROVE, BODY, true);
        C12.assertResponse("POST", APPROVE_TEMPLATE, missing);
        assertThat(missing.statusCode()).isEqualTo(404);

        stubApprove(403, "{\"error\":\"access_denied\"}");
        HttpResponse<String> denied = browser.post(APPROVE, BODY, true);
        C12.assertResponse("POST", APPROVE_TEMPLATE, denied);
        assertThat(denied.statusCode()).isEqualTo(403);

        stubApprove(500, "{\"error\":\"internal_error\",\"message\":\"stack trace here\"}");
        HttpResponse<String> broken = browser.post(APPROVE, BODY, true);
        C12.assertResponse("POST", APPROVE_TEMPLATE, broken);
        assertThat(broken.statusCode()).isEqualTo(503);
        assertThat(broken.body()).doesNotContain("stack trace");
        assertThat(lastAuditEvent().get("errorCode").asString()).isEqualTo("upstream_unavailable");

        stubApprove(409, "{\"error\":\"something_else\"}");
        assertThat(browser.post(APPROVE, BODY, true).statusCode()).isEqualTo(503);
    }

    @Test
    void anApprovalNeedsTheCsrfHeaderAndAWellFormedRequest() {
        TestBrowser browser = admin();
        HttpResponse<String> noCsrf = browser.post(APPROVE, BODY, false);
        assertThat(noCsrf.statusCode()).isEqualTo(403);

        for (String body : List.of("", "{}", "{\"definitionHash\":\"sha256:abc\"}", "{\"definitionHash\":5}",
                "{\"definitionHash\":\"" + HASH + "\",\"extra\":1}", "not json")) {
            HttpResponse<String> response = browser.post(APPROVE, body, true);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
        }
        for (String path : List.of("/api/v1/admin/registry/servers/mcp-other/tools/update_issue/approve",
                "/api/v1/admin/registry/servers/mcp-jira/tools/Update-Issue/approve",
                "/api/v1/admin/registry/servers/mcp-jira/tools/a__b/approve")) {
            HttpResponse<String> response = browser.post(path, BODY, true);
            C12.assertResponse("POST", APPROVE_TEMPLATE, response);
            assertThat(response.statusCode()).as(path).isEqualTo(404);
        }
        assertThat(GATEWAY.findAll(anyRequestedFor(urlPathMatching(GATEWAY_REGISTRY + "/.*/approve")))).isEmpty();
    }
}
