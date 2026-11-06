package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.put;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.support.ContractSchemas;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;

/**
 * A secret stored without a check (CC-247): the connection has {@code verified} false and no backend user. The answers of
 * C12 carry both as the contract says, the catalog derives its status from the status of the connection alone, and the
 * audit event has no backend user.
 */
class ConnectionVerifiedTest extends PortalHarness {

    private static final String CONNECTIONS = "/api/v1/connections";
    private static final String SECRET_TEMPLATE = "/api/v1/connections/{system}/secret";

    @AfterEach
    void defaultStubs() {
        BROKER.resetToDefaultMappings();
        BROKER.resetRequests();
        GATEWAY.resetToDefaultMappings();
    }

    private TestBrowser alice() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        return browser;
    }

    private static void stub(String method, String path, int status, String body) {
        var mapping = "PUT".equals(method) ? put(urlPathEqualTo(path)) : get(urlPathEqualTo(path));
        BROKER.stubFor(mapping.atPriority(1).willReturn(aResponse().withStatus(status)
                .withHeader("Content-Type", "application/json").withBody(body)));
    }

    private static String connection(String verified, String backendUser) {
        return "{\"system\":\"jira\",\"type\":\"user-secret\",\"status\":\"connected\",\"backendUser\":" + backendUser
                + (verified == null ? "" : ",\"verified\":" + verified)
                + ",\"expiresAt\":null,\"connectedAt\":\"2026-10-01T08:00:00Z\",\"lastUsedAt\":null}";
    }

    @Test
    void anUnverifiedConnectionWithoutABackendUserIsListedAsItIs() {
        stub("GET", "/v1/connections", 200, "[" + connection("false", "null") + "]");

        HttpResponse<String> response = alice().get(CONNECTIONS);

        C12.assertResponse("GET", CONNECTIONS, response);
        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode first = JSON.readTree(response.body()).get(0);
        assertThat(first.get("verified").asBoolean()).isFalse();
        assertThat(first.get("backendUser").isNull()).isTrue();
        assertThat(first.get("status").asString()).isEqualTo("connected");
    }

    @Test
    void aVerifiedConnectionKeepsItsBackendUser() {
        stub("GET", "/v1/connections", 200, "[" + connection("true", "\"anna\"") + "]");

        HttpResponse<String> response = alice().get(CONNECTIONS);

        C12.assertResponse("GET", CONNECTIONS, response);
        JsonNode first = JSON.readTree(response.body()).get(0);
        assertThat(first.get("verified").asBoolean()).isTrue();
        assertThat(first.get("backendUser").asString()).isEqualTo("anna");
    }

    @Test
    void aConnectionWithoutTheRequiredVerifiedFieldBreaksTheContractAndIsLeftOut() {
        stub("GET", "/v1/connections", 200, "[" + connection(null, "\"anna\"") + "," + connection("true", "\"bob\"")
                .replace("\"jira\"", "\"gitlab\"") + "]");

        HttpResponse<String> response = alice().get(CONNECTIONS);

        C12.assertResponse("GET", CONNECTIONS, response);
        List<JsonNode> kept = JSON.readTree(response.body()).valueStream().toList();
        assertThat(kept).singleElement().satisfies(c -> assertThat(c.get("system").asString()).isEqualTo("gitlab"));
    }

    @Test
    void theCatalogStatusDoesNotDependOnTheBackendUser() {
        stub("GET", "/v1/connections", 200, "[" + connection("false", "null") + "]");

        HttpResponse<String> response = alice().get("/api/v1/catalog");

        C12.assertResponse("GET", "/api/v1/catalog", response);
        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode jira = null;
        for (JsonNode server : JSON.readTree(response.body()).get("servers")) {
            if ("jira".equals(server.get("system").asString())) {
                jira = server;
            }
        }
        assertThat(jira).isNotNull();
        assertThat(jira.get("connection").get("verified").asBoolean()).isFalse();
        assertThat(jira.get("connection").get("backendUser").isNull()).isTrue();
        assertThat(jira.get("status").asString()).isIn("connected", "expiring");
        assertThat(jira.get("actions").valueStream().map(JsonNode::asString)).contains("disconnect");
    }

    @Test
    void aSecretStoredWithoutACheckIsAnsweredWithVerifiedFalseAndAuditedWithoutABackendUser() {
        stub("PUT", "/v1/connections/jira/secret", 200,
                "{\"status\":\"connected\",\"backendUser\":null,\"verified\":false,\"expiresAt\":null}");
        int events = auditEvents().size();

        HttpResponse<String> response = alice().put("/api/v1/connections/jira/secret", "{\"secret\":\"test-only-token\"}", true);

        C12.assertResponse("PUT", SECRET_TEMPLATE, response);
        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode body = JSON.readTree(response.body());
        assertThat(body.get("verified").asBoolean()).isFalse();
        assertThat(body.get("backendUser").isNull()).isTrue();
        JsonNode event = auditEvents().get(events);
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.has("backendUser")).isFalse();
        assertThat(event.get("outcome").asString()).isEqualTo("ok");
    }

    @Test
    void aVerifiedSecretKeepsTheBackendUserInTheAnswerAndTheAudit() {
        stub("PUT", "/v1/connections/jira/secret", 200,
                "{\"status\":\"connected\",\"backendUser\":\"anna\",\"verified\":true,\"expiresAt\":null}");
        int events = auditEvents().size();

        HttpResponse<String> response = alice().put("/api/v1/connections/jira/secret", "{\"secret\":\"test-only-token\"}", true);

        C12.assertResponse("PUT", SECRET_TEMPLATE, response);
        assertThat(JSON.readTree(response.body()).get("backendUser").asString()).isEqualTo("anna");
        assertThat(auditEvents().get(events).get("backendUser").asString()).isEqualTo("anna");
    }

    @Test
    void aSecretAnswerWithoutVerifiedBreaksTheContractAndIsAnUnavailableService() {
        stub("PUT", "/v1/connections/jira/secret", 200,
                "{\"status\":\"connected\",\"backendUser\":\"anna\",\"expiresAt\":null}");

        HttpResponse<String> response = alice().put("/api/v1/connections/jira/secret", "{\"secret\":\"test-only-token\"}", true);

        C12.assertResponse("PUT", SECRET_TEMPLATE, response);
        assertThat(response.statusCode()).isEqualTo(503);
    }

    private JsonNode jiraCredential(String systemInfo) {
        stub("GET", "/v1/systems", 200, "[" + systemInfo + "]");
        HttpResponse<String> response = alice().get("/api/v1/catalog");
        C12.assertResponse("GET", "/api/v1/catalog", response);
        assertThat(response.statusCode()).isEqualTo(200);
        for (JsonNode server : JSON.readTree(response.body()).get("servers")) {
            if ("jira".equals(server.get("system").asString())) {
                return server.get("credential");
            }
        }
        throw new AssertionError("no jira server in the catalog");
    }

    private static String systemInfo(String extra) {
        return "{\"system\":\"jira\",\"supportedTypes\":[\"user-secret\"],\"defaultType\":\"user-secret\","
                + "\"oauthScopes\":[]" + extra + "}";
    }

    @Test
    void theCatalogCredentialCarriesTheDisplayNameAndAnUnverifiedFlagWhenTheBrokerTellsThem() {
        JsonNode credential = jiraCredential(systemInfo(",\"displayName\":\"Jira Data Center\",\"userSecretVerified\":false"));

        assertThat(credential.get("displayName").asString()).isEqualTo("Jira Data Center");
        assertThat(credential.get("userSecretVerified").asBoolean()).isFalse();
    }

    @Test
    void aVerifiedFlagThatIsTrueIsCopiedToo() {
        JsonNode credential = jiraCredential(systemInfo(",\"userSecretVerified\":true"));

        assertThat(credential.get("userSecretVerified").asBoolean()).isTrue();
        assertThat(credential.has("displayName")).isFalse();
    }

    @Test
    void whatTheBrokerDoesNotTellIsAbsentFromTheCatalogCredential() {
        JsonNode credential = jiraCredential(systemInfo(""));

        assertThat(credential.has("displayName")).isFalse();
        assertThat(credential.has("userSecretVerified")).isFalse();
    }

    @Test
    void aDisplayNameThatBreaksTheContractIsDroppedNotShown() {
        for (String name : List.of("", "x".repeat(65), "a\\u202Eb", "a\\u200Bb", "a\\u0000b", "a\\u2028b")) {
            JsonNode credential = jiraCredential(systemInfo(",\"displayName\":\"" + name + "\""));
            assertThat(credential.has("displayName")).as(name).isFalse();
            assertThat(credential.get("defaultType").asString()).isEqualTo("user-secret");
        }
    }
}
