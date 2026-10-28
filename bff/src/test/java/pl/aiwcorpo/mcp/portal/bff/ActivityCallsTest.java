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

        HttpResponse<String> withoutCursor = browser.get("/api/v1/activity/calls?limit=5");
        C12.assertResponse("GET", "/api/v1/activity/calls", withoutCursor);
        assertThat(withoutCursor.statusCode()).isEqualTo(503);
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
    void withoutASessionTheAnswerIs401() {
        HttpResponse<String> response = browser().get("/api/v1/activity/calls");

        C12.assertResponse("GET", "/api/v1/activity/calls", response);
        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(gatewayRequests()).isEmpty();
    }
}
