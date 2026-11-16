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

import com.github.tomakehurst.wiremock.verification.LoggedRequest;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;

/**
 * The write-only service account key of a system (CC-251): the proxy over C4, the fresh MFA on the writes, and the
 * promise that the value, the login and the password come back in no answer and no log line.
 */
class ServiceAccountKeyTest extends PortalHarness {

    private static final String KEY = "/api/v1/admin/systems/{system}/service-account-key";
    private static final String SYSTEM = "/api/v1/admin/systems/{system}";
    private static final String KEY_PATH = "/api/v1/admin/systems/notes/service-account-key";
    private static final String UPSTREAM_PATH = "/v1/admin/systems/notes/service-account-key";
    private static final String TOKEN_VALUE = "test-only-service-token-0000000000";
    private static final String LOGIN = "test-only-service-login";
    private static final String PASSWORD = "test-only-service-password";
    private static final String TOKEN_BODY = "{\"value\":\"" + TOKEN_VALUE + "\",\"expiresAt\":\"2027-03-01T00:00:00Z\"}";
    private static final String PAIR_BODY = "{\"username\":\"" + LOGIN + "\",\"password\":\"" + PASSWORD + "\"}";
    private static final Map<String, String> NO_HEADERS = Map.of();

    @AfterEach
    void defaultStubs() {
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

    private static void stub(String method, String path, int status, String body) {
        BROKER.stubFor(request(method, urlPathEqualTo(path)).atPriority(1).willReturn(
                aResponse().withStatus(status).withHeader("Content-Type", "application/json").withBody(body)));
    }

    private static List<LoggedRequest> keyRequests() {
        return BROKER.findAll(anyRequestedFor(urlPathEqualTo(UPSTREAM_PATH)));
    }

    private static List<LoggedRequest> brokerRequests() {
        return BROKER.findAll(anyRequestedFor(urlPathMatching("/v1/admin/.*")));
    }

    private static void remember() {
        SECRETS.add(TOKEN_VALUE);
        SECRETS.add(LOGIN);
        SECRETS.add(PASSWORD);
    }

    @Test
    void aUserWithoutTheAdminGroupIsRefusedAndNothingReachesTheBroker() {
        remember();
        TestBrowser alice = login(ALICE, Instant.now());
        alice.get("/api/v1/me");

        HttpResponse<String> read = alice.get(KEY_PATH);
        HttpResponse<String> put = alice.request("PUT", KEY_PATH, TOKEN_BODY, true, NO_HEADERS);
        HttpResponse<String> delete = alice.request("DELETE", KEY_PATH, null, true, NO_HEADERS);

        for (HttpResponse<String> response : List.of(read, put, delete)) {
            assertThat(response.statusCode()).isEqualTo(403);
        }
        C12.assertResponse("GET", KEY, read);
        C12.assertResponse("PUT", KEY, put);
        C12.assertResponse("DELETE", KEY, delete);
        assertThat(brokerRequests()).isEmpty();
    }

    @Test
    void withoutASessionNothingIsAnswered() {
        TestBrowser nobody = browser();
        assertThat(nobody.get(KEY_PATH).statusCode()).isEqualTo(401);
        assertThat(nobody.request("PUT", KEY_PATH, TOKEN_BODY, true, NO_HEADERS).statusCode()).isIn(401, 403);
        assertThat(nobody.request("DELETE", KEY_PATH, null, true, NO_HEADERS).statusCode()).isIn(401, 403);
        assertThat(brokerRequests()).isEmpty();
    }

    @Test
    void theStatusPassesThroughWithoutAFreshMfaAndCarriesNoKey() {
        TestBrowser stale = adminWithStaleLogin();
        for (String example : List.of("set", "not_set")) {
            JsonNode status = C12.responseExample("GET", KEY, 200, example);
            stub("GET", UPSTREAM_PATH, 200, status.toString());

            HttpResponse<String> response = stale.get(KEY_PATH);

            C12.assertResponse("GET", KEY, response);
            assertThat(response.statusCode()).isEqualTo(200);
            assertThat(JSON.readTree(response.body())).isEqualTo(status);
        }
        LoggedRequest sent = keyRequests().getLast();
        assertThat(sent.getHeader("Authorization")).startsWith("Bearer xt-mcp-credential-broker-");
    }

    @Test
    void aWriteGoesToTheBrokerWithItsBodyAndTheAnswerIsTheStatusWithoutTheKey() {
        remember();
        TestBrowser admin = admin();
        JsonNode stored = C12.responseExample("PUT", KEY, 200, "stored");
        stub("PUT", UPSTREAM_PATH, 200, stored.toString());

        for (String body : List.of(TOKEN_BODY, PAIR_BODY, "{\"value\":\"" + TOKEN_VALUE + "\"}")) {
            HttpResponse<String> response = admin.request("PUT", KEY_PATH, body, true, NO_HEADERS);

            C12.assertResponse("PUT", KEY, response);
            assertThat(response.statusCode()).isEqualTo(200);
            assertThat(JSON.readTree(response.body())).isEqualTo(stored);
            assertThat(response.body()).doesNotContain(TOKEN_VALUE, LOGIN, PASSWORD);
            LoggedRequest sent = keyRequests().getLast();
            assertThat(JSON.readTree(sent.getBodyAsString())).isEqualTo(JSON.readTree(body));
            assertThat(sent.getHeader("If-Match")).isNull();
            assertThat(sent.getHeader("If-None-Match")).isNull();
            assertThat(sent.getHeader("Authorization")).startsWith("Bearer xt-mcp-credential-broker-");
        }
    }

    @Test
    void removingTheKeyIsA204AlsoWhenThereWasNone() {
        TestBrowser admin = admin();
        stub("DELETE", UPSTREAM_PATH, 204, "");

        HttpResponse<String> response = admin.request("DELETE", KEY_PATH, null, true, NO_HEADERS);

        C12.assertResponse("DELETE", KEY, response);
        assertThat(response.statusCode()).isEqualTo(204);
        assertThat(keyRequests()).hasSize(1);
        assertThat(keyRequests().getFirst().getMethod().getName()).isEqualTo("DELETE");
    }

    @Test
    void settingAndRemovingTheKeyNeedAFreshMfaAndSendNothingWithoutIt() {
        remember();
        TestBrowser stale = adminWithStaleLogin();
        stub("PUT", UPSTREAM_PATH, 200, C12.responseExample("PUT", KEY, 200, "stored").toString());
        stub("DELETE", UPSTREAM_PATH, 204, "");
        Map<String, String> from = Map.of("Referer", "https://mcp-gateway.internal/admin/systems");

        HttpResponse<String> put = stale.request("PUT", KEY_PATH, TOKEN_BODY, true, from);
        HttpResponse<String> delete = stale.request("DELETE", KEY_PATH, null, true, from);

        for (HttpResponse<String> response : List.of(put, delete)) {
            assertThat(response.statusCode()).isEqualTo(401);
            JsonNode body = JSON.readTree(response.body());
            assertThat(body.get("error").asString()).isEqualTo("step_up_required");
            assertThat(body.get("stepUpUrl").asString())
                    .isEqualTo("/api/v1/auth/login?stepUp=true&returnPath=/admin/systems");
            assertThat(response.body()).doesNotContain(TOKEN_VALUE);
        }
        C12.assertResponse("PUT", KEY, put);
        C12.assertResponse("DELETE", KEY, delete);
        assertThat(keyRequests()).isEmpty();
        List<JsonNode> refused = auditEvents().stream().filter(e -> "step_up_required".equals(e.path("reason").asString()))
                .toList();
        assertThat(refused).hasSizeGreaterThanOrEqualTo(2).allSatisfy(event -> {
            assertThat(event.toString()).doesNotContain(TOKEN_VALUE, LOGIN, PASSWORD);
            assertThat(event.get("event").asString()).isEqualTo("admin_change");
        });
    }

    @Test
    void anUpstreamThatFindsTheTokenNotFreshSendsTheBrowserToTheSameStepUp() {
        remember();
        TestBrowser admin = admin();
        stub("PUT", UPSTREAM_PATH, 401, "{\"error\":\"step_up_required\"}");

        HttpResponse<String> response = admin.request("PUT", KEY_PATH, TOKEN_BODY, true,
                Map.of("Referer", "https://mcp-gateway.internal/admin/systems"));

        C12.assertResponse("PUT", KEY, response);
        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("step_up_required");
    }

    @Test
    void aRejectionKeepsItsReasonAndNeverRepeatsTheSubmittedValue() {
        remember();
        TestBrowser admin = admin();
        JsonNode rejected = C12.responseExample("PUT", KEY, 422, "expires_at_in_past");
        stub("PUT", UPSTREAM_PATH, 422, rejected.toString());

        HttpResponse<String> past = admin.request("PUT", KEY_PATH, TOKEN_BODY, true, NO_HEADERS);

        C12.assertResponse("PUT", KEY, past);
        assertThat(past.statusCode()).isEqualTo(422);
        assertThat(JSON.readTree(past.body()).get("error").asString()).isEqualTo("service_account_key_rejected");
        assertThat(JSON.readTree(past.body()).get("reason").asString()).isEqualTo("expires_at_in_past");

        for (String quoted : List.of(TOKEN_VALUE, PASSWORD, LOGIN)) {
            stub("PUT", UPSTREAM_PATH, 422, "{\"error\":\"service_account_key_rejected\",\"reason\":\"value_not_basic_credential\","
                    + "\"message\":\"cannot decode " + quoted + "\"}");
            String body = quoted.equals(TOKEN_VALUE) ? TOKEN_BODY : PAIR_BODY;

            HttpResponse<String> response = admin.request("PUT", KEY_PATH, body, true, NO_HEADERS);

            C12.assertResponse("PUT", KEY, response);
            assertThat(response.statusCode()).isEqualTo(422);
            assertThat(response.body()).doesNotContain(quoted);
            assertThat(JSON.readTree(response.body()).get("reason").asString()).isEqualTo("value_not_basic_credential");
        }
        for (String reason : List.of("system_not_service_account", "basic_scheme_required")) {
            stub("PUT", UPSTREAM_PATH, 422, "{\"error\":\"service_account_key_rejected\",\"reason\":\"" + reason
                    + "\",\"message\":\"not accepted\"}");
            HttpResponse<String> response = admin.request("PUT", KEY_PATH, TOKEN_BODY, true, NO_HEADERS);
            assertThat(JSON.readTree(response.body()).get("reason").asString()).isEqualTo(reason);
            assertThat(JSON.readTree(response.body()).has("message")).isFalse();
        }
    }

    @Test
    void theFreeTextOfABrokerRefusalIsNeverForwardedInAnyForm() {
        remember();
        TestBrowser admin = admin();
        String base64Basic = java.util.Base64.getEncoder().encodeToString((LOGIN + ":" + PASSWORD).getBytes());
        List<String> texts = List.of("bad credential " + base64Basic, "fragment " + TOKEN_VALUE.substring(5, 20),
                "unrelated text about the secret store", base64Basic.substring(3, 12));
        for (String text : texts) {
            for (int status : List.of(422, 400, 503)) {
                String body = "{\"error\":\"" + (status == 422 ? "service_account_key_rejected" : "invalid_request")
                        + "\",\"reason\":\"value_not_basic_credential\",\"message\":\"" + text + "\"}";
                stub("PUT", UPSTREAM_PATH, status, body);
                stub("DELETE", UPSTREAM_PATH, status, body);
                stub("GET", UPSTREAM_PATH, status, body);

                List<HttpResponse<String>> answers = List.of(
                        admin.request("PUT", KEY_PATH, TOKEN_BODY, true, NO_HEADERS),
                        admin.request("DELETE", KEY_PATH, null, true, NO_HEADERS), admin.get(KEY_PATH));

                for (HttpResponse<String> answer : answers) {
                    assertThat(answer.body()).as(status + " " + text).doesNotContain(text, "message");
                }
                if (status == 422) {
                    JsonNode put = JSON.readTree(answers.getFirst().body());
                    assertThat(put.get("error").asString()).isEqualTo("service_account_key_rejected");
                    assertThat(put.get("reason").asString()).isEqualTo("value_not_basic_credential");
                    assertThat(put.has("message")).isFalse();
                }
            }
        }
    }

    @Test
    void whatTheBrokerRefusesIsPassedOnAsTheContractSays() {
        TestBrowser admin = admin();
        stub("GET", UPSTREAM_PATH, 404, "{\"error\":\"not_found_or_denied\"}");
        stub("PUT", UPSTREAM_PATH, 404, "{\"error\":\"not_found_or_denied\"}");
        stub("DELETE", UPSTREAM_PATH, 403, "{\"error\":\"access_denied\"}");

        HttpResponse<String> read = admin.get(KEY_PATH);
        HttpResponse<String> put = admin.request("PUT", KEY_PATH, TOKEN_BODY, true, NO_HEADERS);
        HttpResponse<String> delete = admin.request("DELETE", KEY_PATH, null, true, NO_HEADERS);

        assertThat(read.statusCode()).isEqualTo(404);
        assertThat(put.statusCode()).isEqualTo(404);
        assertThat(delete.statusCode()).isEqualTo(403);
        C12.assertResponse("GET", KEY, read);
        C12.assertResponse("PUT", KEY, put);
        C12.assertResponse("DELETE", KEY, delete);

        stub("GET", UPSTREAM_PATH, 503, "{\"error\":\"upstream_unavailable\"}");
        stub("PUT", UPSTREAM_PATH, 503, "{\"error\":\"upstream_unavailable\"}");
        assertThat(admin.get(KEY_PATH).statusCode()).isEqualTo(503);
        assertThat(admin.request("PUT", KEY_PATH, TOKEN_BODY, true, NO_HEADERS).statusCode()).isEqualTo(503);
    }

    @Test
    void aBodyOutsideTheSchemaNeverReachesTheBroker() {
        remember();
        TestBrowser admin = admin();
        List<String> bodies = List.of(
                "{}",
                "{\"expiresAt\":\"2027-03-01T00:00:00Z\"}",
                "{\"value\":\"a\",\"username\":\"u\",\"password\":\"p\"}",
                "{\"value\":\"a\",\"password\":\"p\"}",
                "{\"username\":\"u\"}",
                "{\"password\":\"p\"}",
                "{\"value\":\"has space\"}",
                "{\"value\":\"\"}",
                "{\"value\":12}",
                "{\"value\":\"" + "a".repeat(4097) + "\"}",
                "{\"username\":\"a:b\",\"password\":\"p\"}",
                "{\"username\":\"a\\u200bb\",\"password\":\"p\"}",
                "{\"username\":\"u\",\"password\":\"\"}",
                "{\"value\":\"a\",\"expiresAt\":\"2027-03-01\"}",
                "{\"value\":\"a\",\"expiresAt\":\"2027-03-01T01:00:00+01:00\"}",
                "{\"value\":\"a\",\"note\":\"x\"}",
                "{\"value\":\"a\",\"value\":\"b\"}",
                "[\"a\"]",
                "not json");
        for (String body : bodies) {
            HttpResponse<String> response = admin.request("PUT", KEY_PATH, body, true, NO_HEADERS);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("invalid_request");
            assertThat(response.body()).doesNotContain(TOKEN_VALUE, PASSWORD);
        }
        HttpResponse<String> noBody = admin.request("PUT", KEY_PATH, null, true, NO_HEADERS);
        assertThat(noBody.statusCode()).isEqualTo(400);
        for (String path : List.of("/api/v1/admin/systems/Notes/service-account-key",
                "/api/v1/admin/systems/gateway/service-account-key")) {
            assertThat(admin.get(path).statusCode()).as(path).isEqualTo(400);
            assertThat(admin.request("PUT", path, TOKEN_BODY, true, NO_HEADERS).statusCode()).as(path).isEqualTo(400);
            assertThat(admin.request("DELETE", path, null, true, NO_HEADERS).statusCode()).as(path).isEqualTo(400);
        }
        assertThat(brokerRequests()).isEmpty();
    }

    @Test
    void anAnswerThatCouldCarryTheKeyIsNotShown() {
        remember();
        TestBrowser admin = admin();
        JsonNode status = C12.responseExample("PUT", KEY, 200, "stored");
        String stored = status.toString();
        for (String broken : List.of(
                stored.replace("}", ",\"value\":\"" + TOKEN_VALUE + "\"}"),
                stored.replace("}", ",\"password\":\"" + PASSWORD + "\"}"),
                stored.replace("\"set\":true", "\"set\":\"yes\""),
                stored.replace("\"kvVersion\":4", "\"kvVersion\":0"),
                stored.replace("2027-03-01T00:00:00Z", "tomorrow"),
                stored.replace("\"system\":\"notes\"", "\"system\":\"Notes\""))) {
            stub("PUT", UPSTREAM_PATH, 200, broken);
            stub("GET", UPSTREAM_PATH, 200, broken);

            HttpResponse<String> put = admin.request("PUT", KEY_PATH, TOKEN_BODY, true, NO_HEADERS);
            HttpResponse<String> read = admin.get(KEY_PATH);

            assertThat(put.statusCode()).as(broken).isEqualTo(503);
            assertThat(read.statusCode()).as(broken).isEqualTo(503);
            assertThat(put.body() + read.body()).doesNotContain(TOKEN_VALUE, PASSWORD);
        }
    }

    @Test
    void theKeySummaryOfASystemViewIsShownAndAnInconsistentOneIsNot() {
        TestBrowser admin = admin();
        String view = C12.responseExample("GET", SYSTEM, 200, "notes").toString();
        String set = "\"serviceAccountKey\":{\"state\":\"set\",\"expiresAt\":\"2027-03-01T00:00:00Z\",\"expired\":false}";
        for (String summary : List.of(set, "\"serviceAccountKey\":{\"state\":\"missing\"}",
                "\"serviceAccountKey\":{\"state\":\"unknown\"}")) {
            String withKey = view.substring(0, view.length() - 1) + "," + summary + "}";
            stub("GET", "/v1/admin/systems/notes", 200, withKey);

            HttpResponse<String> response = admin.get("/api/v1/admin/systems/notes");

            assertThat(response.statusCode()).as(summary).isEqualTo(200);
            assertThat(JSON.readTree(response.body()).get("serviceAccountKey")).isEqualTo(JSON.readTree("{" + summary + "}")
                    .get("serviceAccountKey"));
        }
        for (String summary : List.of("\"serviceAccountKey\":{\"state\":\"missing\",\"expired\":true}",
                "\"serviceAccountKey\":{\"state\":\"unknown\",\"expiresAt\":\"2027-03-01T00:00:00Z\"}",
                "\"serviceAccountKey\":{\"state\":\"gone\"}", "\"serviceAccountKey\":{\"expired\":false}",
                "\"serviceAccountKey\":{\"state\":\"set\",\"value\":\"" + TOKEN_VALUE + "\"}",
                "\"serviceAccountKey\":{\"state\":\"set\",\"kvVersion\":3}", "\"serviceAccountKey\":\"set\"")) {
            String broken = view.substring(0, view.length() - 1) + "," + summary + "}";
            stub("GET", "/v1/admin/systems/notes", 200, broken);
            HttpResponse<String> response = admin.get("/api/v1/admin/systems/notes");
            assertThat(response.statusCode()).as(summary).isEqualTo(503);
            assertThat(response.body()).doesNotContain(TOKEN_VALUE);
        }
    }
}
