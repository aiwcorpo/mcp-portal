package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
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

/** Confirmation preview, viewed and cancel (CC-098, CC-127, CC-128): proxy to C5 with the checks the BFF owns. */
class ConfirmationsTest extends PortalHarness {

    private static final String ID = "cnf_4k9Qe2LxW7tB3mZp";
    private static final String PREVIEW = "/api/v1/confirmations/" + ID;
    private static final String SAME_ORIGIN = "same-origin";

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

    private static int gatewayCalls() {
        return GATEWAY.findAll(anyRequestedFor(urlPathMatching("/admin/v1/confirmations.*"))).size();
    }

    private static void stub(com.github.tomakehurst.wiremock.client.MappingBuilder builder, int status, String body) {
        GATEWAY.stubFor(builder.atPriority(1).willReturn(aResponse().withStatus(status)
                .withHeader("Content-Type", "application/json").withBody(body)));
    }

    private static Map<String, String> sameOrigin() {
        return Map.of("Sec-Fetch-Site", SAME_ORIGIN);
    }

    @Test
    void previewIsReadOnlyAndNotCacheable() {
        HttpResponse<String> response = session().get(PREVIEW);

        C12.assertResponse("GET", "/api/v1/confirmations/{id}", response);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Cache-Control")).hasValue("no-store");
        JsonNode view = JSON.readTree(response.body());
        assertThat(view.get("tool").asString()).isEqualTo("jira__delete_issue");
        assertThat(view.get("resource").get("id").asString()).isEqualTo("ABC-123");
        List<LoggedRequest> sent = GATEWAY.findAll(anyRequestedFor(urlPathMatching("/admin/v1/confirmations.*")));
        assertThat(sent).hasSize(1);
        assertThat(sent.getFirst().getMethod().getName()).isEqualTo("GET");
        assertThat(sent.getFirst().getHeader("Authorization")).startsWith("Bearer xt-mcp-gateway-admin-");
    }

    @Test
    void previewNeedsOnlyTheSessionNotAFreshMfa() {
        TestBrowser browser = login(ALICE, Instant.now().minus(Duration.ofHours(3)));

        HttpResponse<String> response = browser.get(PREVIEW);

        assertThat(response.statusCode()).isEqualTo(200);
    }

    @Test
    void previewWithoutASessionIsUnauthenticated() {
        HttpResponse<String> response = browser().get(PREVIEW);

        C12.assertResponse("GET", "/api/v1/confirmations/{id}", response);
        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(gatewayCalls()).isZero();
    }

    @Test
    void aForeignOrUnknownConfirmationIsOneAnswer() {
        TestBrowser browser = session();
        stub(get(urlPathMatching("/admin/v1/confirmations/.*")), 404, "{\"error\":\"not_found_or_denied\"}");

        HttpResponse<String> foreign = browser.get(PREVIEW);
        int before = gatewayCalls();
        HttpResponse<String> malformed = browser.get("/api/v1/confirmations/short");

        for (HttpResponse<String> response : List.of(foreign, malformed)) {
            C12.assertResponse("GET", "/api/v1/confirmations/{id}", response);
            assertThat(response.statusCode()).isEqualTo(404);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("not_found_or_denied");
        }
        assertThat(gatewayCalls()).as("a malformed id never reaches the gateway").isEqualTo(before);
    }

    @Test
    void aPreviewOfAnotherCallOrOutsideTheSchemaIsNotShown() {
        TestBrowser browser = session();
        stub(get(urlPathMatching("/admin/v1/confirmations/.*")), 200, """
                {"confirmationId":"cnf_other_call_0000001","tool":"jira__delete_issue","system":"jira",
                 "arguments":[],"expiresAt":"2026-10-26T20:02:00Z"}""");
        assertThat(browser.get(PREVIEW).statusCode()).isEqualTo(503);

        stub(get(urlPathMatching("/admin/v1/confirmations/.*")), 200, """
                {"confirmationId":"%s","tool":"jira__delete_issue","system":"jira",
                 "resource":{"type":"Jira::Issue","id":"ABC\\u202e-1"},
                 "arguments":[],"expiresAt":"2026-10-26T20:02:00Z"}""".formatted(ID));
        HttpResponse<String> bidi = browser.get(PREVIEW);
        assertThat(bidi.statusCode()).isEqualTo(503);
        assertThat(bidi.body()).doesNotContain("ABC");
    }

