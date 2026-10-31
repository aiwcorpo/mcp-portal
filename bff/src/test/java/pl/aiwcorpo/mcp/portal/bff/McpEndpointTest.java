package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * {@code GET /api/v1/me/mcp-endpoint} (CC-175, CC-182) over HTTP: the vectors of {@code mcp-endpoint/} with the query
 * as the client sends it, the count from the catalog of C5, and refusals that never reach the gateway.
 */
class McpEndpointTest extends PortalHarness {

    private static final String PATH = "/api/v1/me/mcp-endpoint";
    private static final String CATALOG = "/admin/v1/catalog";
    private static final String VECTOR_ORIGIN = "https://mcp.aiwcorpo.pl";
    private static final String DEV_FLAGS = "--transport http --client-id claude-code --callback-port 33418";

    @AfterEach
    void defaultStubs() {
        GATEWAY.resetToDefaultMappings();
        GATEWAY.resetRequests();
    }

    private TestBrowser session() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        return browser;
    }

    private static int catalogRequests() {
        return GATEWAY.findAll(anyRequestedFor(urlPathEqualTo(CATALOG))).size();
    }

    static Stream<Arguments> vectors() throws IOException {
        Resource[] files = new PathMatchingResourcePatternResolver()
                .getResources("classpath*:mcp-contracts/test-vectors/mcp-endpoint/*.json");
        assertThat(files).isNotEmpty();
        List<Arguments> result = new ArrayList<>();
        for (Resource file : files) {
            try (InputStream in = file.getInputStream()) {
                result.add(Arguments.of(file.getFilename(), JSON.readTree(in)));
            }
        }
        return result.stream();
    }

    /** The catalog of C5 for the flat list of a vector: one server per system. */
    private static void stubCatalog(JsonNode tools) {
        Map<String, ArrayNode> bySystem = new LinkedHashMap<>();
        for (JsonNode tool : tools) {
            String name = tool.get("name").asString();
            ObjectNode entry = JSON.createObjectNode();
            entry.put("name", name);
            entry.put("description", "d");
            entry.put("risk", tool.get("risk").asString());
            entry.put("action", "read");
            entry.put("access", tool.get("access").asString());
            entry.putArray("requiredEntitlements");
            if (tool.get("disabled").asBoolean()) {
                entry.put("disabled", true);
            }
            bySystem.computeIfAbsent(name.contains("__") ? name.substring(0, name.indexOf("__")) : "jira", system -> JSON.createArrayNode()).add(entry);
        }
        ArrayNode servers = JSON.createArrayNode();
        bySystem.forEach((system, list) -> {
            ObjectNode server = servers.addObject();
            server.put("serverId", "mcp-" + system);
            server.put("system", system);
            server.put("version", "1.0.0");
            server.set("tools", list);
        });
        ObjectNode catalog = JSON.createObjectNode();
        catalog.set("servers", servers);
        GATEWAY.stubFor(get(urlPathEqualTo(CATALOG)).atPriority(1).willReturn(aResponse().withStatus(200)
                .withHeader("Content-Type", "application/json").withBody(catalog.toString())));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("vectors")
    void everyVectorOverHttpAsTheClientSendsTheQuery(String name, JsonNode vector) {
        JsonNode input = vector.get("input");
        JsonNode expected = vector.get("expected");
        stubCatalog(input.get("catalog"));
        // A raw query of a vector is the composed one, so its percent signs are literal; the client would have sent %25.
        String httpQuery = input.has("httpQuery") ? input.get("httpQuery").asString()
                : input.get("rawQuery").asString().replace("%", "%25");

        HttpResponse<String> response = session().get(PATH + (httpQuery.isEmpty() ? "" : "?" + httpQuery));

        C12.assertResponse("GET", PATH, response);
        assertThat(response.statusCode()).isEqualTo(expected.get("status").asInt());
        assertThat(response.headers().firstValue("X-Request-Id")).isPresent();
        JsonNode body = JSON.readTree(response.body());
        if (expected.get("status").asInt() == 400) {
            assertThat(body.get("error").asString()).isEqualTo("invalid_request");
            assertThat(body.get("reason").asString()).isEqualTo("invalid_filter");
            assertThat(body.get("requestId").asString()).isNotEmpty();
            assertThat(catalogRequests()).as("a bad filter never reaches the gateway").isZero();
            return;
        }
        String origin = "https://mcp-gateway.internal";
        JsonNode want = expected.get("body");
        assertThat(body.get("url").asString()).isEqualTo(want.get("url").asString().replace(VECTOR_ORIGIN, origin));
        assertThat(body.has("filter")).isEqualTo(want.has("filter"));
        if (want.has("filter")) {
            assertThat(body.get("filter").asString()).isEqualTo(want.get("filter").asString());
        }
        assertThat(body.get("toolCount").asInt()).isEqualTo(want.get("toolCount").asInt());
        JsonNode configs = want.get("clientConfigs");
        assertThat(body.get("clientConfigs").get("claudeCode").asString())
                .isEqualTo(configs.get("claudeCode").asString().replace(VECTOR_ORIGIN, origin)
                        .replace("--transport http", DEV_FLAGS));
        assertThat(body.get("clientConfigs").get("copilot").asString())
                .isEqualTo(configs.get("copilot").asString().replace(VECTOR_ORIGIN, origin));
        assertThat(body.get("clientConfigs").get("codex").asString())
                .isEqualTo(configs.get("codex").asString().replace(VECTOR_ORIGIN, origin));
        assertThat(response.body()).doesNotContain("Bearer").doesNotContain("xt-mcp-gateway-admin");
    }

    @Test
    void theCountComesFromTheCatalogOfTheCurrentUserWithTheGatewayAdminToken() {
        HttpResponse<String> response = session().get(PATH);

        C12.assertResponse("GET", PATH, response);
        assertThat(response.statusCode()).isEqualTo(200);
        var sent = GATEWAY.findAll(anyRequestedFor(urlPathEqualTo(CATALOG)));
        assertThat(sent).hasSize(1);
        assertThat(sent.getFirst().getHeader("Authorization")).startsWith("Bearer xt-mcp-gateway-admin-");
        JsonNode body = JSON.readTree(response.body());
        assertThat(body.get("url").asString()).isEqualTo("https://mcp-gateway.internal/mcp");
        assertThat(body.has("filter")).isFalse();
        assertThat(body.get("toolCount").asInt()).isPositive();
    }

    @Test
    void requestsWithoutASessionAreUnauthenticated() {
        HttpResponse<String> response = browser().get(PATH);

        assertThat(response.statusCode()).isEqualTo(401);
        C12.assertResponse("GET", PATH, response);
        assertThat(catalogRequests()).isZero();
    }

    @Test
    void parametersOutsideTheFourAndRepeatedOnesAreInvalidFilters() {
        TestBrowser browser = session();

        for (String query : List.of("system=jira", "systems=jira&utm=1", "systems=jira&systems=gitlab",
                "Systems=jira&systems=gitlab", "access=", "systems=", "systems=jira%26access%3Dwrite", "exclude=jira__a+b")) {
            HttpResponse<String> response = browser.get(PATH + "?" + query);
            C12.assertResponse("GET", PATH, response);
            assertThat(response.statusCode()).as(query).isEqualTo(400);
            assertThat(JSON.readTree(response.body()).get("reason").asString()).as(query).isEqualTo("invalid_filter");
        }
        assertThat(catalogRequests()).isZero();
    }

    @Test
    void whatTheContainerRefusesToParseIsAnInvalidFilterNotAServerError() {
        TestBrowser browser = session();
        GATEWAY.resetRequests();

        for (String query : List.of("=jira", "systems=%ff", "%ff=1", "%00=1", "systems%3Djira%26access=read", "&systems=jira",
                "systems=jira&", "systems=jira&&access=read", "%53ystems=jira%26x", "x%3D1=2")) {
            HttpResponse<String> response = browser.get(PATH + "?" + query);
            C12.assertResponse("GET", PATH, response);
            assertThat(response.statusCode()).as(query).isEqualTo(400);
            assertThat(JSON.readTree(response.body()).get("reason").asString()).as(query).isEqualTo("invalid_filter");
        }
        assertThat(catalogRequests()).isZero();
        assertThat(browser.get(PATH + "?SYSTEMS=jira").statusCode()).as("names are case-insensitive like on the gateway").isEqualTo(200);
    }

    @Test
    void aCatalogToolWithoutTheSystemPrefixDoesNotBreakTheAnswer() {
        stubCatalog(JSON.readTree("[{\"name\":\"jira__get_issue\",\"risk\":\"READ_ONLY\",\"access\":\"granted\",\"disabled\":false},"
                + "{\"name\":\"nosystemprefix\",\"risk\":\"READ_ONLY\",\"access\":\"granted\",\"disabled\":false}]"));

        HttpResponse<String> response = session().get(PATH);

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(JSON.readTree(response.body()).get("toolCount").asInt()).isEqualTo(1);
    }

    @Test
    void aFilterOverTheLimitOfTheGatewayIsRefused() {
        String tools = String.join(",", java.util.stream.IntStream.range(0, 30).mapToObj(i -> "jira__get_issue" + (char) ('a' + i % 26) + (i / 26)).toList());

        HttpResponse<String> response = session().get(PATH + "?tools=" + tools);

        assertThat(response.statusCode()).isEqualTo(400);
        assertThat(JSON.readTree(response.body()).get("reason").asString()).isEqualTo("invalid_filter");
    }

    @Test
    void anUnavailableGatewayIsServiceUnavailableWithoutItsText() {
        GATEWAY.stubFor(get(urlPathEqualTo(CATALOG)).atPriority(1)
                .willReturn(aResponse().withStatus(500).withBody("{\"error\":\"internal_error\",\"detail\":\"stack at x.y.Z\"}")));

        HttpResponse<String> response = session().get(PATH + "?systems=jira");

        assertThat(response.statusCode()).isEqualTo(503);
        C12.assertResponse("GET", PATH, response);
        assertThat(response.body()).doesNotContain("stack at");
    }

    @Test
    void nothingIsWrittenToTheAuditLog() {
        int before = LOGS.list.size();

        session().get(PATH + "?systems=jira&access=read");

        assertThat(LOGS.list.subList(Math.min(before, LOGS.list.size()), LOGS.list.size()))
                .noneMatch(line -> line.getFormattedMessage().contains("\"event\""));
    }
}
