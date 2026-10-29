package pl.aiwcorpo.mcp.portal.bff;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;

import pl.aiwcorpo.mcp.portal.bff.iga.AccessGovernance;
import pl.aiwcorpo.mcp.portal.bff.iga.IgaUnavailableException;
import pl.aiwcorpo.mcp.portal.bff.iga.NotRequestableException;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;

/** What the BFF does with adapters that fail, have no request flow or answer outside C12. */
@Import(AccessRequestsAdapterTest.ScriptedIga.class)
class AccessRequestsAdapterTest extends PortalHarness {

    private static final String PATH = "/api/v1/access-requests";
    private static final String ENTITLEMENT = "{\"entitlement\":\"mcp-jira-read\"}";

    private static volatile ScriptedIga.Mode mode = ScriptedIga.Mode.UNAVAILABLE;
    private static volatile List<AccessGovernance.AccessRequest> exampleRequests = List.of();
    private static volatile List<AccessGovernance.Entitlement> exampleCatalog = List.of();

    @TestConfiguration
    static class ScriptedIga {

        enum Mode { UNAVAILABLE, NO_FLOW, REDIRECT, BAD_REDIRECT, BOTH_FIELDS, BAD_ROWS, EXAMPLES }

        @Bean
        @Primary
        AccessGovernance scriptedIga() {
            return new AccessGovernance() {
                @Override
                public boolean supportsRequests() {
                    return mode != Mode.NO_FLOW;
                }

                @Override
                public List<Entitlement> catalog(String system) {
                    if (mode == Mode.UNAVAILABLE) {
                        throw new IgaUnavailableException("scripted");
                    }
                    if (mode == Mode.EXAMPLES) {
                        return exampleCatalog;
                    }
                    return List.of(new Entitlement("mcp-jira-read", "line one‮line two <U+0041>"),
                            new Entitlement("not a group", "dropped"), new Entitlement("mcp-jira-write", "x".repeat(600)),
                            new Entitlement("mcp-platform-admin", "never offered"),
                            new Entitlement("mcp-confluence-read", "another system"));
                }

                @Override
                public List<AccessRequest> requestsOf(Requester requester) {
                    return switch (mode) {
                        case UNAVAILABLE -> throw new IgaUnavailableException("scripted");
                        case BAD_ROWS -> List.of(
                                new AccessRequest("REQ-1", "mcp-jira-read", "pending", "2026-10-25T09:00:00Z",
                                        "2026-10-26T09:00:00Z", "https://iga.corp.test/requests/REQ-1"),
                                new AccessRequest("REQ-2", "mcp-jira-read", "weird", "2026-10-25T09:00:00Z", null, null),
                                new AccessRequest("REQ-3", "mcp-jira-read", "approved", "yesterday", null, null),
                                new AccessRequest("REQ-4", "mcp-jira-read", "approved", "2026-10-25T09:00:00Z", null,
                                        "javascript:alert(1)"),
                                new AccessRequest("REQ‮5", "mcp-jira-read", "approved", "2026-10-25T09:00:00Z", null, null));
                        case EXAMPLES -> exampleRequests;
                        default -> List.of();
                    };
                }

                @Override
                public RequestResult request(Requester requester, String entitlement) {
                    return switch (mode) {
                        case NO_FLOW -> throw new NotRequestableException();
                        case REDIRECT -> new RequestResult("https://iga.corp.test/catalog/request?entitlement=" + entitlement, null);
                        case BAD_REDIRECT -> new RequestResult("javascript:alert(1)", null);
                        case BOTH_FIELDS -> new RequestResult("https://iga.corp.test/x", "REQ-9");
                        default -> throw new IgaUnavailableException("scripted");
                    };
                }
            };
        }
    }

    @AfterEach
    void reset() {
        mode = ScriptedIga.Mode.UNAVAILABLE;
    }

    /** Mallory holds no group, so every entitlement of the scripted catalog can be requested. */
    private TestBrowser session() {
        TestBrowser browser = login(MALLORY, Instant.now());
        browser.get("/api/v1/me");
        return browser;
    }

    @Test
    void anUnavailableIgaIsServiceUnavailableEverywhereItIsUsed() {
        TestBrowser browser = session();
        for (HttpResponse<String> response : List.of(browser.get(PATH), browser.post(PATH, ENTITLEMENT, true),
                browser.get(PATH + "/entitlements?system=jira"))) {
            assertThat(response.statusCode()).isEqualTo(503);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("upstream_unavailable");
            assertThat(response.headers().firstValue("X-Request-Id")).isPresent();
        }
        C12.assertResponse("GET", PATH, browser.get(PATH));
        assertThat(browser.get("/api/v1/catalog").statusCode()).isEqualTo(503);
    }

    @Test
    void anAdapterWithoutARequestFlowAnswersNotRequestable() {
        mode = ScriptedIga.Mode.NO_FLOW;
        TestBrowser browser = session();

        HttpResponse<String> create = browser.post(PATH, ENTITLEMENT, true);
        C12.assertResponse("POST", PATH, create);
        assertThat(create.statusCode()).isEqualTo(422);
        assertThat(JSON.readTree(create.body()).get("error").asString()).isEqualTo("not_requestable");
        HttpResponse<String> list = browser.get(PATH);
        C12.assertResponse("GET", PATH, list);
        assertThat(JSON.readTree(list.body())).isEmpty();
    }

