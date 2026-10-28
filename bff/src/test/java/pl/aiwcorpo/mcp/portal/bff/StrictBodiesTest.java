package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathMatching;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;

/** A JSON value of another type than the schema names is a 400, never coerced into text. */
class StrictBodiesTest extends PortalHarness {

    private static int brokerWrites() {
        return BROKER.findAll(anyRequestedFor(urlPathMatching("/v1/connections/.*(secret|oauth/start)"))).size();
    }

    @Test
    void secretAndExpiryMustBeJsonStrings() {
        TestBrowser browser = login(ALICE, Instant.now());
        int before = brokerWrites();

        for (String body : List.of("{\"secret\":123456}", "{\"secret\":true}", "{\"secret\":1.5}",
                "{\"secret\":\"x\",\"expiresAt\":20270131}", "{\"secret\":[\"x\"]}", "{\"secret\":{\"a\":1}}")) {
            HttpResponse<String> response = browser.put("/api/v1/connections/jira/secret", body, true);
            C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", response);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("invalid_request");
            assertThat(response.body()).doesNotContain("123456");
        }
        assertThat(brokerWrites()).isEqualTo(before);
    }

    @Test
    void returnPathOfAnOAuthStartMustBeAString() {
        TestBrowser browser = login(ALICE, Instant.now());
        int before = brokerWrites();

        for (String body : List.of("{\"returnPath\":1}", "{\"returnPath\":true}")) {
            HttpResponse<String> response = browser.post("/api/v1/connections/gitlab/oauth", body, true);
            C12.assertResponse("POST", "/api/v1/connections/{system}/oauth", response);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
        }
        assertThat(brokerWrites()).isEqualTo(before);
    }
}
