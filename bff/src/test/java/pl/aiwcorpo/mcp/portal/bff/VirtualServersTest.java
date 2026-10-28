package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.delete;
import static com.github.tomakehurst.wiremock.client.WireMock.deleteRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
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

/** Virtual servers (links): proxy to C5, resourceDefaults check (CC-085), clientConfigs from the public base URL. */
class VirtualServersTest extends PortalHarness {

    private static final String COLLECTION = "/admin/v1/virtual-servers";
    private static final String VALID = "{\"slug\":\"team-a-dev\",\"displayName\":\"Team A development\","
            + "\"tools\":[\"jira__search_issues\",\"jira__get_issue\"]}";

    @AfterEach
    void defaultStubs() {
        GATEWAY.resetToDefaultMappings();
    }

    private TestBrowser session() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        return browser;
    }

    private static int gatewayCalls() {
        return GATEWAY.findAll(anyRequestedFor(urlPathMatching("/admin/v1/virtual-servers.*"))).size();
    }

    private static void stubCreate(int status, String body) {
        GATEWAY.stubFor(post(urlPathEqualTo(COLLECTION)).atPriority(1).willReturn(aResponse().withStatus(status)
                .withHeader("Content-Type", "application/json").withBody(body)));
    }

    @Test
    void listAddsClientConfigsBuiltFromThePublicBaseUrl() {
        HttpResponse<String> response = session().get("/api/v1/virtual-servers");

        C12.assertResponse("GET", "/api/v1/virtual-servers", response);
        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode link = JSON.readTree(response.body()).get(0);
        String url = "https://mcp-gateway.internal/v/team-a-dev/mcp";
        assertThat(link.get("url").asString()).isEqualTo(url);
        JsonNode configs = link.get("clientConfigs");
        assertThat(configs.get("claudeCode").asString()).isEqualTo(
                "claude mcp add --transport http --client-id claude-code --callback-port 33418 team-a-dev " + url);
        assertThat(configs.get("copilot").asString())
                .isEqualTo("{\"servers\":{\"team-a-dev\":{\"type\":\"http\",\"url\":\"" + url + "\"}}}");
        assertThat(configs.get("codex").asString()).isEqualTo("[mcp_servers.team-a-dev]\nurl = \"" + url + "\"\n");
        assertThat(link.has("resourceDefaults")).isFalse();
        LoggedRequest sent = GATEWAY.findAll(anyRequestedFor(urlPathEqualTo(COLLECTION))).getLast();
        assertThat(sent.getHeader("Authorization")).startsWith("Bearer xt-mcp-gateway-admin-");
    }

    @Test
    void listDropsEntriesOutsideTheContract() {
        GATEWAY.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlPathEqualTo(COLLECTION)).atPriority(1)
                .willReturn(aResponse().withStatus(200).withHeader("Content-Type", "application/json").withBody("""
                        [{"slug":"ok-link","displayName":"Ok","tools":["jira__get_issue"],"url":"https://evil.test/x"},
                         {"slug":"Bad Slug","displayName":"Bad","tools":["jira__get_issue"],"url":"https://x"},
                         {"slug":"bad-tool","displayName":"Bad","tools":["not a tool"],"url":"https://x"}]""")));

        HttpResponse<String> response = session().get("/api/v1/virtual-servers");

        C12.assertResponse("GET", "/api/v1/virtual-servers", response);
        JsonNode links = JSON.readTree(response.body());
        assertThat(links).hasSize(1);
        // The gateway's own url is not trusted either: the BFF builds it from its configuration.
        assertThat(links.get(0).get("url").asString()).isEqualTo("https://mcp-gateway.internal/v/ok-link/mcp");
    }

    @Test
    void createForwardsOnlyTheContractFieldsAndAnswersWithClientConfigs() {
        TestBrowser browser = session();

        HttpResponse<String> response = browser.post("/api/v1/virtual-servers", VALID, true);

        C12.assertResponse("POST", "/api/v1/virtual-servers", response);
        assertThat(response.statusCode()).isEqualTo(201);
        JsonNode created = JSON.readTree(response.body());
        assertThat(created.get("slug").asString()).isEqualTo("team-a-dev");
        assertThat(created.get("url").asString()).isEqualTo("https://mcp-gateway.internal/v/team-a-dev/mcp");
        assertThat(created.get("clientConfigs").get("claudeCode").asString())
                .endsWith("team-a-dev https://mcp-gateway.internal/v/team-a-dev/mcp");
        LoggedRequest sent = GATEWAY.findAll(postRequestedFor(urlPathEqualTo(COLLECTION))).getLast();
        assertThat(JSON.readTree(sent.getBodyAsString())).isEqualTo(JSON.readTree(VALID));
        assertThat(sent.getHeader("X-Request-Id")).isEqualTo(response.headers().firstValue("X-Request-Id").orElseThrow());

        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("event").asString()).isEqualTo("virtual_server_change");
        assertThat(event.get("virtualServer").asString()).isEqualTo("team-a-dev");
        assertThat(event.get("sub").asString()).isEqualTo(ALICE.sub());
        assertThat(event.get("outcome").asString()).isEqualTo("ok");
        assertThat(event.get("reason").asString()).isEqualTo("vs_created");
    }

    @Test
    void emptyResourceDefaultsCountAsAbsentAndAreNotForwarded() {
        String body = VALID.replace("}", ",\"resourceDefaults\":{}}");
        HttpResponse<String> response = session().post("/api/v1/virtual-servers", body, true);

        C12.assertResponse("POST", "/api/v1/virtual-servers", response);
        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(response.body()).doesNotContain("resourceDefaults");
        LoggedRequest sent = GATEWAY.findAll(postRequestedFor(urlPathEqualTo(COLLECTION))).getLast();
        assertThat(sent.getBodyAsString()).doesNotContain("resourceDefaults");
    }

    @Test
    void nonEmptyResourceDefaultsAreRefusedBeforeAnythingElse() {
        TestBrowser browser = session();
        int before = gatewayCalls();
        String valid = "{\"Jira::Project\":[\"ABC\"]}";
        // Order of CC-085: non-empty object first, even when its content or the rest of the body is also wrong.
        for (String body : List.of(
                VALID.replace("}", ",\"resourceDefaults\":" + valid + "}"),
                VALID.replace("}", ",\"resourceDefaults\":{\"Jira::Project\":[]}}"),
                VALID.replace("}", ",\"resourceDefaults\":{\"Nonsense\":1}}"),
                "{\"slug\":\"BAD SLUG\",\"resourceDefaults\":" + valid + "}",
                "{\"unknown\":1,\"resourceDefaults\":" + valid + "}")) {
            HttpResponse<String> response = browser.post("/api/v1/virtual-servers", body, true);
            C12.assertResponse("POST", "/api/v1/virtual-servers", response);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
            assertThat(JSON.readTree(response.body()).get("error").asString()).as(body)
                    .isEqualTo("resource_defaults_unsupported");
        }
        assertThat(gatewayCalls()).isEqualTo(before);
    }

    @Test
    void resourceDefaultsThatAreNoObjectAreInvalidRequest() {
        TestBrowser browser = session();
        int before = gatewayCalls();
        for (String value : List.of("null", "[]", "[\"x\"]", "\"x\"", "1", "true")) {
            HttpResponse<String> response = browser.post("/api/v1/virtual-servers",
                    VALID.replace("}", ",\"resourceDefaults\":" + value + "}"), true);
            C12.assertResponse("POST", "/api/v1/virtual-servers", response);
            assertThat(response.statusCode()).as(value).isEqualTo(400);
            assertThat(JSON.readTree(response.body()).get("error").asString()).as(value).isEqualTo("invalid_request");
        }
        assertThat(gatewayCalls()).isEqualTo(before);
    }

    @Test
    void malformedCreateRequestsNeverReachTheGateway() {
        TestBrowser browser = session();
        int before = gatewayCalls();
        String name = "\"displayName\":\"Team\"";
        String tools = "\"tools\":[\"jira__get_issue\"]";
        for (String body : List.of("", "not json", "[]", "null", "{}",
                "{\"slug\":\"UPPER\"," + name + "," + tools + "}",
                "{\"slug\":\"-lead\"," + name + "," + tools + "}",
                "{\"slug\":\"" + "a".repeat(64) + "\"," + name + "," + tools + "}",
                "{\"slug\":\"ok\",\"displayName\":\"\"," + tools + "}",
                "{\"slug\":\"ok\",\"displayName\":\"" + "x".repeat(101) + "\"," + tools + "}",
                "{\"slug\":\"ok\"," + name + ",\"tools\":[]}",
                "{\"slug\":\"ok\"," + name + ",\"tools\":[\"jira__get_issue\",\"jira__get_issue\"]}",
                "{\"slug\":\"ok\"," + name + ",\"tools\":[\"get_issue\"]}",
                "{\"slug\":\"ok\"," + name + ",\"tools\":[\"sharepoint__get_page\"]}",
                "{\"slug\":\"ok\"," + name + ",\"tools\":\"jira__get_issue\"}",
                "{\"slug\":\"ok\"," + name + "," + tools + ",\"owner\":\"someone-else\"}",
                "{\"slug\":7," + name + "," + tools + "}")) {
            HttpResponse<String> response = browser.post("/api/v1/virtual-servers", body, true);
            C12.assertResponse("POST", "/api/v1/virtual-servers", response);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
            assertThat(JSON.readTree(response.body()).get("error").asString()).as(body).isEqualTo("invalid_request");
            assertThat(JSON.readTree(response.body()).get("requestId").asString())
                    .isEqualTo(response.headers().firstValue("X-Request-Id").orElseThrow());
        }
        assertThat(gatewayCalls()).isEqualTo(before);
        assertThat(lastAuditEvent().get("reason").asString()).isEqualTo("invalid_request");
    }

    @Test
    void takenSlugAndForbiddenToolArePassedAsTheirCodes() {
        TestBrowser browser = session();
        stubCreate(409, "{\"error\":\"slug_taken\"}");
        HttpResponse<String> taken = browser.post("/api/v1/virtual-servers", VALID, true);
        C12.assertResponse("POST", "/api/v1/virtual-servers", taken);
        assertThat(taken.statusCode()).isEqualTo(409);
        assertThat(JSON.readTree(taken.body()).get("error").asString()).isEqualTo("slug_taken");
        assertThat(lastAuditEvent().get("reason").asString()).isEqualTo("slug_taken");

        stubCreate(403, "{\"error\":\"access_denied\"}");
        HttpResponse<String> denied = browser.post("/api/v1/virtual-servers", VALID, true);
        C12.assertResponse("POST", "/api/v1/virtual-servers", denied);
        assertThat(denied.statusCode()).isEqualTo(403);
        assertThat(JSON.readTree(denied.body()).get("error").asString()).isEqualTo("access_denied");
        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("decision").asString()).isEqualTo("deny");
        assertThat(event.get("reason").asString()).isEqualTo("not_granted");
    }

    @Test
    void virtualServerLimitIsPassedAsItsOwnConflict() {
        TestBrowser browser = session();
        stubCreate(409, "{\"error\":\"virtual_server_limit_reached\"}");

        HttpResponse<String> limited = browser.post("/api/v1/virtual-servers", VALID, true);

        C12.assertResponse("POST", "/api/v1/virtual-servers", limited);
        assertThat(limited.statusCode()).isEqualTo(409);
        assertThat(JSON.readTree(limited.body()).get("error").asString()).isEqualTo("virtual_server_limit_reached");
        String requestId = limited.headers().firstValue("X-Request-Id").orElseThrow();
        assertThat(JSON.readTree(limited.body()).get("requestId").asString()).isEqualTo(requestId);
        LoggedRequest sent = GATEWAY.findAll(postRequestedFor(urlPathEqualTo(COLLECTION))).getLast();
        assertThat(sent.getHeader("X-Request-Id")).isEqualTo(requestId);
        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("reason").asString()).isEqualTo("virtual_server_limit");
        assertThat(event.get("decision").asString()).isEqualTo("deny");
        assertThat(event.get("outcome").asString()).isEqualTo("error");
        assertThat(event.get("requestId").asString()).isEqualTo(requestId);
    }

    @Test
    void gatewayFailuresAreServiceUnavailableWithoutItsText() {
        TestBrowser browser = session();
        for (int status : List.of(500, 502, 404)) {
            stubCreate(status, "{\"error\":\"internal\",\"message\":\"stack in mcp-gateway-7f9\"}");
            HttpResponse<String> response = browser.post("/api/v1/virtual-servers", VALID, true);
            C12.assertResponse("POST", "/api/v1/virtual-servers", response);
            assertThat(response.statusCode()).as("status " + status).isEqualTo(503);
            assertThat(response.body()).doesNotContain("mcp-gateway-7f9");
        }
        assertThat(lastAuditEvent().get("reason").asString()).isEqualTo("upstream_unavailable");
    }

    @Test
    void deleteIsNoContentAndSomeoneElsesLinkIsNotFound() {
        TestBrowser browser = session();

        HttpResponse<String> deleted = browser.delete("/api/v1/virtual-servers/team-a-dev", true);
        C12.assertResponse("DELETE", "/api/v1/virtual-servers/{slug}", deleted);
        assertThat(deleted.statusCode()).isEqualTo(204);
        assertThat(GATEWAY.findAll(deleteRequestedFor(urlPathEqualTo(COLLECTION + "/team-a-dev")))).isNotEmpty();
        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("event").asString()).isEqualTo("virtual_server_change");
        assertThat(event.get("virtualServer").asString()).isEqualTo("team-a-dev");
        assertThat(event.get("reason").asString()).isEqualTo("vs_deleted");

        for (int status : List.of(404, 403)) {
            GATEWAY.stubFor(delete(urlPathEqualTo(COLLECTION + "/bobs-link")).atPriority(1).willReturn(aResponse()
                    .withStatus(status).withHeader("Content-Type", "application/json")
                    .withBody("{\"error\":\"" + (status == 404 ? "not_found_or_denied" : "access_denied") + "\"}")));
            HttpResponse<String> foreign = browser.delete("/api/v1/virtual-servers/bobs-link", true);
            C12.assertResponse("DELETE", "/api/v1/virtual-servers/{slug}", foreign);
            assertThat(foreign.statusCode()).as("gateway " + status).isEqualTo(404);
            assertThat(JSON.readTree(foreign.body()).get("error").asString()).isEqualTo("not_found_or_denied");
        }
    }

    @Test
    void deleteWithAnInvalidSlugIsNotFoundWithoutCallingTheGateway() {
        TestBrowser browser = session();
        int before = gatewayCalls();
        for (String slug : List.of("UPPER", "-x", "a_b")) {
            HttpResponse<String> response = browser.delete("/api/v1/virtual-servers/" + slug, true);
            C12.assertResponse("DELETE", "/api/v1/virtual-servers/{slug}", response);
            assertThat(response.statusCode()).as(slug).isEqualTo(404);
        }
        // Encoded dots and slashes are stopped by the servlet firewall with a JSON 400 (C12 lists none for DELETE).
        for (String slug : List.of("%2e%2e", "a%2Fb")) {
            HttpResponse<String> response = browser.delete("/api/v1/virtual-servers/" + slug, true);
            assertThat(response.statusCode()).as(slug).isBetween(400, 404);
            assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("application/json");
        }
        assertThat(gatewayCalls()).isEqualTo(before);
    }

    @Test
    void sessionAndCsrfHeaderAreRequired() {
        TestBrowser stranger = browser();
        stranger.get("/api/v1/me");
        HttpResponse<String> anonymous = stranger.post("/api/v1/virtual-servers", VALID, true);
        C12.assertResponse("POST", "/api/v1/virtual-servers", anonymous);
        assertThat(anonymous.statusCode()).isEqualTo(401);
        assertThat(stranger.get("/api/v1/virtual-servers").statusCode()).isEqualTo(401);

        TestBrowser browser = session();
        int before = gatewayCalls();
        HttpResponse<String> create = browser.post("/api/v1/virtual-servers", VALID, false);
        C12.assertResponse("POST", "/api/v1/virtual-servers", create);
        assertThat(create.statusCode()).isEqualTo(403);
        assertThat(JSON.readTree(create.body()).get("error").asString()).isEqualTo("csrf_invalid");
        HttpResponse<String> remove = browser.delete("/api/v1/virtual-servers/team-a-dev", false);
        C12.assertResponse("DELETE", "/api/v1/virtual-servers/{slug}", remove);
        assertThat(remove.statusCode()).isEqualTo(403);
        assertThat(gatewayCalls()).isEqualTo(before);
    }
}
