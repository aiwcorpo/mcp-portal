package pl.aiwcorpo.mcp.portal.bff;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.support.FakeIdp;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;

/** Access requests over the mock adapter (C12, CC-096, CC-154): list, idempotent create, requestable entitlements. */
class AccessRequestsTest extends PortalHarness {

    private static final String PATH = "/api/v1/access-requests";
    private static final String ENTITLEMENTS = "/api/v1/access-requests/entitlements";

    private TestBrowser as(FakeIdp.User user) {
        TestBrowser browser = login(user, Instant.now());
        browser.get("/api/v1/me");
        return browser;
    }

    private static String entitlement(String name) {
        return "{\"entitlement\":\"" + name + "\"}";
    }

    @Test
    void theListHoldsOnlyTheRequestsOfTheUserAndShowsDecidedAtOnlyOnceDecided() {
        HttpResponse<String> bob = as(BOB).get(PATH);
        C12.assertResponse("GET", PATH, bob);
        JsonNode pending = JSON.readTree(bob.body()).get(0);
        assertThat(pending.get("requestId").asString()).isEqualTo("REQ-2026-0042");
        assertThat(pending.get("status").asString()).isEqualTo("pending");
        assertThat(pending.has("decidedAt")).isFalse();

        HttpResponse<String> alice = as(ALICE).get(PATH);
        C12.assertResponse("GET", PATH, alice);
        JsonNode rejected = JSON.readTree(alice.body()).get(0);
        assertThat(rejected.get("status").asString()).isEqualTo("rejected");
        assertThat(rejected.get("decidedAt").asString()).isEqualTo("2026-10-21T11:30:00Z");
        assertThat(alice.body()).doesNotContain("REQ-2026-0042");
    }

    @Test
    void aSecondRequestForTheSameEntitlementReturnsTheFirstOne() {
        TestBrowser mallory = as(MALLORY);

        HttpResponse<String> first = mallory.post(PATH, entitlement("mcp-confluence-read"), true);
        C12.assertResponse("POST", PATH, first);
        assertThat(first.statusCode()).isEqualTo(200);
        String requestId = JSON.readTree(first.body()).get("requestId").asString();
        assertThat(requestId).startsWith("REQ-MOCK-");

        HttpResponse<String> second = mallory.post(PATH, entitlement("mcp-confluence-read"), true);
        C12.assertResponse("POST", PATH, second);
        assertThat(second.statusCode()).isEqualTo(200);
        assertThat(JSON.readTree(second.body()).get("requestId").asString()).isEqualTo(requestId);

        HttpResponse<String> list = mallory.get(PATH);
        C12.assertResponse("GET", PATH, list);
        List<String> ids = new ArrayList<>();
        JSON.readTree(list.body()).forEach(item -> ids.add(item.get("requestId").asString()));
        assertThat(ids.stream().filter(requestId::equals)).hasSize(1);
    }

    @Test
    void aRequestThatIsAlreadyPendingInTheIgaIsReturnedNotDuplicated() {
        HttpResponse<String> response = as(BOB).post(PATH, entitlement("mcp-jira-write"), true);

        C12.assertResponse("POST", PATH, response);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(JSON.readTree(response.body()).get("requestId").asString()).isEqualTo("REQ-2026-0042");
    }

    @Test
    void anEntitlementOutsideTheCatalogOrAlreadyHeldIsNotRequestable() {
        TestBrowser alice = as(ALICE);
        for (String entitlement : List.of("mcp-no-such-entitlement", "mcp-platform-admin", "mcp-jira-write")) {
            HttpResponse<String> response = alice.post(PATH, entitlement(entitlement), true);
            C12.assertResponse("POST", PATH, response);
            assertThat(response.statusCode()).as(entitlement).isEqualTo(422);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("not_requestable");
            assertThat(response.headers().firstValue("X-Request-Id")).isPresent();
        }
    }

    @Test
    void theBodyIsReadStrictly() {
        TestBrowser browser = as(MALLORY);
        for (String body : List.of("", "{}", "{\"entitlement\":123}", "{\"entitlement\":\"admin\"}",
                "{\"entitlement\":\"mcp-jira-read\",\"sub\":\"someone-else\"}", "{\"entitlement\":\"mcp-jira-read\"} x",
                "[\"mcp-jira-read\"]", "{\"entitlement\":null}", "{\"entitlement\":\"mcp-jira-read\\n\"}", "not json")) {
            HttpResponse<String> response = browser.post(PATH, body, true);
            C12.assertResponse("POST", PATH, response);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
        }
    }

    @Test
    void creatingNeedsTheCsrfHeaderAndASession() {
        HttpResponse<String> noCsrf = as(MALLORY).post(PATH, entitlement("mcp-jira-read"), false);
        C12.assertResponse("POST", PATH, noCsrf);
        assertThat(noCsrf.statusCode()).isEqualTo(403);

        HttpResponse<String> anonymous = browser().get(PATH);
        assertThat(anonymous.statusCode()).isEqualTo(401);
    }

    @Test
    void requestableEntitlementsLeaveOutWhatTheUserHoldsAndCarryTheCatalogText() {
        HttpResponse<String> response = as(ALICE).get(ENTITLEMENTS + "?system=jira");

        C12.assertResponse("GET", ENTITLEMENTS, response);
        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode items = JSON.readTree(response.body());
        List<String> names = new ArrayList<>();
        items.forEach(item -> names.add(item.get("entitlement").asString()));
        assertThat(names).contains("mcp-jira-destructive", "mcp-jira-proj-DEF").doesNotContain("mcp-jira-read",
                "mcp-jira-write", "mcp-jira-proj-ABC");
        for (JsonNode item : items) {
            if ("mcp-jira-destructive".equals(item.get("entitlement").asString())) {
                assertThat(item.get("description").asString()).isEqualTo("Delete Jira issues");
            }
        }
    }

    @Test
    void requestableEntitlementsNeedOneKnownSystem() {
        TestBrowser browser = as(ALICE);
        for (String query : List.of("", "?system=", "?system=nope", "?system=jira&system=gitlab", "?system=JIRA")) {
            HttpResponse<String> response = browser.get(ENTITLEMENTS + query);
            C12.assertResponse("GET", ENTITLEMENTS, response);
            assertThat(response.statusCode()).as(query).isEqualTo(400);
        }
    }
}
