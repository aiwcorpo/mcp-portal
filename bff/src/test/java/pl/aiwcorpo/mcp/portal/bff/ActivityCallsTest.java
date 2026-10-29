package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.List;

import com.github.tomakehurst.wiremock.verification.LoggedRequest;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;

/** {@code GET /api/v1/activity/calls} (CC-095): checked filters, the cursor untouched, rows checked against the schema. */
class ActivityCallsTest extends PortalHarness {

    private static final String PATH = "/admin/v1/activity/calls";
    private static final String CURSOR = "eyJwIjoiMjAyNi0xMC0yNlQxOTo1MDowMFoiLCJtIjoiYWJjMTIzIn0.c2ln";

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

    private static List<LoggedRequest> gatewayRequests() {
        return GATEWAY.findAll(anyRequestedFor(urlPathEqualTo(PATH)));
    }

    private static void stub(int status, String cursor, String body) {
        var response = aResponse().withStatus(status).withHeader("Content-Type", "application/json").withBody(body);
        if (cursor != null) {
            response = response.withHeader("X-Next-Cursor", cursor);
        }
        GATEWAY.stubFor(get(urlPathEqualTo(PATH)).atPriority(1).willReturn(response));
    }

    @Test
    void rowsAndTheNextCursorComeFromTheGateway() {
        HttpResponse<String> response = session().get("/api/v1/activity/calls");

        C12.assertResponse("GET", "/api/v1/activity/calls", response);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("X-Next-Cursor")).hasValue(CURSOR);
        JsonNode rows = JSON.readTree(response.body());
        assertThat(rows.size()).isGreaterThan(3);
        assertThat(rows.get(0).get("tool").asString()).isEqualTo("jira__get_issue");
        LoggedRequest sent = gatewayRequests().getFirst();
        assertThat(sent.getHeader("Authorization")).startsWith("Bearer xt-mcp-gateway-admin-");
        assertThat(sent.getQueryParams()).isEmpty();
    }

    @Test
    void filtersAndTheCursorAreForwardedUnchanged() {
        String url = "/api/v1/activity/calls?limit=25&from=2026-10-01T00:00:00Z&to=2026-10-28T10:00:00.5Z"
                + "&result=confirmation&q=delete_issue&cursor=" + CURSOR;

        HttpResponse<String> response = session().get(url);

        C12.assertResponse("GET", "/api/v1/activity/calls", response);
        LoggedRequest sent = gatewayRequests().getFirst();
        assertThat(sent.queryParameter("limit").firstValue()).isEqualTo("25");
        assertThat(sent.queryParameter("from").firstValue()).isEqualTo("2026-10-01T00:00:00Z");
        assertThat(sent.queryParameter("to").firstValue()).isEqualTo("2026-10-28T10:00:00.5Z");
        assertThat(sent.queryParameter("result").firstValue()).isEqualTo("confirmation");
        assertThat(sent.queryParameter("q").firstValue()).isEqualTo("delete_issue");
        assertThat(sent.queryParameter("cursor").firstValue()).isEqualTo(CURSOR);
    }

    @Test
    void aSearchTextWithSpecialCharactersIsEncodedNotInterpreted() {
        session().get("/api/v1/activity/calls?q=a%26sub%3Dother%20b%2Bc");

        LoggedRequest sent = gatewayRequests().getFirst();
        assertThat(sent.queryParameter("q").firstValue()).isEqualTo("a&sub=other b+c");
        assertThat(sent.queryParameter("sub").isPresent()).isFalse();
    }

    @Test
    void parametersOutsideTheContractAreNotForwarded() {
        session().get("/api/v1/activity/calls?sub=someone-else&username=bob&limit=5");

        LoggedRequest sent = gatewayRequests().getFirst();
        assertThat(sent.getQueryParams().keySet()).containsExactly("limit");
    }

    @Test
    void invalidFiltersAreRefusedWithoutAskingTheGateway() {
        TestBrowser browser = session();
        String longCursor = "a".repeat(257);

        for (String query : List.of("limit=0", "limit=201", "limit=abc", "limit=-1", "limit=1&limit=2", "limit=",
                "from=yesterday", "from=2026-10-01T00:00:00%2B01:00", "to=2026-10-01", "result=bogus", "result=OK",
                "q=", "q=" + "x".repeat(65), "q=a%00b", "q=a%0ab", "cursor=" + longCursor, "cursor=a%20b", "cursor=")) {
            HttpResponse<String> response = browser.get("/api/v1/activity/calls?" + query);
            C12.assertResponse("GET", "/api/v1/activity/calls", response);
            assertThat(response.statusCode()).as(query).isEqualTo(400);
        }
        assertThat(gatewayRequests()).isEmpty();
    }

    @Test
    void aCursorTheGatewayRejectsIsABadRequestAndOtherFailuresAreUnavailable() {
        TestBrowser browser = session();
        stub(400, null, "{\"error\":\"invalid_request\"}");

        HttpResponse<String> tampered = browser.get("/api/v1/activity/calls?cursor=" + CURSOR);
        C12.assertResponse("GET", "/api/v1/activity/calls", tampered);
        assertThat(tampered.statusCode()).isEqualTo(400);

        HttpResponse<String> badFilter = browser.get("/api/v1/activity/calls?from=2020-01-01T00:00:00Z");
        C12.assertResponse("GET", "/api/v1/activity/calls", badFilter);
        assertThat(badFilter.statusCode()).isEqualTo(400);

        stub(500, null, "{\"error\":\"internal_error\"}");
        HttpResponse<String> broken = browser.get("/api/v1/activity/calls?limit=5");
        C12.assertResponse("GET", "/api/v1/activity/calls", broken);
        assertThat(broken.statusCode()).isEqualTo(503);
    }

    @Test
    void rowsOutsideTheContractAreDroppedAndAnUnsafeCursorIsNotPassedOn() {
        TestBrowser browser = session();
        stub(200, null, """
                [{"requestId":"0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e7f","ts":"2026-10-26T20:00:00.123Z",
                  "tool":"jira__get_issue","result":"ok","errorCode":null},
                 {"requestId":"not-a-uuid","ts":"2026-10-26T20:00:00Z","tool":"jira__get_issue","result":"ok"},
                 {"requestId":"0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e80","ts":"2026-10-26T20:00:00Z",
                  "tool":"jira__get_issue","result":"ok","wrongCodeCount":9},
                 {"requestId":"0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e82","ts":"2026-10-26T20:00:00Z",
                  "client":"claude\u202e-code","tool":"jira__get_issue","result":"ok"},
                 {"requestId":"0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e81","ts":"2026-10-26T20:00:00Z",
                  "tool":"jira__delete_issue","risk":"DESTRUCTIVE","result":"cancelled","wrongCodeCount":0,
                  "errorCode":"confirmation_cancelled","resource":{"type":"Jira::Issue","id":"ABC-1"}}]""");

        HttpResponse<String> response = browser.get("/api/v1/activity/calls");

        C12.assertResponse("GET", "/api/v1/activity/calls", response);
        JsonNode rows = JSON.readTree(response.body());
        assertThat(rows).hasSize(2);
        assertThat(rows.get(1).get("result").asString()).isEqualTo("cancelled");
        assertThat(response.headers().firstValue("X-Next-Cursor")).isEmpty();

        stub(200, "bad cursor with spaces", "[]");
        assertThat(browser.get("/api/v1/activity/calls").statusCode()).isEqualTo(503);
    }

    @Test
    void rowsWithFieldsOutsideTheSchemaAreDropped() {
        TestBrowser browser = session();
        stub(200, null, """
                [{"requestId":"0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e01","ts":"2026-10-26T20:00:00.000Z",
                  "tool":"jira__get_issue","result":"ok","arguments":{"issueKey":"ABC-123"}},
                 {"requestId":"0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e02","ts":"2026-10-26T20:00:00.000Z",
                  "tool":"jira__get_issue","result":"ok","confirmation_code":"123456"},
                 {"requestId":"0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e03","ts":"2026-10-26T20:00:00.000Z",
                  "tool":"jira__get_issue","result":"ok","resource":{"type":"Jira::Issue","id":"ABC-1","name":"x"}},
                 {"requestId":"0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e04","ts":"2026-10-26T20:00:00.000Z",
                  "tool":"jira__get_issue","result":"ok"}]""");

        HttpResponse<String> response = browser.get("/api/v1/activity/calls");

        C12.assertResponse("GET", "/api/v1/activity/calls", response);
        JsonNode rows = JSON.readTree(response.body());
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).get("requestId").asString()).endsWith("6e04");
    }

    @Test
    void rateLimitedAndCredentialRequiredRowsAreShownAndEveryResultGroupIsForwarded() {
        // CC-142: rate_limited belongs to the group denied, credential_required to error; the gateway groups, the BFF
        // only checks that the group is one of the four and passes the rows on.
        TestBrowser browser = session();
        stub(200, null, """
                [{"requestId":"0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e11","ts":"2026-10-26T20:00:00.000Z",
                  "tool":"jira__get_issue","risk":"READ_ONLY","result":"rate_limited","errorCode":"rate_limited"},
                 {"requestId":"0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e12","ts":"2026-10-26T20:00:01.000Z",
                  "tool":"gitlab__get_project","result":"credential_required","errorCode":"credential_required"}]""");

        HttpResponse<String> response = browser.get("/api/v1/activity/calls?result=denied");

        C12.assertResponse("GET", "/api/v1/activity/calls", response);
        JsonNode rows = JSON.readTree(response.body());
        assertThat(rows).hasSize(2);
        assertThat(rows.get(0).get("result").asString()).isEqualTo("rate_limited");
        assertThat(rows.get(1).get("errorCode").asString()).isEqualTo("credential_required");
        assertThat(gatewayRequests().getLast().queryParameter("result").firstValue()).isEqualTo("denied");
        for (String group : List.of("ok", "error", "confirmation")) {
            assertThat(browser.get("/api/v1/activity/calls?result=" + group).statusCode()).as(group).isEqualTo(200);
            assertThat(gatewayRequests().getLast().queryParameter("result").firstValue()).isEqualTo(group);
        }
    }

    @Test
    void theRowsOfAServiceAccountSystemCarryWhatTheLastUseIsReadFrom() {
        // CC-150: "last use" of a service account is the newest row with result ok, confirmed or error of the system's
        // tools; the portal computes it from these rows, there is no field of its own. Denials and expiries stay in
        // the list but do not count, so the BFF must pass every one of them through unchanged.
        TestBrowser browser = session();
        stub(200, null, """
                [{"requestId":"0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e21","ts":"2026-10-26T20:05:00.000Z",
                  "tool":"servicedesk__get_ticket","risk":"READ_ONLY","result":"denied_policy","errorCode":"access_denied"},
                 {"requestId":"0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e22","ts":"2026-10-26T20:04:00.000Z",
                  "tool":"servicedesk__close_ticket","risk":"DESTRUCTIVE","result":"expired","errorCode":"confirmation_failed",
                  "wrongCodeCount":1,"resource":{"type":"ServiceDesk::Ticket","id":"IT-42"}},
                 {"requestId":"0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e23","ts":"2026-10-26T20:03:00.000Z",
                  "tool":"servicedesk__close_ticket","risk":"DESTRUCTIVE","result":"confirmed","wrongCodeCount":0,
                  "resource":{"type":"ServiceDesk::Ticket","id":"IT-41"}},
                 {"requestId":"0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e24","ts":"2026-10-26T20:02:00.000Z",
                  "tool":"servicedesk__get_ticket","risk":"READ_ONLY","result":"error","errorCode":"upstream_unavailable"},
                 {"requestId":"0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e25","ts":"2026-10-26T20:01:00.000Z",
                  "tool":"servicedesk__get_ticket","risk":"READ_ONLY","result":"ok"}]""");

        HttpResponse<String> response = browser.get("/api/v1/activity/calls?q=servicedesk__&limit=50");

        C12.assertResponse("GET", "/api/v1/activity/calls", response);
        JsonNode rows = JSON.readTree(response.body());
        assertThat(rows).hasSize(5);
        assertThat(rows.valueStream().map(row -> row.get("result").asString()))
                .containsExactly("denied_policy", "expired", "confirmed", "error", "ok");
        assertThat(gatewayRequests().getLast().queryParameter("q").firstValue()).isEqualTo("servicedesk__");
    }

    @Test
    void withoutASessionTheAnswerIs401() {
        HttpResponse<String> response = browser().get("/api/v1/activity/calls");

        C12.assertResponse("GET", "/api/v1/activity/calls", response);
        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(gatewayRequests()).isEmpty();
    }
}
