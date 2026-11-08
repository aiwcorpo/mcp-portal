package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.request;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathMatching;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.ResponseDefinitionBuilder;
import com.github.tomakehurst.wiremock.verification.LoggedRequest;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.support.ContractSchemas;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;

/**
 * The administration mirrors of C12 over C5 and C4 (servers, scope mapping, overrides, policy approval, broker systems):
 * the group of the administrator, the fresh MFA exactly where the contract asks for it, preconditions passed through,
 * what the upstreams refuse and what they return that the contract does not allow.
 */
class AdminMirrorsTest extends PortalHarness {

    private static final String ETAG = "\"Zx8Tq2LmWk93vNpA\"";
    private static final String OTHER_ETAG = "\"Qm4Rt7NpVk21xYzB\"";
    private static final String HASH = "sha256:12573bd466924c3e35d2a79ca0c6257f4c7663c9d188510593b08dd3867220f8";
    private static final String CLIENT_SECRET = "test-only-client-secret-0000000000";
    private static final Map<String, String> SAME_ORIGIN = Map.of("Sec-Fetch-Site", "same-origin");

    private static final String SERVERS = "/api/v1/admin/servers";
    private static final String SERVER = "/api/v1/admin/servers/{serverId}";
    private static final String MAPPING = "/api/v1/admin/policy/scope-mapping";
    private static final String OVERRIDES = "/api/v1/admin/policy/overrides";
    private static final String OVERRIDE = "/api/v1/admin/policy/overrides/{id}";
    private static final String POLICIES = "/api/v1/admin/registry/servers/{serverId}/policies";
    private static final String PENDING = "/api/v1/admin/registry/servers/{serverId}/policies/pending";
    private static final String APPROVE = "/api/v1/admin/registry/servers/{serverId}/policies/approve";
    private static final String SYSTEMS = "/api/v1/admin/systems";
    private static final String SYSTEM = "/api/v1/admin/systems/{system}";

    private static final String SERVER_BODY = C12.requestExample("POST", SERVERS, "notes").toString();
    private static final String CREDENTIAL_BODY = "{\"credential\":{\"required\":true,\"acceptedTypes\":[\"user-oauth\"],\"type\":\"user-oauth\"}}";
    private static final String PATCH_BODY = CREDENTIAL_BODY;
    private static final String CONNECTION = "/api/v1/admin/servers/{serverId}/connection/approve";
    private static final String REFRESH = "/api/v1/admin/servers/{serverId}/refresh";
    private static final String CONNECTION_BODY = C12.requestExample("POST", CONNECTION, "pin_self_signed").toString();
    private static final String MAPPING_BODY = C12.requestExample("PUT", MAPPING, "one_group").toString();
    private static final String OVERRIDE_BODY = C12.requestExample("PUT", OVERRIDE, "block_drop_table").toString();
    private static final String APPROVE_BODY = "{\"policiesHash\":\"" + HASH + "\"}";
    private static final String SYSTEM_BODY = C12.requestExample("PUT", SYSTEM, "notes").toString();
    /** A system with an OAuth client, so the client secret rules are exercised on an adapter that has one (not generic-rest). */
    private static final String OAUTH_SYSTEM_BODY = "{\"baseUrl\":\"https://git.internal\",\"adapter\":\"gitlab\","
            + "\"supportedTypes\":[\"user-oauth\"],\"defaultType\":\"user-oauth\",\"secretScheme\":\"Bearer\","
            + "\"oauth\":{\"clientId\":\"mcp-broker-gitlab\",\"clientSecret\":\"test-only-client-secret-0000000000\","
            + "\"authorizeUrl\":\"https://git.internal/oauth/authorize\",\"tokenUrl\":\"https://git.internal/oauth/token\","
            + "\"scopes\":[\"read_api\"]}}";
    private static final String OAUTH_SYSTEM_VIEW = "{\"system\":\"notes\",\"displayName\":\"Notes\","
            + "\"baseUrl\":\"https://git.internal\",\"adapter\":\"gitlab\",\"supportedTypes\":[\"user-oauth\"],"
            + "\"defaultType\":\"user-oauth\",\"secretScheme\":\"Bearer\",\"oauth\":{\"clientId\":\"mcp-broker-gitlab\","
            + "\"authorizeUrl\":\"https://git.internal/oauth/authorize\",\"tokenUrl\":\"https://git.internal/oauth/token\","
            + "\"scopes\":[\"read_api\"],\"clientSecretSet\":true}}";

    private static final String ADMIN_GATEWAY_PATHS = "/admin/v1/(servers.*|policy/.*|registry/servers/[^/]+/policies/.*)";
    private static final String ADMIN_BROKER_PATHS = "/v1/admin/systems.*";

    /** One write operation of the mirrors: how the browser calls it and what it must ask for. */
    private record Write(String name, String method, String path, String template, String body, Map<String, String> headers,
                         boolean stepUp, WireMockServer upstream, String upstreamPath, int okStatus, String okBody,
                         String rejection) {
    }

    private static Map<String, String> ifMatch() {
        return Map.of("If-Match", ETAG);
    }

    private static List<Write> writes() {
        String server = C12.responseExample("POST", SERVERS, 201, "notes").toString();
        String system = C12.responseExample("PUT", SYSTEM, 200, "notes").toString();
        String override = C12.responseExample("PUT", OVERRIDE, 200, "block_drop_table").toString();
        String mapping = C12.responseExample("PUT", MAPPING, 200, "one_group").toString();
        String approved = C12.responseExample("POST", APPROVE, 200, "nothing_ignored").toString();
        Map<String, String> create = Map.of("If-None-Match", "*");
        Map<String, String> approve = SAME_ORIGIN;
        return List.of(
                new Write("createServer", "POST", "/api/v1/admin/servers", SERVERS, SERVER_BODY, Map.of(), true, GATEWAY,
                        "/admin/v1/servers", 201, server, "server_rejected"),
                new Write("updateServer", "PATCH", "/api/v1/admin/servers/mcp-notes", SERVER, PATCH_BODY, ifMatch(), true,
                        GATEWAY, "/admin/v1/servers/mcp-notes", 200, server, "server_rejected"),
                new Write("deleteServer", "DELETE", "/api/v1/admin/servers/mcp-notes", SERVER, null, Map.of(), true, GATEWAY,
                        "/admin/v1/servers/mcp-notes", 204, "", null),
                new Write("putScopeMapping", "PUT", MAPPING, MAPPING, MAPPING_BODY, ifMatch(), true, GATEWAY,
                        "/admin/v1/policy/scope-mapping", 200, mapping, "scope_mapping_rejected"),
                new Write("putOverrideCreate", "PUT", "/api/v1/admin/policy/overrides/override-block-drop-table", OVERRIDE,
                        OVERRIDE_BODY, create, false, GATEWAY, "/admin/v1/policy/overrides/override-block-drop-table", 200,
                        override, "override_rejected"),
                new Write("putOverrideReplace", "PUT", "/api/v1/admin/policy/overrides/override-block-drop-table", OVERRIDE,
                        OVERRIDE_BODY, ifMatch(), true, GATEWAY, "/admin/v1/policy/overrides/override-block-drop-table", 200,
                        override, "override_rejected"),
                new Write("deleteOverride", "DELETE", "/api/v1/admin/policy/overrides/override-block-drop-table", OVERRIDE,
                        null, ifMatch(), true, GATEWAY, "/admin/v1/policy/overrides/override-block-drop-table", 204, "", null),
                new Write("approveServerPolicies", "POST", "/api/v1/admin/registry/servers/mcp-notes/policies/approve",
                        APPROVE, APPROVE_BODY, approve, true, GATEWAY,
                        "/admin/v1/registry/servers/mcp-notes/policies/approve", 200, approved, null),
                new Write("putSystemCreate", "PUT", "/api/v1/admin/systems/notes", SYSTEM, SYSTEM_BODY, create, true, BROKER,
                        "/v1/admin/systems/notes", 200, system, "system_rejected"),
                new Write("putSystemReplace", "PUT", "/api/v1/admin/systems/notes", SYSTEM, SYSTEM_BODY, ifMatch(), true,
                        BROKER, "/v1/admin/systems/notes", 200, system, "system_rejected"),
                new Write("deleteSystem", "DELETE", "/api/v1/admin/systems/notes", SYSTEM, null, ifMatch(), true, BROKER,
                        "/v1/admin/systems/notes", 204, "", null),
                new Write("approveServerConnection", "POST", "/api/v1/admin/servers/mcp-notes/connection/approve", CONNECTION,
                        CONNECTION_BODY, SAME_ORIGIN, true, GATEWAY, "/admin/v1/servers/mcp-notes/connection/approve", 200,
                        C12.responseExample("POST", CONNECTION, 200, "pinned").toString(), "server_rejected"),
                new Write("refreshServer", "POST", "/api/v1/admin/servers/mcp-notes/refresh", REFRESH, null, Map.of(), false,
                        GATEWAY, "/admin/v1/servers/mcp-notes/refresh", 200,
                        C12.responseExample("POST", REFRESH, 200, "unreachable").toString(), null));
    }