    @Test
    void hiddenCharactersInArgumentValuesBecomeVisibleAndNamesWithThemAreRefused() {
        TestBrowser browser = session();
        stub(get(urlPathMatching("/admin/v1/confirmations/.*")), 200, """
                {"confirmationId":"%s","tool":"jira__delete_issue","system":"jira",
                 "arguments":[{"name":"comment","value":"\\\"ok\\u202e gnp.exe\\u2028x\\u0007y\\nline\\tt\\u061c\\\"",
                 "truncated":false}],"expiresAt":"2026-10-26T20:02:00Z"}""".formatted(ID));

        HttpResponse<String> shown = browser.get(PREVIEW);

        C12.assertResponse("GET", "/api/v1/confirmations/{id}", shown);
        String value = JSON.readTree(shown.body()).get("arguments").get(0).get("value").asString();
        assertThat(value).isEqualTo("\"ok<U+202E> gnp.exe<U+2028>x<U+0007>y\nline\tt<U+061C>\"");
        assertThat(shown.body()).doesNotContain("\u202e").doesNotContain("\\u202e");

        for (String name : List.of("a\\u202eb", "a b", "", "x".repeat(129))) {
            stub(get(urlPathMatching("/admin/v1/confirmations/.*")), 200, """
                    {"confirmationId":"%s","tool":"jira__delete_issue","system":"jira",
                     "arguments":[{"name":"%s","value":"1","truncated":false}],"expiresAt":"2026-10-26T20:02:00Z"}"""
                    .formatted(ID, name));
            assertThat(browser.get(PREVIEW).statusCode()).as(name).isEqualTo(503);
        }
    }

    @Test
    void aPreviewWithAFieldOutsideTheSchemaOrTooManyArgumentsIsNotShown() {
        TestBrowser browser = session();
        stub(get(urlPathMatching("/admin/v1/confirmations/.*")), 200, """
                {"confirmationId":"%s","tool":"jira__delete_issue","system":"jira","confirmation_code":"123456",
                 "arguments":[],"expiresAt":"2026-10-26T20:02:00Z"}""".formatted(ID));
        assertThat(browser.get(PREVIEW).statusCode()).isEqualTo(503);

        stub(get(urlPathMatching("/admin/v1/confirmations/.*")), 200, """
                {"confirmationId":"%s","tool":"jira__delete_issue","system":"jira",
                 "arguments":[{"name":"a","value":"1","truncated":false,"extra":true}],"expiresAt":"2026-10-26T20:02:00Z"}"""
                .formatted(ID));
        assertThat(browser.get(PREVIEW).statusCode()).isEqualTo(503);

        String many = String.join(",", java.util.Collections.nCopies(65, "{\"name\":\"a\",\"value\":\"1\",\"truncated\":false}"));
        stub(get(urlPathMatching("/admin/v1/confirmations/.*")), 200, """
                {"confirmationId":"%s","tool":"jira__delete_issue","system":"jira","arguments":[%s],
                 "expiresAt":"2026-10-26T20:02:00Z"}""".formatted(ID, many));
        assertThat(browser.get(PREVIEW).statusCode()).isEqualTo(503);
    }

