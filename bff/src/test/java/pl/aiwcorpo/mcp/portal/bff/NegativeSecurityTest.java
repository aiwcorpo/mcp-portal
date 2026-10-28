package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.anyUrl;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.put;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import ch.qos.logback.classic.spi.ILoggingEvent;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import pl.aiwcorpo.mcp.portal.bff.support.FakeIdp;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;

/**
 * What must not work: requests without the CSRF header, another user's session, cookies planted by someone else,
 * secrets in logs and responses, return paths outside the contract pattern, a request id supplied by the client.
 */
class NegativeSecurityTest extends PortalHarness {

    private static final Pattern UUID_V7 = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");

    @AfterEach
    void defaultStubs() {
        BROKER.resetToDefaultMappings();
        GATEWAY.resetToDefaultMappings();
    }

    private static String header(HttpResponse<String> response, String name) {
        return response.headers().firstValue(name).orElse(null);
    }

    private TestBrowser session(FakeIdp.User user) {
        TestBrowser browser = login(user, Instant.now());
        browser.get("/api/v1/me");
        return browser;
    }

    private TestBrowser alice() {
        return session(ALICE);
    }

    // Request id (CC-087)

    @Test
    void everyApiResponseCarriesAFreshRequestId() {
        TestBrowser browser = alice();
        List<HttpResponse<String>> responses = new ArrayList<>();
        responses.add(browser.get("/api/v1/me"));
        responses.add(browser.get("/api/v1/catalog"));
        responses.add(browser.get("/api/v1/connections"));
        responses.add(browser.get("/api/v1/virtual-servers"));
        responses.add(browser.get("/api/v1/does-not-exist"));
        responses.add(browser.post("/api/v1/me", null, true));
        responses.add(browser.put("/api/v1/connections/jira/secret", "garbage", true));
        responses.add(browser.put("/api/v1/connections/jira/secret", "{\"secret\":\"x\"}", false));
        responses.add(browser.delete("/api/v1/connections/sharepoint", true));
        responses.add(browser.get("/api/v1/auth/login?returnPath=//evil.test"));
        responses.add(browser.get("/api/v1/auth/login?returnPath=/catalog"));
        responses.add(browser.get("/api/v1/oauth/callback?state=x"));
        responses.add(browser().get("/api/v1/me"));
        responses.add(browser().get("/api/v1/oauth/callback?state=x"));
        responses.add(browser.delete("/api/v1/connections/a%2Fb", true));
        responses.add(browser.post("/api/v1/auth/logout", null, true));

        List<String> ids = new ArrayList<>();
        for (HttpResponse<String> response : responses) {
            String id = header(response, "X-Request-Id");
            assertThat(id).as("%s %s", response.request().method(), response.uri().getPath()).matches(UUID_V7);
            ids.add(id);
            if (response.statusCode() >= 400 && response.headers().firstValue("Content-Type").orElse("").startsWith("application/json")) {
                assertThat(JSON.readTree(response.body()).get("requestId").asString()).isEqualTo(id);
            }
        }
        assertThat(ids).doesNotHaveDuplicates();
    }

    @Test
    void aRequestIdFromTheClientNeverReachesTheResponseAuditOrUpstream() {
        TestBrowser browser = alice();
        String clientId = "0192d1b2-7c3a-7d4e-8f10-aaaaaaaaaaaa";
        String hostile = "evil-id-" + UUID.randomUUID();

        HttpResponse<String> secret = browser.send(HttpRequest.newBuilder(browser.origin().resolve("/api/v1/connections/jira/secret"))
                        .PUT(HttpRequest.BodyPublishers.ofString("{\"secret\":\"test-only-reqid-probe\"}"))
                        .header("Content-Type", "application/json"),
                Map.of("X-XSRF-TOKEN", browser.cookie("__Host-XSRF-TOKEN").orElseThrow(), "X-Request-Id", clientId));
        SECRETS.add("test-only-reqid-probe");
        HttpResponse<String> hostileCall = browser.get("/api/v1/catalog", Map.of("X-Request-Id", hostile));

        for (HttpResponse<String> response : List.of(secret, hostileCall)) {
            assertThat(header(response, "X-Request-Id")).matches(UUID_V7).isNotIn(clientId, hostile);
        }
        assertThat(auditEvents()).noneMatch(event -> clientId.equals(event.path("requestId").asString())
                || hostile.equals(event.path("requestId").asString()));
        JsonNode event = lastAuditEvent();
        assertThat(event.get("requestId").asString()).isEqualTo(header(secret, "X-Request-Id"));
        assertThat(BROKER.findAll(anyRequestedFor(anyUrl()))).noneMatch(request -> clientId.equals(request.getHeader("X-Request-Id")));
        assertThat(GATEWAY.findAll(anyRequestedFor(anyUrl()))).noneMatch(request -> hostile.equals(request.getHeader("X-Request-Id")));
        assertThat(LOGS.list).noneMatch(line -> line.getFormattedMessage().contains(hostile));
    }

    // CSRF