    @AfterEach
    void defaultStubs() {
        GATEWAY.resetToDefaultMappings();
        GATEWAY.resetRequests();
        BROKER.resetToDefaultMappings();
        BROKER.resetRequests();
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

    private static void stub(WireMockServer server, String method, String path, int status, String body, String... headers) {
        ResponseDefinitionBuilder answer = aResponse().withStatus(status).withHeader("Content-Type", "application/json")
                .withBody(body);
        for (int i = 0; i < headers.length; i += 2) {
            answer.withHeader(headers[i], headers[i + 1]);
        }
        server.stubFor(request(method, urlPathEqualTo(path)).atPriority(1).willReturn(answer));
    }

    private static List<LoggedRequest> gatewayAdminRequests() {
        return GATEWAY.findAll(anyRequestedFor(urlPathMatching(ADMIN_GATEWAY_PATHS)));
    }

    private static List<LoggedRequest> brokerAdminRequests() {
        return BROKER.findAll(anyRequestedFor(urlPathMatching(ADMIN_BROKER_PATHS)));
    }

    private static List<LoggedRequest> upstreamRequests(Write write) {
        return write.upstream().findAll(anyRequestedFor(urlPathEqualTo(write.upstreamPath())));
    }

    private HttpResponse<String> call(TestBrowser browser, Write write, Map<String, String> headers) {
        return browser.request(write.method(), write.path(), write.body(), true, headers);
    }

    private HttpResponse<String> callFrom(TestBrowser browser, Write write, String page) {
        Map<String, String> headers = new java.util.LinkedHashMap<>(write.headers());
        headers.put("Referer", "https://mcp-gateway.internal" + page);
        return call(browser, write, headers);
    }

    /** The ETag as the upstream sent it; WireMock marks a compressed answer with a suffix that a real upstream has not. */
    private static String etagOf(HttpResponse<String> response) {
        return response.headers().firstValue("ETag").orElse("").replace("--gzip", "");
    }

    private static List<String[]> reads() {
        return List.of(new String[] {SERVERS, SERVERS}, new String[] {"/api/v1/admin/servers/mcp-notes", SERVER},
                new String[] {MAPPING, MAPPING}, new String[] {OVERRIDES, OVERRIDES},
                new String[] {"/api/v1/admin/policy/overrides/override-block-drop-table", OVERRIDE},
                new String[] {"/api/v1/admin/registry/servers/mcp-notes/policies/pending", PENDING},
                new String[] {"/api/v1/admin/registry/servers/mcp-notes/policies", POLICIES},
                new String[] {SYSTEMS, SYSTEMS}, new String[] {"/api/v1/admin/systems/notes", SYSTEM});
    }

    @Test
    void aUserWithoutTheAdminGroupGetsForbiddenAnswersAndNothingIsSentUpstream() {
        TestBrowser alice = login(ALICE, Instant.now());
        alice.get("/api/v1/me");
        int events = auditEvents().size();

        for (String[] read : reads()) {
            HttpResponse<String> response = alice.get(read[0]);
            C12.assertResponse("GET", read[1], response);
            assertThat(response.statusCode()).as(read[0]).isEqualTo(403);
        }
        for (Write write : writes()) {
            HttpResponse<String> response = call(alice, write, write.headers());
            C12.assertResponse(write.method(), write.template(), response);
            assertThat(response.statusCode()).as(write.name()).isEqualTo(403);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("access_denied");
        }

        assertThat(gatewayAdminRequests()).isEmpty();
        assertThat(brokerAdminRequests()).isEmpty();
        List<JsonNode> refused = auditEvents().subList(events, auditEvents().size());
        assertThat(refused).hasSize(writes().size()).allSatisfy(event -> {
            ContractSchemas.assertValid(AUDIT, event);
            assertThat(event.get("event").asString()).isEqualTo("admin_change");
            assertThat(event.get("reason").asString()).isEqualTo("not_admin");
            assertThat(event.get("decision").asString()).isEqualTo("deny");
        });
    }

    @Test
    void withoutASessionEveryOperationIsUnauthenticated() {
        TestBrowser nobody = browser();
        for (String[] read : reads()) {
            HttpResponse<String> response = nobody.get(read[0]);
            C12.assertResponse("GET", read[1], response);
            assertThat(response.statusCode()).as(read[0]).isEqualTo(401);
        }
        for (Write write : writes()) {
            HttpResponse<String> response = call(nobody, write, write.headers());
            assertThat(response.statusCode()).as(write.name()).isIn(401, 403);
        }
        assertThat(gatewayAdminRequests()).isEmpty();
        assertThat(brokerAdminRequests()).isEmpty();
    }

    @Test
    void theContractExamplesPassThroughWithTheirEtag() {
        TestBrowser admin = admin();
        List<Object[]> cases = List.of(
                new Object[] {GATEWAY, "/admin/v1/servers", SERVERS, SERVERS, "one_server", false},
                new Object[] {GATEWAY, "/admin/v1/servers/mcp-notes", "/api/v1/admin/servers/mcp-notes", SERVER, "notes", true},
                new Object[] {GATEWAY, "/admin/v1/policy/scope-mapping", MAPPING, MAPPING, "two_groups", true},
                new Object[] {GATEWAY, "/admin/v1/policy/overrides", OVERRIDES, OVERRIDES, "one", false},
                new Object[] {GATEWAY, "/admin/v1/policy/overrides/override-block-drop-table",
                        "/api/v1/admin/policy/overrides/override-block-drop-table", OVERRIDE, "block_drop_table", true},
                new Object[] {GATEWAY, "/admin/v1/registry/servers/mcp-notes/policies/pending",
                        "/api/v1/admin/registry/servers/mcp-notes/policies/pending", PENDING, "first_registration", false},
                new Object[] {BROKER, "/v1/admin/systems", SYSTEMS, SYSTEMS, "one", false},
                new Object[] {BROKER, "/v1/admin/systems/notes", "/api/v1/admin/systems/notes", SYSTEM, "notes", true});
        for (Object[] c : cases) {
            WireMockServer upstream = (WireMockServer) c[0];
            String template = (String) c[3];
            JsonNode example = C12.responseExample("GET", template, 200, (String) c[4]);
            stub(upstream, "GET", (String) c[1], 200, example.toString(), "ETag", ETAG);

            HttpResponse<String> response = admin.get((String) c[2]);

            C12.assertResponse("GET", template, response);
            assertThat(response.statusCode()).as((String) c[2]).isEqualTo(200);
            assertThat(JSON.readTree(response.body())).as((String) c[2]).isEqualTo(example);
            if ((Boolean) c[5]) {
                assertThat(etagOf(response)).as((String) c[2]).isEqualTo(ETAG);
            }
        }
        assertThat(gatewayAdminRequests()).allSatisfy(r -> assertThat(r.getHeader("Authorization"))
                .startsWith("Bearer xt-mcp-gateway-admin-"));
        assertThat(brokerAdminRequests()).allSatisfy(r -> assertThat(r.getHeader("Authorization"))
                .startsWith("Bearer xt-mcp-credential-broker-"));
    }

    @Test
    void everyWriteGoesThroughWithItsBodyAndPreconditionsAndAnswersWithTheEtagOfTheUpstream() {
        TestBrowser admin = admin();
        for (Write write : writes()) {
            stub(write.upstream(), write.method(), write.upstreamPath(), write.okStatus(), write.okBody(), "ETag", OTHER_ETAG);

            HttpResponse<String> response = call(admin, write, write.headers());

            C12.assertResponse(write.method(), write.template(), response);
            assertThat(response.statusCode()).as(write.name()).isEqualTo(write.okStatus());
            LoggedRequest sent = upstreamRequests(write).getLast();
            assertThat(sent.getHeader("If-Match")).as(write.name()).isEqualTo(write.headers().get("If-Match"));
            assertThat(sent.getHeader("If-None-Match")).as(write.name()).isEqualTo(write.headers().get("If-None-Match"));
            if (write.body() != null) {
                assertThat(JSON.readTree(sent.getBodyAsString())).as(write.name()).isEqualTo(JSON.readTree(write.body()));
            }
            if (write.okStatus() != 204) {
                assertThat(etagOf(response)).as(write.name()).isEqualTo(OTHER_ETAG);
            }
        }
    }

    @Test
    void aFreshMfaIsAskedForExactlyWhereTheContractAsksForIt() {
        TestBrowser stale = adminWithStaleLogin();
        for (Write write : writes()) {
            write.upstream().resetRequests();
            stub(write.upstream(), write.method(), write.upstreamPath(), write.okStatus(), write.okBody(), "ETag", ETAG);

            HttpResponse<String> response = callFrom(stale, write, "/admin/servers");

            C12.assertResponse(write.method(), write.template(), response);
            if (write.stepUp()) {
                assertThat(response.statusCode()).as(write.name()).isEqualTo(401);
                JsonNode body = JSON.readTree(response.body());
                assertThat(body.get("error").asString()).isEqualTo("step_up_required");
                assertThat(body.get("stepUpUrl").asString()).as(write.name())
                        .isEqualTo("/api/v1/auth/login?stepUp=true&returnPath=/admin/servers");
                assertThat(upstreamRequests(write)).as(write.name()).isEmpty();
            } else {
                assertThat(response.statusCode()).as(write.name()).isEqualTo(write.okStatus());
                assertThat(upstreamRequests(write)).as(write.name()).hasSize(1);
            }
        }
    }

    @Test
    void takingAServerOutOfServiceNeedsNoFreshMfaButEveryOtherChangeDoes() {
        TestBrowser stale = adminWithStaleLogin();
        String server = C12.responseExample("POST", SERVERS, 201, "notes").toString();
        stub(GATEWAY, "PATCH", "/admin/v1/servers/mcp-notes", 200, server, "ETag", ETAG);
        String path = "/api/v1/admin/servers/mcp-notes";

        HttpResponse<String> disable = stale.request("PATCH", path, "{\"enabled\":false}", true, ifMatch());
        C12.assertResponse("PATCH", SERVER, disable);
        assertThat(disable.statusCode()).isEqualTo(200);

        for (String body : List.of("{\"enabled\":true}", "{\"enabled\":false,\"credential\":{\"required\":true,\"acceptedTypes\":[\"user-oauth\"],\"type\":\"user-oauth\"}}",
                "{\"credential\":{\"required\":true,\"acceptedTypes\":[\"user-oauth\"],\"type\":\"user-oauth\"}}")) {
            HttpResponse<String> response = stale.request("PATCH", path, body, true, ifMatch());
            assertThat(response.statusCode()).as(body).isEqualTo(401);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("step_up_required");
        }
        assertThat(GATEWAY.findAll(anyRequestedFor(urlPathEqualTo("/admin/v1/servers/mcp-notes")))).hasSize(1);
    }

    @Test
    void theAddressThePlainHttpFlagAndTheAdapterFlagCannotBeChangedOrSetAfterTheAdd() {
        TestBrowser admin = admin();
        for (String body : List.of("{\"tlsName\":\"mcp-notes.internal\"}", "{\"adapter\":true}",
                "{\"internalUrl\":\"https://mcp-notes.internal:8443/mcp\"}", "{\"allowPlainHttp\":true}",
                "{\"enabled\":false,\"adapter\":false}")) {
            HttpResponse<String> response = admin.request("PATCH", "/api/v1/admin/servers/mcp-notes", body, true, ifMatch());
            C12.assertResponse("PATCH", SERVER, response);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
        }
        HttpResponse<String> create = admin.request("POST", SERVERS,
                SERVER_BODY.replace("\"internalUrl\"", "\"tlsName\":\"mcp-notes.internal\",\"internalUrl\""), true, Map.of());
        assertThat(create.statusCode()).isEqualTo(400);
        assertThat(gatewayAdminRequests()).isEmpty();
    }

    @Test
    void aRefusedOverrideWriteIsAuditedWithItsIdTargetAndTheHashOfItsText() {
        TestBrowser admin = admin();
        stub(GATEWAY, "PUT", "/admin/v1/policy/overrides/override-block-drop-table", 422,
                "{\"error\":\"override_rejected\",\"reason\":\"not_forbid\"}");
        int events = auditEvents().size();

        admin.request("PUT", "/api/v1/admin/policy/overrides/override-block-drop-table", OVERRIDE_BODY, true,
                Map.of("If-None-Match", "*"));

        JsonNode event = auditEvents().get(events);
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("overrideId").asString()).isEqualTo("override-block-drop-table");
        assertThat(event.get("overrideTarget").asString()).isEqualTo("gateway");
        assertThat(event.get("textSha256").asString()).matches("^sha256:[0-9a-f]{64}$");
        assertThat(event.toString()).doesNotContain("principal");
        assertThat(event.get("reason").asString()).isEqualTo("not_forbid");
    }