    @Test
    void aLongValueIsCutAndMarkedTruncated() {
        TestBrowser browser = session();
        stub(get(urlPathMatching("/admin/v1/confirmations/.*")), 200, """
                {"confirmationId":"%s","tool":"jira__delete_issue","system":"jira",
                 "arguments":[{"name":"a","value":"%s","truncated":false}],"expiresAt":"2026-10-26T20:02:00Z"}"""
                .formatted(ID, "\\u200b".repeat(3000)));

        HttpResponse<String> response = browser.get(PREVIEW);

        C12.assertResponse("GET", "/api/v1/confirmations/{id}", response);
        JsonNode argument = JSON.readTree(response.body()).get("arguments").get(0);
        assertThat(argument.get("truncated").asBoolean()).isTrue();
        assertThat(argument.get("value").asString().length()).isLessThanOrEqualTo(8192).isGreaterThan(8000);
        assertThat(argument.get("value").asString()).endsWith(">").doesNotContain("\u200b");
    }

    @Test
    void aRejectedViewedLeavesAnAuditTrace() {
        TestBrowser browser = session();

        browser.post(PREVIEW + "/viewed", null, true, Map.of("Sec-Fetch-Site", "cross-site"));

        JsonNode event = lastAuditEvent();
        pl.aiwcorpo.mcp.portal.bff.support.ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("event").asString()).isEqualTo("confirmation");
        assertThat(event.get("decision").asString()).isEqualTo("deny");
        assertThat(event.get("sub").asString()).isEqualTo(ALICE.sub());
    }

    @Test
    void thereIsNoDecisionEndpoint() {
        TestBrowser browser = session();
        int before = gatewayCalls();

        for (String body : new String[] {null, "{\"decision\":\"approve\"}"}) {
            HttpResponse<String> response = browser.post(PREVIEW, body, true);
            assertThat(response.statusCode()).isEqualTo(405);
            assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("application/json");
        }
        assertThat(gatewayCalls()).isEqualTo(before);
    }

    @Test
    void viewedForwardsOnceForASameOriginRequestWithCsrf() {
        TestBrowser browser = session();

        HttpResponse<String> response = browser.post(PREVIEW + "/viewed", null, true, sameOrigin());

        C12.assertResponse("POST", "/api/v1/confirmations/{id}/viewed", response);
        assertThat(response.statusCode()).isEqualTo(204);
        List<LoggedRequest> sent = GATEWAY.findAll(postRequestedFor(urlPathMatching("/admin/v1/confirmations/" + ID + "/viewed")));
        assertThat(sent).hasSize(1);
        assertThat(sent.getFirst().getHeader("Authorization")).startsWith("Bearer xt-mcp-gateway-admin-");
        assertThat(sent.getFirst().getHeader("X-Request-Id"))
                .isEqualTo(response.headers().firstValue("X-Request-Id").orElseThrow());
    }

    @Test
    void viewedWithoutTheCsrfHeaderIsRefused() {
        TestBrowser browser = session();

        HttpResponse<String> response = browser.post(PREVIEW + "/viewed", null, false, sameOrigin());

        C12.assertResponse("POST", "/api/v1/confirmations/{id}/viewed", response);
        assertThat(response.statusCode()).isEqualTo(403);
        assertThat(gatewayCalls()).isZero();
    }

    @Test
    void viewedNeedsSecFetchSiteSameOrigin() {
        TestBrowser browser = session();
        List<Map<String, String>> notSameOrigin = List.of(Map.of(), Map.of("Sec-Fetch-Site", "cross-site"),
                Map.of("Sec-Fetch-Site", "same-site"), Map.of("Sec-Fetch-Site", "none"),
                Map.of("Sec-Fetch-Site", "Same-Origin"));

        for (Map<String, String> headers : notSameOrigin) {
            HttpResponse<String> response = browser.post(PREVIEW + "/viewed", null, true, headers);
            C12.assertResponse("POST", "/api/v1/confirmations/{id}/viewed", response);
            assertThat(response.statusCode()).as(headers.toString()).isEqualTo(403);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("csrf_invalid");
        }
        assertThat(gatewayCalls()).isZero();
    }

    @Test
    void viewedIgnoresPrefetchAndPrerender() {
        TestBrowser browser = session();

        for (String purpose : List.of("prefetch", "prefetch;prerender")) {
            HttpResponse<String> response = browser.post(PREVIEW + "/viewed", null, true,
                    Map.of("Sec-Fetch-Site", SAME_ORIGIN, "Sec-Purpose", purpose));
            C12.assertResponse("POST", "/api/v1/confirmations/{id}/viewed", response);
            assertThat(response.statusCode()).as(purpose).isEqualTo(204);
        }
        HttpResponse<String> legacy = browser.post(PREVIEW + "/viewed", null, true,
                Map.of("Sec-Fetch-Site", SAME_ORIGIN, "Purpose", "prefetch"));
        assertThat(legacy.statusCode()).isEqualTo(204);
        assertThat(gatewayCalls()).as("no view is recorded for a speculative request").isZero();
    }

    @Test
    void viewedAnswersNotFoundForSupersededAndForeignCalls() {
        TestBrowser browser = session();
        stub(post(urlPathMatching("/admin/v1/confirmations/.*/viewed")), 404, "{\"error\":\"not_found_or_denied\"}");

        HttpResponse<String> response = browser.post(PREVIEW + "/viewed", null, true, sameOrigin());

        C12.assertResponse("POST", "/api/v1/confirmations/{id}/viewed", response);
        assertThat(response.statusCode()).isEqualTo(404);
        assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("not_found_or_denied");
    }

    @Test
    void cancelNeedsCsrfButNoFreshMfa() {
        TestBrowser browser = login(ALICE, Instant.now().minus(Duration.ofHours(3)));
        browser.get("/api/v1/me");

        HttpResponse<String> withoutCsrf = browser.post(PREVIEW + "/cancel", null, false);
        C12.assertResponse("POST", "/api/v1/confirmations/{id}/cancel", withoutCsrf);
        assertThat(withoutCsrf.statusCode()).isEqualTo(403);
        assertThat(gatewayCalls()).isZero();

        HttpResponse<String> cancelled = browser.post(PREVIEW + "/cancel", null, true);
        C12.assertResponse("POST", "/api/v1/confirmations/{id}/cancel", cancelled);
        assertThat(cancelled.statusCode()).isEqualTo(204);
        assertThat(GATEWAY.findAll(postRequestedFor(urlPathMatching("/admin/v1/confirmations/" + ID + "/cancel"))))
                .hasSize(1);
    }

    @Test
    void cancelOfAForeignCallIsNotFound() {
        TestBrowser browser = session();
        stub(post(urlPathMatching("/admin/v1/confirmations/.*/cancel")), 404, "{\"error\":\"not_found_or_denied\"}");

        HttpResponse<String> response = browser.post(PREVIEW + "/cancel", null, true);

        C12.assertResponse("POST", "/api/v1/confirmations/{id}/cancel", response);
        assertThat(response.statusCode()).isEqualTo(404);
        assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("not_found_or_denied");
    }

    @Test
    void cancelIsUnavailableWhenTheGatewayCouldNotBurnTheCodes() {
        TestBrowser browser = session();
        stub(post(urlPathMatching("/admin/v1/confirmations/.*/cancel")), 503, "{\"error\":\"upstream_unavailable\"}");

        HttpResponse<String> response = browser.post(PREVIEW + "/cancel", null, true);

        C12.assertResponse("POST", "/api/v1/confirmations/{id}/cancel", response);
        assertThat(response.statusCode()).isEqualTo(503);
        assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("upstream_unavailable");
    }

    @Test
    void malformedIdsNeverReachTheGatewayOnWrites() {
        TestBrowser browser = session();

        for (String suffix : List.of("/viewed", "/cancel")) {
            HttpResponse<String> response = browser.post("/api/v1/confirmations/not-an-id" + suffix, null, true, sameOrigin());
            assertThat(response.statusCode()).as(suffix).isEqualTo(404);
        }
        assertThat(gatewayCalls()).isZero();
    }
}
