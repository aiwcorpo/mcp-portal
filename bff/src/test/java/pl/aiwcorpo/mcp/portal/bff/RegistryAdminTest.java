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

    private static HttpResponse<String> approve(TestBrowser browser, String path, String body, boolean csrf) {
        return browser.post(path, body, csrf, java.util.Map.of("Sec-Fetch-Site", "same-origin"));
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
    void theRegistryExamplesOfTheContractPassUnchanged() {
        TestBrowser browser = admin();
        for (String name : List.of("jira", "opensearch_disabled")) {
            JsonNode example = C12.responseExample("GET", REGISTRY, 200, name);
            assertThat(example.isMissingNode()).as(name).isFalse();
            stubGet(GATEWAY_REGISTRY, 200, example.toString());

            HttpResponse<String> response = browser.get(REGISTRY);

            C12.assertResponse("GET", REGISTRY, response);
            assertThat(JSON.readTree(response.body())).as(name).isEqualTo(example);
        }
        for (String name : List.of("new_tool", "changed_on_server")) {
            JsonNode example = C12.responseExample("GET", PENDING_TEMPLATE, 200, name);
            assertThat(example.isMissingNode()).as(name).isFalse();
            stubGet(GATEWAY_REGISTRY + "/mcp-jira/tools/update_issue/pending", 200, example.toString());

            HttpResponse<String> response = browser.get(PENDING);

            C12.assertResponse("GET", PENDING_TEMPLATE, response);
            assertThat(JSON.readTree(response.body())).as(name).isEqualTo(example);
        }
    }

    @Test
    void aUserWithoutTheAdminGroupGetsAForbiddenAnswerWithoutAnyCallToTheGateway() {
        TestBrowser alice = login(ALICE, Instant.now());
        alice.get("/api/v1/me");

        for (HttpResponse<String> response : List.of(alice.get(REGISTRY), alice.get(PENDING),
                approve(alice, APPROVE, BODY, true))) {
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
        HttpResponse<String> response = approve(admin(), APPROVE, BODY, true);

        C12.assertResponse("POST", APPROVE_TEMPLATE, response);
        assertThat(response.statusCode()).isEqualTo(204);
        LoggedRequest sent = GATEWAY.findAll(anyRequestedFor(urlPathEqualTo(GATEWAY_REGISTRY + "/mcp-jira/tools/update_issue/approve")))
                .getLast();
        assertThat(sent.getBodyAsString()).isEqualTo(BODY);
        assertThat(sent.getHeader("Authorization")).startsWith("Bearer xt-mcp-gateway-admin-");
        // The approval is recorded by the gateway (definition_approved); the portal adds no second event for it.
        assertThat(auditEvents()).noneMatch(event -> "admin_change".equals(event.get("event").asString())
                && "ok".equals(event.get("outcome").asString()));
    }

    @Test
    void anApprovalThatEndedInNothingIsAuditedWithoutTheReasonOfAnApproval() {
        stubApprove(409, "{\"error\":\"hash_mismatch\"}");

        approve(admin(), APPROVE, BODY, true);

        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("event").asString()).isEqualTo("admin_change");
        assertThat(event.get("component").asString()).isEqualTo("portal");
        assertThat(event.has("reason")).isFalse();
        assertThat(event.get("outcome").asString()).isEqualTo("error");
        assertThat(event.get("definitionHash").asString()).isEqualTo(HASH);
        assertThat(event.get("server").asString()).isEqualTo("mcp-jira");
        assertThat(event.get("tool").asString()).isEqualTo("update_issue");
        assertThat(event.get("username").asString()).isEqualTo("carol");
    }

    private static final String LOWERING_BODY = "{\"definitionHash\":\"" + HASH + "\",\"acceptRiskLowering\":true}";

    private static List<LoggedRequest> approvals() {
        return GATEWAY.findAll(anyRequestedFor(urlPathMatching(GATEWAY_REGISTRY + "/.*/approve")));
    }

    @Test
    void theStepUpOfALoweringComesBackToTheAdminPageThatSentIt() {
        TestBrowser stale = login(CAROL, Instant.now().minus(java.time.Duration.ofHours(2)));
        stale.get("/api/v1/me");

        HttpResponse<String> refused = stale.post(APPROVE, LOWERING_BODY, true, java.util.Map.of("Sec-Fetch-Site", "same-origin",
                "Referer", "https://mcp-gateway.internal/admin/registry?tool=jira__get_issue"));

        assertThat(refused.statusCode()).isEqualTo(401);
        assertThat(JSON.readTree(refused.body()).get("stepUpUrl").asString())
                .isEqualTo("/api/v1/auth/login?stepUp=true&returnPath=/admin/registry?tool%3Djira__get_issue");
        assertThat(approvals()).isEmpty();
    }

    @Test
    void loweringARiskNeedsAFreshMfaAndTheFieldGoesToTheGatewayOnlyWhenTrue() {
        TestBrowser stale = login(CAROL, Instant.now().minus(java.time.Duration.ofHours(2)));
        stale.get("/api/v1/me");

        HttpResponse<String> refused = approve(stale, APPROVE, LOWERING_BODY, true);

        C12.assertResponse("POST", APPROVE_TEMPLATE, refused);
        assertThat(refused.statusCode()).isEqualTo(401);
        JsonNode body = JSON.readTree(refused.body());
        assertThat(body.get("error").asString()).isEqualTo("step_up_required");
        assertThat(body.get("stepUpUrl").asString()).isEqualTo("/api/v1/auth/login?stepUp=true&returnPath=/admin");
        assertThat(approvals()).isEmpty();
        assertThat(lastAuditEvent().get("outcome").asString()).isEqualTo("denied");
        ContractSchemas.assertValid(AUDIT, lastAuditEvent());

        // A plain approval, also one that says false, needs no fresh MFA and does not carry the field.
        HttpResponse<String> plain = approve(stale, APPROVE, "{\"definitionHash\":\"" + HASH + "\",\"acceptRiskLowering\":false}", true);
        assertThat(plain.statusCode()).isEqualTo(204);
        assertThat(approvals().getLast().getBodyAsString()).isEqualTo(BODY);

        HttpResponse<String> lowered = approve(admin(), APPROVE, LOWERING_BODY, true);
        C12.assertResponse("POST", APPROVE_TEMPLATE, lowered);
        assertThat(lowered.statusCode()).isEqualTo(204);
        assertThat(approvals().getLast().getBodyAsString()).isEqualTo(LOWERING_BODY);
        assertThat(approve(admin(), APPROVE, "{\"definitionHash\":\"" + HASH + "\",\"acceptRiskLowering\":\"true\"}", true)
                .statusCode()).isEqualTo(400);
    }

    @Test
    void riskLoweredIsPassedToTheBrowserAndOnlyForAPendingEntry() {
        tools.jackson.databind.node.ArrayNode registry = (tools.jackson.databind.node.ArrayNode)
                C12.responseExample("GET", REGISTRY, 200, "jira").deepCopy();
        for (JsonNode tool : registry.get(0).get("tools")) {
            if ("pending_approval".equals(tool.get("status").asString())) {
                ((tools.jackson.databind.node.ObjectNode) tool).put("riskLowered", true);
            }
        }
        String lowered = registry.toString();
        stubGet(GATEWAY_REGISTRY, 200, lowered);
        TestBrowser browser = admin();

        HttpResponse<String> response = browser.get(REGISTRY);

        C12.assertResponse("GET", REGISTRY, response);
        assertThat(response.body()).contains("\"riskLowered\":true");

        tools.jackson.databind.node.ArrayNode approved = (tools.jackson.databind.node.ArrayNode)
                C12.responseExample("GET", REGISTRY, 200, "jira").deepCopy();
        tools.jackson.databind.node.ObjectNode entry = (tools.jackson.databind.node.ObjectNode) approved.get(0).get("tools").get(0);
        entry.put("status", "approved").put("riskLowered", true).remove(List.of("change", "source"));
        stubGet(GATEWAY_REGISTRY, 200, approved.toString());
        assertThat(browser.get(REGISTRY).statusCode()).isEqualTo(503);
        stubGet(GATEWAY_REGISTRY, 200, lowered.replace("\"riskLowered\":true", "\"riskLowered\":\"yes\""));
        assertThat(browser.get(REGISTRY).statusCode()).isEqualTo(503);

        JsonNode diff = C12.responseExample("GET", PENDING_TEMPLATE, 200, "changed_on_server");
        stubGet(GATEWAY_REGISTRY + "/mcp-jira/tools/update_issue/pending", 200,
                diff.toString().substring(0, diff.toString().length() - 1) + ",\"riskLowered\":true}");
        HttpResponse<String> pending = browser.get(PENDING);
        C12.assertResponse("GET", PENDING_TEMPLATE, pending);
        assertThat(JSON.readTree(pending.body()).get("riskLowered").asBoolean()).isTrue();
    }

    @Test
    void anApprovalNeedsTheRequestToComeFromThePortalPage() {
        TestBrowser browser = admin();
        for (java.util.Map<String, String> headers : List.of(java.util.Map.<String, String>of(),
                java.util.Map.of("Sec-Fetch-Site", "cross-site"), java.util.Map.of("Sec-Fetch-Site", "same-site"))) {
            HttpResponse<String> response = browser.post(APPROVE, BODY, true, headers);
            C12.assertResponse("POST", APPROVE_TEMPLATE, response);
            assertThat(response.statusCode()).isEqualTo(403);
        }
        assertThat(GATEWAY.findAll(anyRequestedFor(urlPathMatching(GATEWAY_REGISTRY + "/.*/approve")))).isEmpty();
    }

    @Test
    void aMissingApprovedVersionDoesNotBreakTheDiffAndAnotherToolDoes() {
        JsonNode example = C12.responseExample("GET", PENDING_TEMPLATE, 200, "changed_on_server");
        String nullVersion = example.toString().replace("\"approvedInVersion\":\"1.4.0\"", "\"approvedInVersion\":null");
        assertThat(nullVersion).isNotEqualTo(example.toString());
        stubGet(GATEWAY_REGISTRY + "/mcp-jira/tools/update_issue/pending", 200, nullVersion);
        TestBrowser browser = admin();
        assertThat(browser.get(PENDING).statusCode()).isEqualTo(200);

        stubGet(GATEWAY_REGISTRY + "/mcp-jira/tools/update_issue/pending", 200,
                example.toString().replace("\"name\":\"update_issue\"", "\"name\":\"delete_issue\""));
        assertThat(browser.get(PENDING).statusCode()).isEqualTo(503);
    }

    @Test
    void aHashThatNoLongerMatchesIsAConflictAndTheRiskLoweredRejectionIsPassedOn() {
        TestBrowser browser = admin();
        stubApprove(409, "{\"error\":\"hash_mismatch\"}");
        HttpResponse<String> mismatch = approve(browser, APPROVE, BODY, true);
        C12.assertResponse("POST", APPROVE_TEMPLATE, mismatch);
        assertThat(mismatch.statusCode()).isEqualTo(409);
        assertThat(JSON.readTree(mismatch.body()).get("error").asString()).isEqualTo("hash_mismatch");
        ContractSchemas.assertValid(AUDIT, lastAuditEvent());
        assertThat(lastAuditEvent().get("outcome").asString()).isEqualTo("error");

        stubApprove(422, "{\"error\":\"manifest_rejected\",\"reason\":\"risk_lowered\","
                + "\"message\":\"update_issue lowers risk from UPDATE to READ_ONLY\"}");
        HttpResponse<String> lowered = approve(browser, APPROVE, BODY, true);
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

        HttpResponse<String> response = approve(browser, APPROVE, BODY, true);

        C12.assertResponse("POST", APPROVE_TEMPLATE, response);
        JsonNode rejected = JSON.readTree(response.body());
        assertThat(rejected.has("reason")).isFalse();
        assertThat(rejected.get("message").asString()).isEqualTo("a<U+202E>b");
        stubApprove(422, "{\"error\":\"manifest_rejected\"}");
        JsonNode bare = JSON.readTree(approve(browser, APPROVE, BODY, true).body());
        assertThat(bare.propertyNames()).containsExactly("error");
    }

    @Test
    void gatewayAnswersAreMappedToTheContractStatuses() {
        TestBrowser browser = admin();
        stubApprove(404, "{\"error\":\"not_found_or_denied\"}");
        HttpResponse<String> missing = approve(browser, APPROVE, BODY, true);
        C12.assertResponse("POST", APPROVE_TEMPLATE, missing);
        assertThat(missing.statusCode()).isEqualTo(404);

        stubApprove(403, "{\"error\":\"access_denied\"}");
        HttpResponse<String> denied = approve(browser, APPROVE, BODY, true);
        C12.assertResponse("POST", APPROVE_TEMPLATE, denied);
        assertThat(denied.statusCode()).isEqualTo(403);

        stubApprove(500, "{\"error\":\"internal_error\",\"message\":\"stack trace here\"}");
        HttpResponse<String> broken = approve(browser, APPROVE, BODY, true);
        C12.assertResponse("POST", APPROVE_TEMPLATE, broken);
        assertThat(broken.statusCode()).isEqualTo(503);
        assertThat(broken.body()).doesNotContain("stack trace");
        assertThat(lastAuditEvent().get("errorCode").asString()).isEqualTo("upstream_unavailable");

        stubApprove(409, "{\"error\":\"something_else\"}");
        assertThat(approve(browser, APPROVE, BODY, true).statusCode()).isEqualTo(503);
    }

    @Test
    void anApprovalNeedsTheCsrfHeaderAndAWellFormedRequest() {
        TestBrowser browser = admin();
        HttpResponse<String> noCsrf = approve(browser, APPROVE, BODY, false);
        assertThat(noCsrf.statusCode()).isEqualTo(403);

        for (String body : List.of("", "{}", "{\"definitionHash\":\"sha256:abc\"}", "{\"definitionHash\":5}",
                "{\"definitionHash\":\"" + HASH + "\",\"extra\":1}", "not json")) {
            HttpResponse<String> response = approve(browser, APPROVE, body, true);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
        }
        for (String path : List.of("/api/v1/admin/registry/servers/mcp-gateway/tools/update_issue/approve",
                "/api/v1/admin/registry/servers/mcp-jira/tools/Update-Issue/approve",
                "/api/v1/admin/registry/servers/mcp-jira/tools/a__b/approve")) {
            HttpResponse<String> response = approve(browser, path, BODY, true);
            C12.assertResponse("POST", APPROVE_TEMPLATE, response);
            assertThat(response.statusCode()).as(path).isEqualTo(404);
        }
        assertThat(GATEWAY.findAll(anyRequestedFor(urlPathMatching(GATEWAY_REGISTRY + "/.*/approve")))).isEmpty();
    }

    private static final String APPROVE_ADAPTER = "{\"definitionHash\":\"" + HASH + "\",\"risk\":\"UPDATE\",\"action\":\"update\"}";

    @Test
    void theClassificationOfAnAdapterToolGoesToTheGatewayAsGiven() {
        TestBrowser browser = admin();

        HttpResponse<String> response = approve(browser, APPROVE, APPROVE_ADAPTER, true);

        C12.assertResponse("POST", APPROVE_TEMPLATE, response);
        assertThat(response.statusCode()).isEqualTo(204);
        assertThat(approvals().getLast().getBodyAsString()).isEqualTo(APPROVE_ADAPTER);
        JsonNode example = C12.requestExample("POST", APPROVE_TEMPLATE, "approve_adapter_tool");
        assertThat(example.get("risk").asString()).isEqualTo("UPDATE");
        assertThat(approve(browser, APPROVE, example.toString(), true).statusCode()).isEqualTo(204);
        assertThat(JSON.readTree(approvals().getLast().getBodyAsString())).isEqualTo(example);
    }

    @Test
    void aClassificationWithAnUnknownValueNeverReachesTheGateway() {
        TestBrowser browser = admin();
        for (String body : List.of(
                "{\"definitionHash\":\"" + HASH + "\",\"risk\":\"HARMLESS\",\"action\":\"update\"}",
                "{\"definitionHash\":\"" + HASH + "\",\"risk\":\"UPDATE\",\"action\":\"drop\"}",
                "{\"definitionHash\":\"" + HASH + "\",\"risk\":\"UPDATE\"}",
                "{\"definitionHash\":\"" + HASH + "\",\"action\":\"update\"}",
                "{\"definitionHash\":\"" + HASH + "\",\"risk\":5,\"action\":\"update\"}")) {
            HttpResponse<String> response = approve(browser, APPROVE, body, true);
            // CC-210: 400 is in the contract of approveAdminTool.
            C12.assertResponse("POST", APPROVE_TEMPLATE, response);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
        }
        assertThat(approvals()).isEmpty();
        assertThat(lastAuditEvent().get("outcome").asString()).isEqualTo("error");
    }

    @Test
    void theRefusalsOfAClassificationArePassedOnWithTheirReason() {
        TestBrowser browser = admin();
        for (String reason : List.of("classification_inconsistent", "classification_required", "classification_not_allowed")) {
            stubApprove(422, "{\"error\":\"manifest_rejected\",\"reason\":\"" + reason + "\",\"message\":\"m\"}");

            HttpResponse<String> response = approve(browser, APPROVE, APPROVE_ADAPTER, true);

            C12.assertResponse("POST", APPROVE_TEMPLATE, response);
            assertThat(response.statusCode()).isEqualTo(422);
            assertThat(JSON.readTree(response.body()).get("reason").asString()).isEqualTo(reason);
            ContractSchemas.assertValid(AUDIT, lastAuditEvent());
        }
    }

    @Test
    void loweringAClassificationNeedsTheFreshMfaLikeAnyLowering() {
        TestBrowser stale = login(CAROL, Instant.now().minus(java.time.Duration.ofHours(2)));
        stale.get("/api/v1/me");
        String body = "{\"definitionHash\":\"" + HASH + "\",\"risk\":\"READ_ONLY\",\"action\":\"read\",\"acceptRiskLowering\":true}";

        HttpResponse<String> refused = approve(stale, APPROVE, body, true);

        assertThat(refused.statusCode()).isEqualTo(401);
        assertThat(JSON.readTree(refused.body()).get("error").asString()).isEqualTo("step_up_required");
        assertThat(approvals()).isEmpty();
        assertThat(approve(admin(), APPROVE, body, true).statusCode()).isEqualTo(204);
        assertThat(JSON.readTree(approvals().getLast().getBodyAsString())).isEqualTo(JSON.readTree(body));
    }

    private static tools.jackson.databind.node.ObjectNode adapterRegistryTool() {
        tools.jackson.databind.node.ArrayNode registry = (tools.jackson.databind.node.ArrayNode)
                C12.responseExample("GET", REGISTRY, 200, "jira").deepCopy();
        for (JsonNode tool : registry.get(0).get("tools")) {
            if ("pending_approval".equals(tool.get("status").asString())) {
                tools.jackson.databind.node.ObjectNode entry = (tools.jackson.databind.node.ObjectNode) tool;
                entry.put("source", "adapter").remove(List.of("risk", "action"));
                entry.putArray("resourceRefs");
                return entry;
            }
        }
        throw new IllegalStateException("the example has no pending tool");
    }

    private static String registryWith(tools.jackson.databind.node.ObjectNode adapterTool) {
        tools.jackson.databind.node.ArrayNode registry = (tools.jackson.databind.node.ArrayNode)
                C12.responseExample("GET", REGISTRY, 200, "jira").deepCopy();
        tools.jackson.databind.node.ArrayNode tools = (tools.jackson.databind.node.ArrayNode) registry.get(0).get("tools");
        for (int i = 0; i < tools.size(); i++) {
            if ("pending_approval".equals(tools.get(i).get("status").asString())) {
                tools.set(i, adapterTool);
            }
        }
        return registry.toString();
    }

    @Test
    void aPendingToolOfAnAdapterWithoutRiskAndActionIsShownAndAHalfOfThePairIsNot() {
        TestBrowser browser = admin();
        tools.jackson.databind.node.ObjectNode adapter = adapterRegistryTool();
        stubGet(GATEWAY_REGISTRY, 200, registryWith(adapter));

        HttpResponse<String> response = browser.get(REGISTRY);

        C12.assertResponse("GET", REGISTRY, response);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).contains("\"source\":\"adapter\"");

        adapter.put("risk", "UPDATE");
        stubGet(GATEWAY_REGISTRY, 200, registryWith(adapter));
        assertThat(browser.get(REGISTRY).statusCode()).as("risk without action").isEqualTo(503);
        adapter.put("action", "update");
        stubGet(GATEWAY_REGISTRY, 200, registryWith(adapter));
        assertThat(browser.get(REGISTRY).statusCode()).as("the whole pair on a pending adapter entry").isEqualTo(200);

        adapter.put("source", "server").remove(List.of("risk", "action"));
        stubGet(GATEWAY_REGISTRY, 200, registryWith(adapter));
        assertThat(browser.get(REGISTRY).statusCode()).as("a pipeline or server entry always has them").isEqualTo(503);
    }

    @Test
    void anApprovedToolKeepsWhoClassifiedItAndWhen() {
        TestBrowser browser = admin();
        tools.jackson.databind.node.ObjectNode tool = adapterRegistryTool();
        tool.put("status", "approved").put("risk", "UPDATE").put("action", "update").remove(List.of("change", "source"));
        tool.put("classifiedBy", "3c1d6b7e-5a43-4f49-9d4f-0a7b1a1f2c11").put("classifiedAt", "2026-11-03T09:12:44Z");
        stubGet(GATEWAY_REGISTRY, 200, registryWith(tool));

        HttpResponse<String> response = browser.get(REGISTRY);

        C12.assertResponse("GET", REGISTRY, response);
        assertThat(response.body()).contains("\"classifiedBy\":\"3c1d6b7e-5a43-4f49-9d4f-0a7b1a1f2c11\"");
        tool.remove("classifiedAt");
        stubGet(GATEWAY_REGISTRY, 200, registryWith(tool));
        assertThat(browser.get(REGISTRY).statusCode()).isEqualTo(503);
        tool.put("classifiedAt", "yesterday");
        stubGet(GATEWAY_REGISTRY, 200, registryWith(tool));
        assertThat(browser.get(REGISTRY).statusCode()).isEqualTo(503);
    }

    @Test
    void theDiffOfAnAdapterToolHasNoClassificationInThePendingEntry() {
        TestBrowser browser = admin();
        tools.jackson.databind.node.ObjectNode diff = (tools.jackson.databind.node.ObjectNode)
                C12.responseExample("GET", PENDING_TEMPLATE, 200, "new_tool").deepCopy();
        tools.jackson.databind.node.ObjectNode entry = (tools.jackson.databind.node.ObjectNode) diff.get("pendingEntry");
        entry.remove(List.of("risk", "action"));
        entry.putArray("resourceRefs");
        diff.put("source", "adapter");
        stubGet(GATEWAY_REGISTRY + "/mcp-jira/tools/update_issue/pending", 200, diff.toString());

        HttpResponse<String> response = browser.get(PENDING);

        C12.assertResponse("GET", PENDING_TEMPLATE, response);
        assertThat(response.statusCode()).isEqualTo(200);
        entry.put("risk", "UPDATE").put("action", "update");
        stubGet(GATEWAY_REGISTRY + "/mcp-jira/tools/update_issue/pending", 200, diff.toString());
        assertThat(browser.get(PENDING).statusCode()).as("an adapter does not classify").isEqualTo(503);
    }
}