    @Test
    void aStepUpRefusalIsAuditedWithTheServerItNamed() {
        TestBrowser stale = adminWithStaleLogin();
        int events = auditEvents().size();

        stale.request("DELETE", "/api/v1/admin/servers/mcp-notes", null, true, Map.of());

        JsonNode event = auditEvents().get(events);
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("event").asString()).isEqualTo("admin_change");
        assertThat(event.get("server").asString()).isEqualTo("mcp-notes");
        assertThat(event.get("errorCode").asString()).isEqualTo("step_up_required");
        assertThat(event.get("outcome").asString()).isEqualTo("denied");
    }

    @Test
    void anUpstreamThatFindsTheTokenNotFreshSendsTheBrowserToTheSameStepUp() {
        TestBrowser admin = admin();
        for (Write write : writes()) {
            if (!write.stepUp()) {
                continue;
            }
            stub(write.upstream(), write.method(), write.upstreamPath(), 401, "{\"error\":\"step_up_required\"}");

            HttpResponse<String> response = callFrom(admin, write, "/admin/systems");

            C12.assertResponse(write.method(), write.template(), response);
            assertThat(response.statusCode()).as(write.name()).isEqualTo(401);
            JsonNode body = JSON.readTree(response.body());
            assertThat(body.get("error").asString()).isEqualTo("step_up_required");
            assertThat(body.get("stepUpUrl").asString()).isEqualTo("/api/v1/auth/login?stepUp=true&returnPath=/admin/systems");
        }
    }

    @Test
    void anUpstream401ThatIsNotAMissingStepUpIsAnUnavailableService() {
        TestBrowser admin = admin();
        stub(GATEWAY, "GET", "/admin/v1/servers", 401, "{\"error\":\"unauthenticated\"}");

        HttpResponse<String> response = admin.get(SERVERS);

        assertThat(response.statusCode()).isEqualTo(503);
        assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("upstream_unavailable");
    }

    @Test
    void anOperationThatNeedsIfMatchWithoutOneIsAnswered428WithoutACallAndAMalformedOneIs400() {
        TestBrowser admin = admin();
        for (Write write : writes()) {
            boolean needs = write.headers().containsKey("If-Match") || write.headers().containsKey("If-None-Match");
            if (!needs) {
                continue;
            }
            HttpResponse<String> missing = call(admin, write, Map.of());
            C12.assertResponse(write.method(), write.template(), missing);
            assertThat(missing.statusCode()).as(write.name()).isEqualTo(428);
            assertThat(JSON.readTree(missing.body()).get("error").asString()).isEqualTo("precondition_required");
            HttpResponse<String> malformed = call(admin, write, Map.of("If-Match", "W/\"weak\""));
            C12.assertResponse(write.method(), write.template(), malformed);
            assertThat(malformed.statusCode()).as(write.name()).isEqualTo(400);
            assertThat(upstreamRequests(write)).as(write.name()).isEmpty();
        }
        TestBrowser browser = admin;
        HttpResponse<String> both = browser.request("PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY, true,
                Map.of("If-Match", ETAG, "If-None-Match", "*"));
        assertThat(both.statusCode()).isEqualTo(400);
        HttpResponse<String> otherStar = browser.request("PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY, true,
                Map.of("If-None-Match", "\"x\""));
        assertThat(otherStar.statusCode()).isEqualTo(400);
        assertThat(brokerAdminRequests()).isEmpty();
    }

    @Test
    void whatTheUpstreamsRefuseIsPassedOnAsTheContractSaysAndAuditedWithoutItsText() {
        TestBrowser admin = admin();
        for (Write write : writes()) {
            int events = auditEvents().size();
            boolean precondition = write.headers().containsKey("If-Match") || write.headers().containsKey("If-None-Match");
            if (precondition) {
                stub(write.upstream(), write.method(), write.upstreamPath(), 412, "{\"error\":\"precondition_failed\"}");
                HttpResponse<String> stale = call(admin, write, write.headers());
                C12.assertResponse(write.method(), write.template(), stale);
                assertThat(stale.statusCode()).as(write.name()).isEqualTo(412);
                assertThat(JSON.readTree(stale.body()).get("error").asString()).isEqualTo("precondition_failed");
            }

            stub(write.upstream(), write.method(), write.upstreamPath(), 403, "{\"error\":\"access_denied\"}");
            HttpResponse<String> forbidden = call(admin, write, write.headers());
            assertThat(forbidden.statusCode()).as(write.name()).isEqualTo(403);

            stub(write.upstream(), write.method(), write.upstreamPath(), 503,
                    "{\"error\":\"upstream_unavailable\",\"message\":\"database host pg-marker.internal refused\"}", "Retry-After", "10");
            HttpResponse<String> down = call(admin, write, write.headers());
            C12.assertResponse(write.method(), write.template(), down);
            assertThat(down.statusCode()).as(write.name()).isEqualTo(503);
            assertThat(down.body()).doesNotContain("pg-marker");

            for (JsonNode event : auditEvents().subList(events, auditEvents().size())) {
                ContractSchemas.assertValid(AUDIT, event);
                assertThat(event.toString()).doesNotContain("pg-marker").doesNotContain(CLIENT_SECRET);
            }
        }
    }

    @Test
    void aRejectionOfAnOperationCarriesItsReasonAndASafeMessage() {
        TestBrowser admin = admin();
        for (Write write : writes()) {
            if (write.rejection() == null) {
                continue;
            }
            stub(write.upstream(), write.method(), write.upstreamPath(), 422, "{\"error\":\"" + write.rejection()
                    + "\",\"reason\":\"some_reason\",\"message\":\"a\\u202Eb\"}");

            HttpResponse<String> response = call(admin, write, write.headers());

            C12.assertResponse(write.method(), write.template(), response);
            assertThat(response.statusCode()).as(write.name()).isEqualTo(422);
            JsonNode body = JSON.readTree(response.body());
            assertThat(body.get("error").asString()).isEqualTo(write.rejection());
            assertThat(body.get("reason").asString()).isEqualTo("some_reason");
            assertThat(body.get("message").asString()).isEqualTo("a<U+202E>b");
            JsonNode event = lastAuditEvent();
            ContractSchemas.assertValid(AUDIT, event);
            assertThat(event.get("reason").asString()).isEqualTo("some_reason");
        }
        Write create = writes().getFirst();
        stub(GATEWAY, "POST", "/admin/v1/servers", 422, "{\"error\":\"scope_mapping_rejected\"}");
        assertThat(call(admin, create, create.headers()).statusCode()).as("an error of another operation").isEqualTo(503);
    }

    @Test
    void everyRefusalReasonOfAddingAServerReachesTheBrowserWithItsManifestReason() {
        TestBrowser admin = admin();
        Write create = writes().getFirst();
        for (String example : List.of("address_refused", "plain_http_not_allowed", "tls_handshake_failed",
                "manifest_unreachable", "manifest_invalid", "system_mismatch", "system_reserved", "namespace_conflict")) {
            String upstream = C12.responseExample("POST", SERVERS, 422, example).toString();
            stub(GATEWAY, "POST", "/admin/v1/servers", 422, upstream);

            HttpResponse<String> response = call(admin, create, create.headers());

            C12.assertResponse("POST", SERVERS, response);
            assertThat(response.statusCode()).as(example).isEqualTo(422);
            assertThat(JSON.readTree(response.body())).as(example).isEqualTo(JSON.readTree(upstream));
        }
    }

    @Test
    void theSystemTheAdministratorExpectsIsPassedToTheGatewayAndAMismatchIsA422WithItsReason() {
        TestBrowser admin = admin();
        String withSystem = SERVER_BODY.replace("}", ",\"expectedSystem\":\"notes\"}");
        stub(GATEWAY, "POST", "/admin/v1/servers", 201, C12.responseExample("POST", SERVERS, 201, "notes").toString());
        assertThat(admin.request("POST", SERVERS, withSystem, true, Map.of()).statusCode()).isEqualTo(201);
        assertThat(gatewayAdminRequests()).anySatisfy(request -> {
            assertThat(request.getMethod().getName()).isEqualTo("POST");
            assertThat(JSON.readTree(request.getBodyAsString()).get("expectedSystem").asString()).isEqualTo("notes");
        });

        String upstream = C12.responseExample("POST", SERVERS, 422, "system_mismatch").toString();
        stub(GATEWAY, "POST", "/admin/v1/servers", 422, upstream);
        HttpResponse<String> response = admin.request("POST", SERVERS, withSystem, true, Map.of());
        C12.assertResponse("POST", SERVERS, response);
        assertThat(response.statusCode()).isEqualTo(422);
        assertThat(JSON.readTree(response.body()).get("reason").asString()).isEqualTo("system_mismatch");
    }

    @Test
    void aTlsModeTheCertificateDoesNotAllowIsA422WithItsReason() {
        TestBrowser admin = admin();
        Write connection = writes().get(11);
        String upstream = C12.responseExample("POST", CONNECTION, 422, "tls_mode_not_allowed").toString();
        stub(GATEWAY, "POST", connection.upstreamPath(), 422, upstream);

        HttpResponse<String> response = call(admin, connection, connection.headers());

        C12.assertResponse("POST", CONNECTION, response);
        assertThat(response.statusCode()).isEqualTo(422);
        assertThat(JSON.readTree(response.body()).get("reason").asString()).isEqualTo("tls_mode_not_allowed");
    }

    @Test
    void approvingAConnectionNeedsTheRequestToComeFromThePortalPage() {
        TestBrowser admin = admin();
        Write connection = writes().get(11);

        HttpResponse<String> response = call(admin, connection, Map.of());

        assertThat(response.statusCode()).isEqualTo(403);
        assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("csrf_invalid");
        assertThat(gatewayAdminRequests()).isEmpty();
    }

    @Test
    void aRefreshTheGatewayAnswersWith429IsPassedOnWithItsRetryAfter() {
        TestBrowser admin = admin();
        Write refresh = writes().get(12);
        stub(GATEWAY, "POST", refresh.upstreamPath(), 429, "{\"error\":\"refresh_too_frequent\"}", "Retry-After", "4");

        HttpResponse<String> limited = call(admin, refresh, refresh.headers());

        C12.assertResponse("POST", REFRESH, limited);
        assertThat(limited.statusCode()).isEqualTo(429);
        assertThat(limited.headers().firstValue("Retry-After")).contains("4");
        assertThat(JSON.readTree(limited.body()).get("error").asString()).isEqualTo("refresh_too_frequent");

        stub(GATEWAY, "POST", refresh.upstreamPath(), 429, "{\"error\":\"refresh_too_frequent\"}");
        assertThat(call(admin, refresh, refresh.headers()).headers().firstValue("Retry-After")).contains("5");

        stub(GATEWAY, "POST", refresh.upstreamPath(), 429, "{\"error\":\"rate_limited\"}");
        assertThat(call(admin, refresh, refresh.headers()).statusCode()).as("another 429 is an unavailable upstream")
                .isEqualTo(503);
    }

    @Test
    void aServerWithAChangedCertificateAndAPlainServerPassTheViewCheck() {
        TestBrowser admin = admin();
        String changed = C12.responseExample("GET", SERVERS, 200, "one_server").toString();
        stub(GATEWAY, "GET", "/admin/v1/servers", 200, changed);
        HttpResponse<String> list = admin.get(SERVERS);
        C12.assertResponse("GET", SERVERS, list);
        assertThat(list.statusCode()).isEqualTo(200);
        assertThat(JSON.readTree(list.body()).get(0).get("status").asString()).isEqualTo("certificate_changed");

        String plain = C12.responseExample("POST", SERVERS, 201, "notes").toString()
                .replace("https://mcp-notes.corp.local:8443/mcp", "http://mcp-notes:8080/mcp")
                .replace("\"allowPlainHttp\":false", "\"allowPlainHttp\":true")
                .replace("\"tlsMode\":\"ca\"", "\"tlsMode\":\"plain\"")
                .replaceAll("\"(fingerprint|subject|issuer|notAfter)\":\"[^\"]*\"", "\"$1\":null")
                .replace("\"sans\":[\"mcp-notes.corp.local\"]", "\"sans\":[]")
                .replace("\"validatesAsCa\":true", "\"validatesAsCa\":false");
        stub(GATEWAY, "GET", "/admin/v1/servers/mcp-notes", 200, plain);
        HttpResponse<String> one = admin.get("/api/v1/admin/servers/mcp-notes");
        assertThat(one.statusCode()).isEqualTo(200);
        assertThat(JSON.readTree(one.body()).get("pendingConnection").get("tlsMode").asString()).isEqualTo("plain");
    }

    @Test
    void conflictsAreOnlyThoseTheContractListsForTheOperation() {
        TestBrowser admin = admin();
        Write create = writes().getFirst();
        stub(GATEWAY, "POST", "/admin/v1/servers", 409, "{\"error\":\"server_exists\"}");
        HttpResponse<String> exists = call(admin, create, create.headers());
        C12.assertResponse("POST", SERVERS, exists);
        assertThat(exists.statusCode()).isEqualTo(409);
        assertThat(JSON.readTree(exists.body()).get("error").asString()).isEqualTo("server_exists");

        Write connection = writes().get(11);
        for (String error : List.of("connection_changed", "no_pending_connection")) {
            stub(GATEWAY, "POST", connection.upstreamPath(), 409, "{\"error\":\"" + error + "\"}");
            HttpResponse<String> refused = call(admin, connection, connection.headers());
            C12.assertResponse("POST", CONNECTION, refused);
            assertThat(refused.statusCode()).isEqualTo(409);
            assertThat(JSON.readTree(refused.body()).get("error").asString()).isEqualTo(error);
        }
        stub(GATEWAY, "POST", connection.upstreamPath(), 409, "{\"error\":\"server_exists\"}");
        assertThat(call(admin, connection, connection.headers()).statusCode()).isEqualTo(503);

        Write approve = writes().get(7);
        stub(GATEWAY, "POST", approve.upstreamPath(), 409, "{\"error\":\"hash_mismatch\"}");
        HttpResponse<String> changed = call(admin, approve, approve.headers());
        C12.assertResponse("POST", APPROVE, changed);
        assertThat(changed.statusCode()).isEqualTo(409);
        assertThat(JSON.readTree(changed.body()).get("error").asString()).isEqualTo("hash_mismatch");

        stub(GATEWAY, "POST", approve.upstreamPath(), 409, "{\"error\":\"server_exists\"}");
        assertThat(call(admin, approve, approve.headers()).statusCode()).isEqualTo(503);
    }

    @Test
    void aWellFormedIdWithoutAResourceIsNotFoundAndAMalformedOneIsABadRequestNeverANotFound() {
        TestBrowser admin = admin();
        stub(GATEWAY, "GET", "/admin/v1/servers/mcp-notes", 404, "{\"error\":\"not_found_or_denied\"}");
        HttpResponse<String> missing = admin.get("/api/v1/admin/servers/mcp-notes");
        C12.assertResponse("GET", SERVER, missing);
        assertThat(missing.statusCode()).isEqualTo(404);
        assertThat(JSON.readTree(missing.body()).get("error").asString()).isEqualTo("not_found_or_denied");
        stub(BROKER, "GET", "/v1/admin/systems/notes", 404, "{\"error\":\"not_found_or_denied\"}");
        assertThat(admin.get("/api/v1/admin/systems/notes").statusCode()).isEqualTo(404);
        int upstream = gatewayAdminRequests().size();

        List<String> malformed = List.of("/api/v1/admin/servers/notes", "/api/v1/admin/servers/mcp-gateway",
                "/api/v1/admin/servers/mcp-Notes", "/api/v1/admin/policy/overrides/block",
                "/api/v1/admin/policy/overrides/override-", "/api/v1/admin/systems/Notes", "/api/v1/admin/systems/gateway",
                "/api/v1/admin/registry/servers/mcp-admin/policies/pending", "/api/v1/admin/registry/servers/mcp-admin/policies");
        for (String path : malformed) {
            HttpResponse<String> read = admin.get(path);
            assertThat(read.statusCode()).as(path).isEqualTo(400);
            assertThat(JSON.readTree(read.body()).get("error").asString()).isEqualTo("invalid_request");
        }
        for (String path : List.of("/api/v1/admin/servers/mcp-gateway", "/api/v1/admin/policy/overrides/block",
                "/api/v1/admin/systems/gateway")) {
            for (Map<String, String> headers : List.of(ifMatch(), Map.<String, String>of())) {
                HttpResponse<String> delete = admin.request("DELETE", path, null, true, headers);
                assertThat(delete.statusCode()).as(path).isEqualTo(400);
            }
        }
        for (String path : List.of("/api/v1/admin/policy/overrides/block", "/api/v1/admin/systems/Notes")) {
            HttpResponse<String> put = admin.request("PUT", path, path.contains("override") ? OVERRIDE_BODY : SYSTEM_BODY,
                    true, Map.of("If-None-Match", "*"));
            assertThat(put.statusCode()).as(path).isEqualTo(400);
        }
        HttpResponse<String> approve = admin.request("POST", "/api/v1/admin/registry/servers/mcp-gateway/policies/approve",
                APPROVE_BODY, true, SAME_ORIGIN);
        assertThat(approve.statusCode()).isEqualTo(400);
        assertThat(gatewayAdminRequests()).hasSize(upstream);
        assertThat(brokerAdminRequests()).hasSize(1);
    }

    @Test
    void removingASystemThatDoesNotExistIsAnUpstream204AndAStaleTagIs412() {
        TestBrowser admin = admin();
        stub(BROKER, "DELETE", "/v1/admin/systems/notes", 204, "");
        HttpResponse<String> gone = admin.request("DELETE", "/api/v1/admin/systems/notes", null, true, ifMatch());
        C12.assertResponse("DELETE", SYSTEM, gone);
        assertThat(gone.statusCode()).isEqualTo(204);
        stub(BROKER, "DELETE", "/v1/admin/systems/notes", 412, "{\"error\":\"precondition_failed\"}");
        HttpResponse<String> stale = admin.request("DELETE", "/api/v1/admin/systems/notes", null, true, ifMatch());
        C12.assertResponse("DELETE", SYSTEM, stale);
        assertThat(stale.statusCode()).isEqualTo(412);
    }

    @Test
    void replacingAnOverrideNeedsAFreshMfaButCreatingOneDoesNot() {
        TestBrowser stale = adminWithStaleLogin();
        String override = C12.responseExample("PUT", OVERRIDE, 200, "block_drop_table").toString();
        stub(GATEWAY, "PUT", "/admin/v1/policy/overrides/override-block-drop-table", 200, override, "ETag", ETAG);
        String path = "/api/v1/admin/policy/overrides/override-block-drop-table";

        HttpResponse<String> create = stale.request("PUT", path, OVERRIDE_BODY, true, Map.of("If-None-Match", "*"));
        C12.assertResponse("PUT", OVERRIDE, create);
        assertThat(create.statusCode()).isEqualTo(200);

        HttpResponse<String> replace = stale.request("PUT", path, OVERRIDE_BODY, true,
                Map.of("If-Match", ETAG, "Referer", "https://mcp-gateway.internal/admin/overrides"));
        C12.assertResponse("PUT", OVERRIDE, replace);
        assertThat(replace.statusCode()).isEqualTo(401);
        JsonNode body = JSON.readTree(replace.body());
        assertThat(body.get("error").asString()).isEqualTo("step_up_required");
        assertThat(body.get("stepUpUrl").asString()).isEqualTo("/api/v1/auth/login?stepUp=true&returnPath=/admin/overrides");
        assertThat(GATEWAY.findAll(anyRequestedFor(urlPathEqualTo("/admin/v1/policy/overrides/override-block-drop-table"))))
                .hasSize(1);

        TestBrowser fresh = admin();
        assertThat(fresh.request("PUT", path, OVERRIDE_BODY, true, Map.of("If-Match", ETAG)).statusCode()).isEqualTo(200);
    }

    @Test
    void theApprovedPoliciesOfAServerAreShownWithNullsWhileNothingIsApproved() {
        TestBrowser admin = admin();
        String path = "/api/v1/admin/registry/servers/mcp-notes/policies";
        JsonNode nothing = C12.responseExample("GET", POLICIES, 200, "nothing_approved");
        stub(GATEWAY, "GET", "/admin/v1/registry/servers/mcp-notes/policies", 200, nothing.toString());

        HttpResponse<String> response = admin.get(path);

        C12.assertResponse("GET", POLICIES, response);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(JSON.readTree(response.body())).isEqualTo(nothing);

        String approved = "{\"approvedHash\":\"" + HASH + "\",\"approvedPolicies\":{\"namespace\":\"Notes\","
                + "\"schema\":\"namespace Notes {}\",\"files\":[{\"name\":\"read.cedar\",\"text\":\"a\\u202Eb\"}]},"
                + "\"approvedResourceTypes\":[{\"type\":\"Notes::Folder\",\"attributes\":[\"name\"],"
                + "\"idPattern\":\"^[a-z]+$\",\"scopePattern\":\"^[a-z]+$\",\"earlyScopeCheck\":true}]}";
        stub(GATEWAY, "GET", "/admin/v1/registry/servers/mcp-notes/policies", 200, approved);
        HttpResponse<String> shown = admin.get(path);
        C12.assertResponse("GET", POLICIES, shown);
        assertThat(shown.body()).contains("a<U+202E>b").contains(HASH);

        stub(GATEWAY, "GET", "/admin/v1/registry/servers/mcp-notes/policies", 404, "{\"error\":\"not_found_or_denied\"}");
        HttpResponse<String> unknown = admin.get(path);
        C12.assertResponse("GET", POLICIES, unknown);
        assertThat(unknown.statusCode()).isEqualTo(404);

        for (String broken : List.of("{}", "{\"approvedHash\":null,\"approvedPolicies\":null}",
                "{\"approvedHash\":\"sha256:abc\",\"approvedPolicies\":null,\"approvedResourceTypes\":null}",
                "{\"approvedHash\":null,\"approvedPolicies\":null,\"approvedResourceTypes\":null,\"x\":1}",
                "{\"approvedHash\":null,\"approvedPolicies\":null,\"approvedResourceTypes\":[{\"type\":\"x\"}]}")) {
            stub(GATEWAY, "GET", "/admin/v1/registry/servers/mcp-notes/policies", 200, broken);
            assertThat(admin.get(path).statusCode()).as(broken).isEqualTo(503);
        }
        stub(GATEWAY, "GET", "/admin/v1/registry/servers/mcp-notes/policies", 503, "{\"error\":\"upstream_unavailable\"}");
        assertThat(admin.get(path).statusCode()).isEqualTo(503);
    }

    @Test
    void aDisplayNameOfASystemIsCheckedGoingInAndNeutralizedComingOut() {
        TestBrowser admin = admin();
        String view = C12.responseExample("PUT", SYSTEM, 200, "notes").toString();
        stub(BROKER, "PUT", "/v1/admin/systems/notes", 200, view);
        String plain = SYSTEM_BODY.replaceAll("\"displayName\":\"[^\"]*\",?", "");
        String named = "{\"displayName\":\"Notes\"," + plain.substring(1);
        assertThat(admin.request("PUT", "/api/v1/admin/systems/notes", named, true, Map.of("If-None-Match", "*"))
                .statusCode()).isEqualTo(200);
        assertThat(admin.request("PUT", "/api/v1/admin/systems/notes", plain, true, Map.of("If-None-Match", "*"))
                .statusCode()).isEqualTo(200);
        int sent = brokerAdminRequests().size();

        for (String name : List.of("\"\"", "\"" + "x".repeat(65) + "\"", "\"a\\u0000b\"", "\"a\\u200Bb\"", "\"a\\u202Eb\"",
                "\"a\\u2028b\"", "\"a\\nb\"", "5", "null")) {
            String body = "{\"displayName\":" + name + "," + plain.substring(1);
            HttpResponse<String> response = admin.request("PUT", "/api/v1/admin/systems/notes", body, true,
                    Map.of("If-None-Match", "*"));
            assertThat(response.statusCode()).as(name).isEqualTo(400);
        }
        assertThat(brokerAdminRequests()).hasSize(sent);
        assertThat(admin.request("PUT", "/api/v1/admin/systems/notes",
                "{\"displayName\":\"" + "x".repeat(64) + "\"," + plain.substring(1), true,
                Map.of("If-None-Match", "*")).statusCode()).isEqualTo(200);

        stub(BROKER, "GET", "/v1/admin/systems/notes", 200, view.replace("\"displayName\":\"Notes\"", "\"displayName\":\"No\\u202Etes\""));
        HttpResponse<String> shown = admin.get("/api/v1/admin/systems/notes");
        C12.assertResponse("GET", SYSTEM, shown);
        assertThat(JSON.readTree(shown.body()).get("displayName").asString()).isEqualTo("No<U+202E>tes");
        stub(BROKER, "GET", "/v1/admin/systems/notes", 200, view.replace("\"displayName\":\"Notes\",", ""));
        assertThat(admin.get("/api/v1/admin/systems/notes").statusCode()).as("always present in the view").isEqualTo(503);
    }

    @Test
    void anAdministrationBodyOverTheLimitIsRefusedByItsLengthBeforeItIsReadAndNeverReachesAnUpstream() {
        TestBrowser admin = admin();
        String large = "{\"scopeMapping\":[],\"pad\":\"" + "x".repeat(70_000) + "\"}";

        for (Write write : writes()) {
            if (write.body() == null) {
                continue;
            }
            HttpResponse<String> response = admin.request(write.method(), write.path(), large, true, write.headers());
            assertThat(response.statusCode()).as(write.name()).isEqualTo(400);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("invalid_request");
            assertThat(response.headers().firstValue("X-Request-Id")).isPresent();
        }
        assertThat(gatewayAdminRequests()).isEmpty();
        assertThat(brokerAdminRequests()).isEmpty();
    }

    @Test
    void aBodyOfUnknownLengthIsCutWhileItIsReadAndAUserWithoutTheGroupIsNotAnswered400ForItsSize() {
        TestBrowser admin = admin();
        java.util.function.Supplier<java.io.InputStream> endless = () -> new java.io.InputStream() {
            private long sent;

            @Override
            public int read() {
                return sent++ < 200_000 ? '"' : -1;
            }
        };
        HttpResponse<String> chunked = admin.requestWith("PUT", MAPPING,
                java.net.http.HttpRequest.BodyPublishers.ofInputStream(endless), true, ifMatch());
        assertThat(chunked.statusCode()).isEqualTo(400);

        TestBrowser alice = login(ALICE, Instant.now());
        alice.get("/api/v1/me");
        String large = "{\"scopeMapping\":[],\"pad\":\"" + "x".repeat(70_000) + "\"}";
        assertThat(alice.request("PUT", MAPPING, large, true, ifMatch()).statusCode()).isEqualTo(403);
        assertThat(alice.requestWith("PUT", MAPPING, java.net.http.HttpRequest.BodyPublishers.ofInputStream(endless), true,
                ifMatch()).statusCode()).isEqualTo(403);
        assertThat(gatewayAdminRequests()).isEmpty();
    }

    @Test
    void bodiesOutsideTheSchemasNeverReachAnUpstream() {
        TestBrowser admin = admin();
        List<String[]> bad = List.of(
                new String[] {"POST", SERVERS, "{}"},
                new String[] {"POST", SERVERS, SERVER_BODY.replace("https://", "ftp://")},
                new String[] {"POST", SERVERS, SERVER_BODY.replace("https://", "https://x y")},
                new String[] {"POST", SERVERS, SERVER_BODY.replace("}", ",\"extra\":1}")},
                new String[] {"POST", SERVERS, SERVER_BODY.replace("}", ",\"serverId\":\"mcp-notes\"}")},
                new String[] {"POST", SERVERS, SERVER_BODY.replace("}", ",\"allowPlainHttp\":\"yes\"}")},
                new String[] {"POST", SERVERS, SERVER_BODY.replace("}", ",\"expectedSystem\":\"Notes\"}")},
                new String[] {"POST", SERVERS, SERVER_BODY.replace("}", ",\"expectedSystem\":\"gateway\"}")},
                new String[] {"POST", SERVERS, SERVER_BODY.replace("}", ",\"expectedSystem\":5}")},
                new String[] {"POST", SERVERS, SERVER_BODY.replace("}", ",\"credential\":{\"required\":true,\"acceptedTypes\":[],\"type\":\"user-oauth\"}}")},
                new String[] {"POST", SERVERS, "{\"internalUrl\":\"https://" + "h".repeat(250) + "\"}"},
                new String[] {"POST", SERVERS, "not json"},
                new String[] {"POST", SERVERS, "[]"},
                new String[] {"POST", SERVERS, "{\"internalUrl\":\"https://a.b\",\"internalUrl\":\"https://a.b\"}"},
                new String[] {"POST", "/api/v1/admin/servers/mcp-notes/connection/approve", "{}"},
                new String[] {"POST", "/api/v1/admin/servers/mcp-notes/connection/approve", "{\"tlsMode\":\"ca\"}"},
                new String[] {"POST", "/api/v1/admin/servers/mcp-notes/connection/approve", CONNECTION_BODY.replace("pinned", "none")},
                new String[] {"POST", "/api/v1/admin/servers/mcp-notes/connection/approve", CONNECTION_BODY.replace("sha256:", "sha1:")},
                new String[] {"POST", "/api/v1/admin/servers/mcp-notes/connection/approve", CONNECTION_BODY.replace("}", ",\"x\":1}")},
                new String[] {"POST", "/api/v1/admin/servers/mcp-gateway/connection/approve", CONNECTION_BODY},
                new String[] {"PATCH", "/api/v1/admin/servers/mcp-notes", "{}"},
                new String[] {"PATCH", "/api/v1/admin/servers/mcp-notes", "{\"serverId\":\"mcp-other\"}"},
                new String[] {"PATCH", "/api/v1/admin/servers/mcp-notes", "{\"adapter\":true}"},
                new String[] {"PATCH", "/api/v1/admin/servers/mcp-notes", "{\"enabled\":\"no\"}"},
                new String[] {"PUT", MAPPING, "{}"},
                new String[] {"PUT", MAPPING, "{\"scopeMapping\":[{\"group\":\"jira\",\"scopes\":[]}]}"},
                new String[] {"PUT", MAPPING, "{\"scopeMapping\":[{\"group\":\"mcp-a\",\"scopes\":[\"Jira::Project/a b\"]}]}"},
                new String[] {"PUT", MAPPING, "{\"scopeMapping\":[{\"group\":\"mcp-a\",\"scopes\":[\"Jira::Project/A\",\"Jira::Project/A\"]}]}"},
                new String[] {"PUT", MAPPING, "{\"scopeMapping\":[{\"group\":\"mcp-a\"}]}"},
                new String[] {"PUT", "/api/v1/admin/policy/overrides/override-x", "{\"target\":\"gateway\"}"},
                new String[] {"PUT", "/api/v1/admin/policy/overrides/override-x", "{\"target\":\"some server\",\"text\":\"forbid (principal, action, resource);\"}"},
                new String[] {"PUT", "/api/v1/admin/policy/overrides/override-x", "{\"target\":\"gateway\",\"text\":\"forbid\\u202E\"}"},
                new String[] {"PUT", "/api/v1/admin/policy/overrides/override-x", "{\"target\":\"gateway\",\"text\":\"" + "x".repeat(8001) + "\"}"},
                new String[] {"POST", "/api/v1/admin/registry/servers/mcp-notes/policies/approve", "{}"},
                new String[] {"POST", "/api/v1/admin/registry/servers/mcp-notes/policies/approve", "{\"policiesHash\":\"sha256:abc\"}"},
                new String[] {"POST", "/api/v1/admin/registry/servers/mcp-notes/policies/approve", APPROVE_BODY.replace("}", ",\"x\":1}")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", "{}"},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("https://notes.internal/api", "http://notes.internal/api")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("generic-rest", "atlassian-dc")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"adapter\"", "\"product\":\"jira\",\"adapter\"")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"adapter\"", "\"exchangeAudience\":\"x\",\"adapter\"")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("generic-rest", "ftp")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"Bearer\"", "\"Digest\"")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"adapter\"", "\"userSecretScheme\":\"Token\",\"adapter\"")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", OAUTH_SYSTEM_BODY.replace("\"clientId\"", "\"password\":\"x\",\"clientId\"")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", OAUTH_SYSTEM_BODY.replace("\"scopes\":[\"read_api\"]", "\"scopes\":[\"a b\"]")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", OAUTH_SYSTEM_BODY.replace("[\"user-oauth\"]", "[\"user-oauth\",\"user-oauth\"]")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("generic-rest", "gitlab")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"path\":\"/api/me\"", "\"path\":\"api/me\"")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"path\":\"/api/me\"", "\"path\":\"//evil.test/me\"")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"path\":\"/api/me\"", "\"path\":\"/api/../me\"")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"path\":\"/api/me\"", "\"path\":\"/api/me?x=1\"")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"path\":\"/api/me\"", "\"path\":\"https://evil.test/me\"")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"path\":\"/api/me\"", "\"path\":\"/" + "a".repeat(512) + "\"")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"usernameField\":\"username\"", "\"usernameField\":\"a b\"")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"usernameField\":\"username\"", "\"usernameField\":\"/a//b\"")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"usernameField\":\"username\"", "\"usernameField\":\"\"")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"usernameField\":\"username\"", "\"usernameField\":\"u\",\"extra\":1")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"whoami\":{\"path\":\"/api/me\",\"usernameField\":\"username\"}", "\"whoami\":{\"path\":\"/api/me\"}")},
                new String[] {"PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY.replace("\"whoami\":{\"path\":\"/api/me\",\"usernameField\":\"username\"}", "\"whoami\":\"/api/me\"")});
        for (String[] request : bad) {
            Map<String, String> headers = switch (request[0]) {
                case "PATCH", "PUT" -> request[1].contains("/overrides/") || request[1].contains("/systems/")
                        ? Map.of("If-None-Match", "*") : ifMatch();
                default -> Map.of();
            };
            HttpResponse<String> response = admin.request(request[0], request[1], request[2], true, headers.isEmpty()
                    ? SAME_ORIGIN : headers);
            assertThat(response.statusCode()).as(request[0] + " " + request[1] + " " + request[2]).isEqualTo(400);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("invalid_request");
        }
        assertThat(gatewayAdminRequests()).isEmpty();
        assertThat(brokerAdminRequests()).isEmpty();
    }

    @Test
    void anAnswerThatBreaksTheClosedSchemaIsNotShown() {
        TestBrowser admin = admin();
        String server = C12.responseExample("GET", SERVER, 200, "notes").toString();
        for (String broken : List.of(server.replace("mcp-notes", "mcp-gateway"),
                server.replace("https://mcp-notes.corp.local:8443/mcp", "ftp://mcp-notes.corp.local/mcp"),
                server.replace("\"status\":\"connected\"", "\"status\":\"fine\""),
                server.replace("\"allowPlainHttp\":false,", ""),
                server.replace("\"tlsMode\":\"ca\"", "\"tlsMode\":\"tls\""),
                server.replace("sha256:3b556e5421d66b7508742a96b309dc4c404075d02797d8fe5b38d76d1c870d14", "sha256:ABC"),
                server.replace("\"pendingConnection\":null", "\"pendingConnection\":{\"tlsMode\":\"ca\"}"),
                server.replace("\"enabled\":true", "\"enabled\":\"yes\""),
                server.replace("}", ",\"secret\":\"x\"}"))) {
            stub(GATEWAY, "GET", "/admin/v1/servers/mcp-notes", 200, broken);
            assertThat(admin.get("/api/v1/admin/servers/mcp-notes").statusCode()).as(broken).isEqualTo(503);
        }
        stub(GATEWAY, "GET", "/admin/v1/servers", 200, "{}");
        assertThat(admin.get(SERVERS).statusCode()).isEqualTo(503);

        stub(GATEWAY, "GET", "/admin/v1/policy/scope-mapping", 200,
                "{\"scopeMapping\":[{\"group\":\"mcp-a\",\"scopes\":[\"not a scope\"]}]}");
        assertThat(admin.get(MAPPING).statusCode()).isEqualTo(503);
        stub(GATEWAY, "GET", "/admin/v1/policy/overrides", 200,
                "[{\"id\":\"drop\",\"target\":\"gateway\",\"text\":\"t\",\"setBy\":\"s\",\"setAt\":\"2026-11-06T09:30:00Z\"}]");
        assertThat(admin.get(OVERRIDES).statusCode()).isEqualTo(503);

        String pending = C12.responseExample("GET", PENDING, 200, "first_registration").toString();
        for (String broken : List.of(pending.replace("\"source\":\"manifest\"", "\"source\":\"adapter\""),
                pending.replace(HASH, "sha256:abc"), pending.replace("\"pendingVersion\":\"1.4.0\"", "\"pendingVersion\":\"x\""),
                pending.replace("Jira::Project", "jira::project"))) {
            stub(GATEWAY, "GET", "/admin/v1/registry/servers/mcp-notes/policies/pending", 200, broken);
            assertThat(admin.get("/api/v1/admin/registry/servers/mcp-notes/policies/pending").statusCode()).as(broken)
                    .isEqualTo(503);
        }
    }

    @Test
    void aGenericRestSystemWithUserSecretsAndAWhoamiGoesThroughTheMirrorsBothWays() {
        TestBrowser admin = admin();
        String view = C12.responseExample("PUT", SYSTEM, 200, "notes").toString();
        stub(BROKER, "PUT", "/v1/admin/systems/notes", 200, view, "ETag", ETAG);
        stub(BROKER, "GET", "/v1/admin/systems/notes", 200, view, "ETag", ETAG);

        HttpResponse<String> put = admin.request("PUT", "/api/v1/admin/systems/notes", SYSTEM_BODY, true,
                Map.of("If-None-Match", "*"));
        C12.assertResponse("PUT", SYSTEM, put);
        assertThat(put.statusCode()).isEqualTo(200);
        assertThat(JSON.readTree(brokerAdminRequests().getLast().getBodyAsString()).get("whoami"))
                .isEqualTo(JSON.readTree(SYSTEM_BODY).get("whoami"));
        assertThat(JSON.readTree(put.body()).get("whoami").get("path").asString()).isEqualTo("/api/me");

        HttpResponse<String> get = admin.get("/api/v1/admin/systems/notes");
        C12.assertResponse("GET", SYSTEM, get);
        assertThat(JSON.readTree(get.body()).get("whoami").get("usernameField").asString()).isEqualTo("username");

        String pointer = SYSTEM_BODY.replace("\"usernameField\":\"username\"", "\"usernameField\":\"/data/user/login\"");
        assertThat(admin.request("PUT", "/api/v1/admin/systems/notes", pointer, true, Map.of("If-None-Match", "*"))
                .statusCode()).isEqualTo(200);
        String noWhoami = SYSTEM_BODY.replaceAll(",\"whoami\":\\{[^}]*\\}", "");
        assertThat(noWhoami).doesNotContain("whoami");
        assertThat(admin.request("PUT", "/api/v1/admin/systems/notes", noWhoami, true, Map.of("If-None-Match", "*"))
                .statusCode()).isEqualTo(200);

        for (String broken : List.of(view.replace("generic-rest", "gitlab"),
                view.replace("\"path\":\"/api/me\"", "\"path\":\"//evil.test\""),
                view.replace("\"usernameField\":\"username\"", "\"usernameField\":\"a b\""),
                view.replace("}}", "},\"whoami2\":1}"))) {
            stub(BROKER, "GET", "/v1/admin/systems/notes", 200, broken);
            assertThat(admin.get("/api/v1/admin/systems/notes").statusCode()).as(broken).isEqualTo(503);
        }
    }

    @Test
    void aGenericRestSystemWithAUserOauthTypeIsTheBrokersRefusalAndItsReasonIsPassedOn() {
        TestBrowser admin = admin();
        stub(BROKER, "PUT", "/v1/admin/systems/notes", 422, "{\"error\":\"system_rejected\","
                + "\"reason\":\"credential_type_not_supported_by_adapter\",\"message\":\"generic-rest takes no user-oauth\"}");
        String body = SYSTEM_BODY.replace("[\"user-secret\"]", "[\"user-oauth\"]").replace("\"defaultType\":\"user-secret\"",
                "\"defaultType\":\"user-oauth\"");

        HttpResponse<String> response = admin.request("PUT", "/api/v1/admin/systems/notes", body, true,
                Map.of("If-None-Match", "*"));

        C12.assertResponse("PUT", SYSTEM, response);
        assertThat(response.statusCode()).isEqualTo(422);
        JsonNode answer = JSON.readTree(response.body());
        assertThat(answer.get("error").asString()).isEqualTo("system_rejected");
        assertThat(answer.get("reason").asString()).isEqualTo("credential_type_not_supported_by_adapter");
        ContractSchemas.assertValid(AUDIT, lastAuditEvent());
        assertThat(lastAuditEvent().get("reason").asString()).isEqualTo("credential_type_not_supported_by_adapter");
    }

    @Test
    void aClientSecretGoesToTheBrokerAndNeverBackOrIntoTheLogs() {
        SECRETS.add(CLIENT_SECRET);
        TestBrowser admin = admin();
        String view = OAUTH_SYSTEM_VIEW;
        stub(BROKER, "PUT", "/v1/admin/systems/notes", 200, view, "ETag", ETAG);

        HttpResponse<String> response = admin.request("PUT", "/api/v1/admin/systems/notes", OAUTH_SYSTEM_BODY, true,
                Map.of("If-None-Match", "*"));

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).doesNotContain(CLIENT_SECRET).contains("\"clientSecretSet\":true");
        assertThat(brokerAdminRequests().getLast().getBodyAsString()).contains(CLIENT_SECRET);

        String leaking = view.replace("\"clientSecretSet\":true", "\"clientSecretSet\":true,\"clientSecret\":\"" + CLIENT_SECRET + "\"");
        stub(BROKER, "GET", "/v1/admin/systems/notes", 200, leaking);
        HttpResponse<String> refused = admin.get("/api/v1/admin/systems/notes");
        assertThat(refused.statusCode()).isEqualTo(503);
        assertThat(refused.body()).doesNotContain(CLIENT_SECRET);

        stub(BROKER, "PUT", "/v1/admin/systems/notes", 422, "{\"error\":\"system_rejected\",\"reason\":\"client_secret_required\","
                + "\"message\":\"clientSecret is required\"}");
        HttpResponse<String> needsSecret = admin.request("PUT", "/api/v1/admin/systems/notes", OAUTH_SYSTEM_BODY, true,
                Map.of("If-Match", ETAG));
        C12.assertResponse("PUT", SYSTEM, needsSecret);
        assertThat(JSON.readTree(needsSecret.body()).get("reason").asString()).isEqualTo("client_secret_required");
    }

    @Test
    void hiddenCharactersInPolicyTextAreWrittenOutAndTheHashStaysTheOriginalOne() {
        TestBrowser admin = admin();
        String pending = C12.responseExample("GET", PENDING, 200, "first_registration").toString()
                .replace("jira-read", "jira\\u202Eread");
        stub(GATEWAY, "GET", "/admin/v1/registry/servers/mcp-notes/policies/pending", 200, pending);

        HttpResponse<String> response = admin.get("/api/v1/admin/registry/servers/mcp-notes/policies/pending");

        C12.assertResponse("GET", PENDING, response);
        assertThat(response.body()).contains("jira<U+202E>read").contains(HASH);

        stub(GATEWAY, "GET", "/admin/v1/policy/overrides/override-block-drop-table", 200,
                C12.responseExample("GET", OVERRIDE, 200, "block_drop_table").toString().replace("drop_table\\\"", "drop\\u200Btable\\\""));
        HttpResponse<String> override = admin.get("/api/v1/admin/policy/overrides/override-block-drop-table");
        assertThat(override.statusCode()).isEqualTo(200);
        assertThat(override.body()).contains("<U+200B>");
    }

    @Test
    void approvingPoliciesNeedsTheRequestToComeFromThePortalPage() {
        TestBrowser admin = admin();
        Write connection = writes().get(11);
        for (String error : List.of("connection_changed", "no_pending_connection")) {
            stub(GATEWAY, "POST", connection.upstreamPath(), 409, "{\"error\":\"" + error + "\"}");
            HttpResponse<String> refused = call(admin, connection, connection.headers());
            C12.assertResponse("POST", CONNECTION, refused);
            assertThat(refused.statusCode()).isEqualTo(409);
            assertThat(JSON.readTree(refused.body()).get("error").asString()).isEqualTo(error);
        }
        stub(GATEWAY, "POST", connection.upstreamPath(), 409, "{\"error\":\"server_exists\"}");
        assertThat(call(admin, connection, connection.headers()).statusCode()).isEqualTo(503);

        Write approve = writes().get(7);
        stub(GATEWAY, "POST", approve.upstreamPath(), 200, approve.okBody());
        for (Map<String, String> headers : List.of(Map.<String, String>of(), Map.of("Sec-Fetch-Site", "cross-site"),
                Map.of("Sec-Fetch-Site", "same-site"))) {
            HttpResponse<String> response = call(admin, approve, headers);
            C12.assertResponse("POST", APPROVE, response);
            assertThat(response.statusCode()).isEqualTo(403);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("csrf_invalid");
        }
        assertThat(upstreamRequests(approve)).isEmpty();
        assertThat(call(admin, approve, SAME_ORIGIN).statusCode()).isEqualTo(200);
    }

    @Test
    void theIgnoredMappingEntriesOfAnApprovalAreShownToTheAdministrator() {
        TestBrowser admin = admin();
        Write connection = writes().get(11);
        for (String error : List.of("connection_changed", "no_pending_connection")) {
            stub(GATEWAY, "POST", connection.upstreamPath(), 409, "{\"error\":\"" + error + "\"}");
            HttpResponse<String> refused = call(admin, connection, connection.headers());
            C12.assertResponse("POST", CONNECTION, refused);
            assertThat(refused.statusCode()).isEqualTo(409);
            assertThat(JSON.readTree(refused.body()).get("error").asString()).isEqualTo(error);
        }
        stub(GATEWAY, "POST", connection.upstreamPath(), 409, "{\"error\":\"server_exists\"}");
        assertThat(call(admin, connection, connection.headers()).statusCode()).isEqualTo(503);

        Write approve = writes().get(7);
        String result = "{\"ignoredMappingEntries\":[{\"group\":\"mcp-team-platform\",\"scope\":\"Jira::Project/PLAT\","
                + "\"reason\":\"undeclared_type\"}]}";
        stub(GATEWAY, "POST", approve.upstreamPath(), 200, result);

        HttpResponse<String> response = call(admin, approve, SAME_ORIGIN);

        C12.assertResponse("POST", APPROVE, response);
        assertThat(JSON.readTree(response.body())).isEqualTo(JSON.readTree(result));
    }

    @Test
    void aRequestThatIsNotJsonOrIsTooLargeIsRefusedWithoutACall() {
        TestBrowser admin = admin();
        HttpResponse<String> large = admin.request("PUT", "/api/v1/admin/systems/notes",
                "{\"baseUrl\":\"https://x.internal\",\"pad\":\"" + "x".repeat(70_000) + "\"}", true,
                Map.of("If-None-Match", "*"));
        assertThat(large.statusCode()).isEqualTo(400);
        HttpResponse<String> empty = admin.request("PUT", MAPPING, null, true, ifMatch());
        assertThat(empty.statusCode()).isEqualTo(400);
        assertThat(gatewayAdminRequests()).isEmpty();
        assertThat(brokerAdminRequests()).isEmpty();
    }
}