    @Test
    void everyModifyingOperationNeedsTheCsrfHeader() {
        TestBrowser browser = alice();
        int before = BROKER.findAll(anyRequestedFor(anyUrl())).size() + GATEWAY.findAll(anyRequestedFor(anyUrl())).size();
        String vs = "{\"slug\":\"x1\",\"displayName\":\"X\",\"tools\":[\"jira__get_issue\"]}";
        List<HttpResponse<String>> responses = List.of(
                browser.put("/api/v1/connections/jira/secret", "{\"secret\":\"x\"}", false),
                browser.delete("/api/v1/connections/jira", false),
                browser.post("/api/v1/connections/gitlab/oauth", "{}", false),
                browser.post("/api/v1/virtual-servers", vs, false),
                browser.delete("/api/v1/virtual-servers/x1", false),
                browser.post("/api/v1/auth/logout", null, false));
        for (HttpResponse<String> response : responses) {
            assertThat(response.statusCode()).as(response.request().method() + " " + response.uri().getPath()).isEqualTo(403);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("csrf_invalid");
        }
        assertThat(BROKER.findAll(anyRequestedFor(anyUrl())).size() + GATEWAY.findAll(anyRequestedFor(anyUrl())).size())
                .isEqualTo(before);
        assertThat(browser.get("/api/v1/me").statusCode()).as("still logged in").isEqualTo(200);
    }

    @Test
    void aCsrfTokenOfAnotherSessionIsRejected() {
        TestBrowser alice = alice();
        TestBrowser bob = session(BOB);
        String bobsToken = bob.cookie("__Host-XSRF-TOKEN").orElseThrow();
        assertThat(bobsToken).isNotEqualTo(alice.cookie("__Host-XSRF-TOKEN").orElseThrow());

        HttpResponse<String> response = alice.send(HttpRequest.newBuilder(alice.origin().resolve("/api/v1/connections/jira")).DELETE(),
                Map.of("X-XSRF-TOKEN", bobsToken));

        assertThat(response.statusCode()).isEqualTo(403);
    }

    // Sessions

    @Test
    void forgedOrForeignSessionCookiesGiveNothing() {
        TestBrowser alice = alice();
        String alicesSession = alice.cookie("__Host-session").orElseThrow();

        TestBrowser forger = browser();
        forger.setCookie("__Host-session", UUID.randomUUID().toString().replace("-", "").toUpperCase());
        assertThat(forger.get("/api/v1/me").statusCode()).isEqualTo(401);
        assertThat(forger.get("/api/v1/catalog").statusCode()).isEqualTo(401);

        // The old pre-login session id is useless after login (fixation), and a copy of the cookie made before
        // logout is useless afterwards.
        alice.post("/api/v1/auth/logout", null, true);
        TestBrowser replay = browser();
        replay.setCookie("__Host-session", alicesSession);
        assertThat(replay.get("/api/v1/me").statusCode()).isEqualTo(401);
    }

    @Test
    void oldOidcCallbackPathDoesNotLogAnyoneIn() {
        TestBrowser browser = browser();
        HttpResponse<String> start = browser.get("/api/v1/auth/login");
        URI callback = IDP.approve(URI.create(header(start, "Location")), ALICE, Instant.now(), "1");
        URI oldPath = URI.create(callback.toString().replace("/api/v1/auth/callback", "/login/oauth2/code/keycloak"));

        HttpResponse<String> response = browser.get(oldPath.toString());

        assertThat(callback.getPath()).isEqualTo("/api/v1/auth/callback");
        assertThat(browser.get("/api/v1/me").statusCode()).isEqualTo(401);
        assertThat(response.headers().firstValue("Set-Cookie")).isEmpty();
    }

    // Secrets

    @Test
    void aSecretNeverShowsUpInLogsOrResponsesOnAnyPath() {
        TestBrowser browser = alice();
        List<String> secrets = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            String secret = "test-only-pat-" + i + "-" + UUID.randomUUID();
            secrets.add(secret);
            SECRETS.add(secret);
        }
        List<HttpResponse<String>> responses = new ArrayList<>();

        responses.add(browser.put("/api/v1/connections/jira/secret", "{\"secret\":\"" + secrets.get(0) + "\"}", true));
        BROKER.stubFor(put(urlPathEqualTo("/v1/connections/jira/secret")).atPriority(1).willReturn(aResponse().withStatus(422)
                .withHeader("Content-Type", "application/json").withBody("{\"error\":\"secret_invalid\"}")));
        responses.add(browser.put("/api/v1/connections/jira/secret", "{\"secret\":\"" + secrets.get(1) + "\"}", true));
        BROKER.stubFor(put(urlPathEqualTo("/v1/connections/jira/secret")).atPriority(1).willReturn(aResponse().withStatus(500)
                .withBody("upstream echoes: " + secrets.get(2))));
        responses.add(browser.put("/api/v1/connections/jira/secret", "{\"secret\":\"" + secrets.get(2) + "\"}", true));
        BROKER.stubFor(put(urlPathEqualTo("/v1/connections/jira/secret")).atPriority(1).willReturn(aResponse().withFault(
                com.github.tomakehurst.wiremock.http.Fault.CONNECTION_RESET_BY_PEER)));
        responses.add(browser.put("/api/v1/connections/jira/secret", "{\"secret\":\"" + secrets.get(3) + "\"}", true));
        responses.add(browser.put("/api/v1/connections/jira/secret", "{\"secret\":\"" + secrets.get(4) + "\",\"extra\":1}", true));
        responses.add(browser.put("/api/v1/connections/jira/secret", "{\"secret\":\"" + secrets.get(5) + "\"", true));
        responses.add(browser.put("/api/v1/connections/sharepoint/secret", "{\"secret\":\"" + secrets.get(0) + "\"}", true));
        responses.add(browser.put("/api/v1/connections/jira/secret", "{\"secret\":\"" + secrets.get(1) + "\"}", false));