    @Test
    void theEntitlementsOfAnAdapterWithoutARequestFlowAreNotRequestableEither() {
        mode = ScriptedIga.Mode.NO_FLOW;

        HttpResponse<String> response = session().get(PATH + "/entitlements?system=jira");

        C12.assertResponse("GET", PATH + "/entitlements", response);
        assertThat(response.statusCode()).isEqualTo(422);
        assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("not_requestable");
    }

    @Test
    void theAdminGroupCannotBeRequestedWhateverTheCatalogSays() {
        mode = ScriptedIga.Mode.REDIRECT;
        TestBrowser browser = session();

        HttpResponse<String> response = browser.post(PATH, "{\"entitlement\":\"mcp-platform-admin\"}", true);
        C12.assertResponse("POST", PATH, response);
        assertThat(response.statusCode()).isEqualTo(422);
        assertThat(browser.post(PATH, "{\"entitlement\":\"mcp-jira-read\"}", true).statusCode()).isEqualTo(200);
    }

    @Test
    void aRedirectToTheIgaFormIsPassedOn() {
        mode = ScriptedIga.Mode.REDIRECT;

        HttpResponse<String> response = session().post(PATH, ENTITLEMENT, true);

        C12.assertResponse("POST", PATH, response);
        assertThat(JSON.readTree(response.body()).get("requestUrl").asString())
                .isEqualTo("https://iga.corp.test/catalog/request?entitlement=mcp-jira-read");
    }

    @Test
    void aResultThatIsNotExactlyOneSafeFieldIsAnAdapterFault() {
        TestBrowser browser = session();
        for (ScriptedIga.Mode bad : List.of(ScriptedIga.Mode.BAD_REDIRECT, ScriptedIga.Mode.BOTH_FIELDS)) {
            mode = bad;
            HttpResponse<String> response = browser.post(PATH, ENTITLEMENT, true);
            C12.assertResponse("POST", PATH, response);
            assertThat(response.statusCode()).as(bad.name()).isEqualTo(503);
            assertThat(response.body()).doesNotContain("javascript").doesNotContain("REQ-9");
        }
    }

    @Test
    void requestsOutsideTheContractAreDroppedAndDecidedAtIsOmittedWhilePending() {
        mode = ScriptedIga.Mode.BAD_ROWS;

        HttpResponse<String> response = session().get(PATH);

        C12.assertResponse("GET", PATH, response);
        JsonNode rows = JSON.readTree(response.body());
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).get("requestId").asString()).isEqualTo("REQ-1");
        assertThat(rows.get(0).has("decidedAt")).isFalse();
        assertThat(rows.get(0).get("requestUrl").asString()).isEqualTo("https://iga.corp.test/requests/REQ-1");
    }

    @Test
    void catalogTextFromTheIgaIsNeutralizedCutAndInvalidNamesAreDropped() {
        mode = ScriptedIga.Mode.REDIRECT;

        HttpResponse<String> response = login(MALLORY, Instant.now()).get(PATH + "/entitlements?system=jira");

        C12.assertResponse("GET", PATH + "/entitlements", response);
        JsonNode items = JSON.readTree(response.body());
        assertThat(items).hasSize(2);
        assertThat(items.get(0).get("description").asString()).isEqualTo("line one<U+202E>line two <U+003C>U+0041>");
        assertThat(items.get(1).get("description").asString()).hasSize(500);
    }

    @Test
    void theAnswersEqualTheExamplesOfTheContract() {
        mode = ScriptedIga.Mode.EXAMPLES;
        TestBrowser browser = session();
        for (String name : List.of("pending", "approved")) {
            JsonNode example = C12.responseExample("GET", PATH, 200, name);
            assertThat(example.isMissingNode()).as(name).isFalse();
            exampleRequests = List.of(JSON.treeToValue(example, AccessGovernance.AccessRequest[].class));

            HttpResponse<String> response = browser.get(PATH);

            C12.assertResponse("GET", PATH, response);
            assertThat(JSON.readTree(response.body())).as(name).isEqualTo(example);
        }

        JsonNode confluence = C12.responseExample("GET", PATH + "/entitlements", 200, "confluence");
        exampleCatalog = confluence.valueStream().map(node -> new AccessGovernance.Entitlement(
                node.get("entitlement").asString(), node.has("description") ? node.get("description").asString() : null)).toList();
        HttpResponse<String> entitlements = browser.get(PATH + "/entitlements?system=confluence");
        C12.assertResponse("GET", PATH + "/entitlements", entitlements);
        assertThat(JSON.readTree(entitlements.body())).isEqualTo(confluence);

        assertThat(C12.responseExample("POST", PATH, 200, "created").get("requestId").asString()).startsWith("REQ-");
    }
}
