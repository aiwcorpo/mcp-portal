package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.put;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.List;

import ch.qos.logback.classic.spi.ILoggingEvent;
import com.github.tomakehurst.wiremock.verification.LoggedRequest;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;

/** The login of a user-secret in the Basic scheme (CC-222): checked, passed to the broker, never logged, audited or returned. */
class BasicSecretTest extends PortalHarness {

    private static final String PATH = "/api/v1/connections/jira/secret";
    private static final String TEMPLATE = "/api/v1/connections/{system}/secret";
    private static final String BROKER_PATH = "/v1/connections/jira/secret";

    @AfterEach
    void defaultStubs() {
        BROKER.resetToDefaultMappings();
        BROKER.resetRequests();
    }

    private TestBrowser alice() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        return browser;
    }

    private static List<LoggedRequest> brokerWrites() {
        return BROKER.findAll(anyRequestedFor(urlPathEqualTo(BROKER_PATH)));
    }

    @Test
    void theLoginGoesToTheBrokerWithTheSecretAndNowhereElse() {
        String login = "test-only-login-anna@firma.pl";
        String secret = "test-only-api-token-1";
        SECRETS.add(login);
        SECRETS.add(secret);

        HttpResponse<String> response = alice().put(PATH, "{\"secret\":\"" + secret + "\",\"username\":\"" + login + "\"}", true);

        C12.assertResponse("PUT", TEMPLATE, response);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).doesNotContain(login).doesNotContain(secret);
        JsonNode sent = JSON.readTree(brokerWrites().getLast().getBodyAsString());
        assertThat(sent.get("username").asString()).isEqualTo(login);
        assertThat(sent.get("secret").asString()).isEqualTo(secret);
        for (ILoggingEvent line : LOGS.list) {
            assertThat(line.getFormattedMessage()).doesNotContain(login);
        }
        for (JsonNode event : auditEvents()) {
            assertThat(event.toString()).doesNotContain(login);
        }
    }

    @Test
    void aLoginThatIsNotOneNeverReachesTheBroker() {
        TestBrowser browser = alice();
        for (String username : List.of("\"\"", "\"anna:admin\"", "\"anna\\u200Bnowak\"", "\"anna\\u202Enowak\"", "\"a\\nb\"",
                "\"" + "x".repeat(256) + "\"", "5", "null")) {
            HttpResponse<String> response = browser.put(PATH, "{\"secret\":\"s\",\"username\":" + username + "}", true);
            C12.assertResponse("PUT", TEMPLATE, response);
            assertThat(response.statusCode()).as(username).isEqualTo(400);
        }
        assertThat(brokerWrites()).isEmpty();
        assertThat(browser.put(PATH, "{\"secret\":\"s\",\"username\":\"" + "x".repeat(255) + "\"}", true).statusCode())
                .isEqualTo(200);
    }

    @Test
    void theBrokerSaysWhetherTheSystemTakesALogin() {
        TestBrowser browser = alice();
        BROKER.stubFor(put(urlPathEqualTo(BROKER_PATH)).atPriority(1).willReturn(aResponse().withStatus(400)
                .withHeader("Content-Type", "application/json").withBody("{\"error\":\"invalid_request\"}")));

        HttpResponse<String> response = browser.put(PATH, "{\"secret\":\"s\",\"username\":\"anna\"}", true);

        C12.assertResponse("PUT", TEMPLATE, response);
        assertThat(response.statusCode()).isEqualTo(400);
        assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("invalid_request");
    }

    @Test
    void theCatalogCarriesTheSchemeAndTheKindOfInstallation() {
        BROKER.stubFor(get(urlPathEqualTo("/v1/systems")).atPriority(1).willReturn(aResponse().withStatus(200)
                .withHeader("Content-Type", "application/json").withBody("""
                        [{"system":"jira","supportedTypes":["user-secret"],"defaultType":"user-secret",
                          "userSecretScheme":"Basic","deployment":"cloud"},
                         {"system":"gitlab","supportedTypes":["user-oauth","user-secret"],"defaultType":"user-oauth",
                          "userSecretScheme":"Bearer","deployment":"dc"},
                         {"system":"confluence","supportedTypes":["user-secret"],"defaultType":"user-secret",
                          "userSecretScheme":"Digest","deployment":"mars"}]""")));

        HttpResponse<String> response = alice().get("/api/v1/catalog");

        C12.assertResponse("GET", "/api/v1/catalog", response);
        for (JsonNode server : JSON.readTree(response.body()).get("servers")) {
            JsonNode credential = server.get("credential");
            switch (server.get("system").asString()) {
                case "jira" -> {
                    assertThat(credential.get("userSecretScheme").asString()).isEqualTo("Basic");
                    assertThat(credential.get("deployment").asString()).isEqualTo("cloud");
                }
                case "gitlab" -> assertThat(credential.get("userSecretScheme").asString()).isEqualTo("Bearer");
                // A value outside the enums is left out, not passed on.
                case "confluence" -> {
                    assertThat(credential.has("userSecretScheme")).isFalse();
                    assertThat(credential.has("deployment")).isFalse();
                }
                default -> {
                }
            }
        }
    }
}