        for (HttpResponse<String> response : responses) {
            String everything = response.headers().map() + response.body();
            for (String secret : secrets) {
                assertThat(everything).doesNotContain(secret);
            }
        }
        for (ILoggingEvent line : LOGS.list) {
            String text = line.getFormattedMessage() + (line.getThrowableProxy() == null ? "" : line.getThrowableProxy().getMessage());
            for (String secret : secrets) {
                assertThat(text).as("log line of %s", line.getLoggerName()).doesNotContain(secret);
            }
        }
        // The status codes themselves are in the contract; only the leak is judged here.
        assertThat(responses.stream().map(HttpResponse::statusCode)).contains(200, 422, 503, 400, 403);
    }

    @Test
    void anOAuthCodeNeverShowsUpInLogsOrUrls() {
        String state = "st-" + UUID.randomUUID();
        BROKER.stubFor(post(urlPathEqualTo("/v1/connections/gitlab/oauth/start")).atPriority(1).willReturn(aResponse()
                .withStatus(200).withHeader("Content-Type", "application/json")
                .withBody("{\"authorizeUrl\":\"https://gitlab.internal/oauth/authorize?state=" + state + "\",\"flowId\":\"f1\"}")));
        BROKER.stubFor(post(urlPathEqualTo("/v1/connections/gitlab/oauth/complete")).atPriority(1).willReturn(aResponse()
                .withStatus(503).withBody("rejected code")));
        TestBrowser browser = alice();
        browser.post("/api/v1/connections/gitlab/oauth", "{}", true);
        String code = "test-only-oauth-code-" + UUID.randomUUID();
        SECRETS.add(code);

        HttpResponse<String> back = browser.get("/api/v1/oauth/callback?code=" + code + "&state=" + state);

        assertThat(header(back, "Location")).doesNotContain(code);
        assertThat(LOGS.list).noneMatch(line -> line.getFormattedMessage().contains(code));
    }

    // Return paths

    @Test
    void returnPathsOutsideThePatternAreRefusedEverywhere() throws IOException {
        Resource[] files = new PathMatchingResourcePatternResolver()
                .getResources("classpath*:mcp-contracts/test-vectors/return-paths/*.json");
        TestBrowser browser = alice();
        int checked = 0;
        for (Resource file : files) {
            JsonNode vector;
            try (InputStream in = file.getInputStream()) {
                vector = JSON.readTree(in);
            }
            if (vector.get("expected").get("valid").asBoolean()) {
                continue;
            }
            String value = vector.get("value").asString();
            HttpResponse<String> login = browser.get("/api/v1/auth/login?returnPath=" + URLEncoder.encode(value, StandardCharsets.UTF_8));
            assertThat(login.statusCode()).as("login " + file.getFilename()).isEqualTo(400);
            assertThat(header(login, "Location")).isNull();

            String body = "{\"returnPath\":" + JSON.writeValueAsString(value) + "}";
            HttpResponse<String> oauth = browser.post("/api/v1/connections/gitlab/oauth", body, true);
            assertThat(oauth.statusCode()).as("oauth " + file.getFilename()).isEqualTo(400);
            checked++;
        }
        assertThat(checked).isGreaterThanOrEqualTo(9);
    }

    @Test
    void theCallbackNeverRedirectsOutsideThePortal() {
        // Whatever return path was stored, the redirect starts with a single slash (the pattern forbids //, \ and :// forms).
        String state = "st-" + UUID.randomUUID();
        BROKER.stubFor(post(urlPathEqualTo("/v1/connections/gitlab/oauth/start")).atPriority(1).willReturn(aResponse()
                .withStatus(200).withHeader("Content-Type", "application/json")
                .withBody("{\"authorizeUrl\":\"https://gitlab.internal/oauth/authorize?state=" + state + "\",\"flowId\":\"f1\"}")));
        TestBrowser browser = alice();
        browser.post("/api/v1/connections/gitlab/oauth", "{\"returnPath\":\"/a/b?x=1&y=2\"}", true);

        HttpResponse<String> back = browser.get("/api/v1/oauth/callback?error=access_denied&state=" + state);

        assertThat(header(back, "Location")).matches("^/(?!/)[^\\\\:]*$").startsWith("/a/b?x=1&y=2&connectError=");
    }
}
