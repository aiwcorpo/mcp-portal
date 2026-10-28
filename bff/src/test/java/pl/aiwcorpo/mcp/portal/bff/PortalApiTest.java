package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.anyUrl;
import static com.github.tomakehurst.wiremock.client.WireMock.put;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.github.tomakehurst.wiremock.verification.LoggedRequest;

import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.support.ContractSchemas;
import pl.aiwcorpo.mcp.portal.bff.support.FakeIdp;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;

/** Operations of M1 (login, session, CSRF, connections) and the SPA, checked against C12. */
class PortalApiTest extends PortalHarness {

    @Test
    void loginRedirectsStraightToTheIdpWithPkceAndNonce() {
        HttpResponse<String> response = browser().get("/api/v1/auth/login?returnPath=/catalog?system=jira");

        C12.assertResponse("GET", "/api/v1/auth/login", response);
        URI location = URI.create(response.headers().firstValue("Location").orElseThrow());
        assertThat(location.toString()).startsWith(IDP.authorizationEndpoint());
        Map<String, String> query = FakeIdp.parse(location.getRawQuery());
        assertThat(query).containsEntry("response_type", "code")
                .containsEntry("client_id", FakeIdp.CLIENT_ID)
                .containsEntry("code_challenge_method", "S256")
                .containsKeys("code_challenge", "state", "nonce", "redirect_uri")
                .doesNotContainKey("max_age");
        assertThat(query.get("scope")).contains("openid");
    }

    @Test
    void loginRejectsReturnPathsThatCouldLeaveThePortal() {
        for (String bad : List.of("//evil.example/x", "https://evil.example/", "/%2F%2Fevil", "/\\evil", "catalog")) {
            HttpResponse<String> response = browser().get("/api/v1/auth/login?returnPath="
                    + java.net.URLEncoder.encode(bad, java.nio.charset.StandardCharsets.UTF_8));
            C12.assertResponse("GET", "/api/v1/auth/login", response);
            assertThat(response.statusCode()).as(bad).isEqualTo(400);
        }
    }

    @Test
    void loginCreatesHostPrefixedSessionAndCsrfCookie() {
        TestBrowser browser = browser();
        HttpResponse<String> start = browser.get("/api/v1/auth/login");
        URI callback = IDP.approve(URI.create(start.headers().firstValue("Location").orElseThrow()), ALICE, Instant.now(), "1");
        HttpResponse<String> back = browser.get(callback.toString());

        assertThat(back.headers().firstValue("Location").orElseThrow()).endsWith("/");
        List<String> session = browser.setCookieHeaders(back, "__Host-session");
        assertThat(session).hasSize(1);
        String cookie = session.getFirst().toLowerCase();
        assertThat(cookie).contains("; secure").contains("; httponly").contains("samesite=lax").contains("path=/")
                .doesNotContain("domain=");
        assertThat(browser.setCookieHeaders(back, "JSESSIONID")).isEmpty();

        String xsrf = browser.setCookieHeaders(back, "__Host-XSRF-TOKEN").stream()
                .filter(header -> !header.toLowerCase().startsWith("xsrf-token=;"))
                .findFirst().orElseThrow().toLowerCase();
        assertThat(xsrf).contains("; secure").contains("samesite=strict").contains("path=/").doesNotContain("httponly");
        assertThat(browser.cookie("__Host-XSRF-TOKEN")).isPresent();
        assertThat(browser.get("/api/v1/me").statusCode()).isEqualTo(200);
    }

    @Test
    void apiWithoutSessionIsUnauthenticatedJson() {
        HttpResponse<String> me = browser().get("/api/v1/me", Map.of("Accept", "text/html"));
        C12.assertResponse("GET", "/api/v1/me", me);
        assertThat(me.statusCode()).isEqualTo(401);
        assertThat(JSON.readTree(me.body()).get("error").asString()).isEqualTo("unauthenticated");
        assertThat(JSON.readTree(me.body()).get("requestId").asString())
                .isEqualTo(me.headers().firstValue("X-Request-Id").orElseThrow());

        HttpResponse<String> catalog = browser().get("/api/v1/catalog");
        C12.assertResponse("GET", "/api/v1/catalog", catalog);
        assertThat(catalog.statusCode()).isEqualTo(401);
    }

    @Test
    void modifyingCallsRequireTheCsrfHeader() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");

        HttpResponse<String> withoutHeader = browser.put("/api/v1/connections/jira/secret",
                "{\"secret\":\"test-only-csrf-probe\"}", false);
        C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", withoutHeader);
        assertThat(withoutHeader.statusCode()).isEqualTo(403);
        assertThat(withoutHeader.body()).contains("csrf_invalid");
        SECRETS.add("test-only-csrf-probe");

        HttpResponse<String> deleteWithout = browser.delete("/api/v1/connections/jira", false);
        C12.assertResponse("DELETE", "/api/v1/connections/{system}", deleteWithout);
        assertThat(deleteWithout.statusCode()).isEqualTo(403);

        HttpResponse<String> logoutWithout = browser.post("/api/v1/auth/logout", null, false);
        C12.assertResponse("POST", "/api/v1/auth/logout", logoutWithout);
        assertThat(logoutWithout.statusCode()).isEqualTo(403);

        HttpResponse<String> wrongToken = browser.send(java.net.http.HttpRequest.newBuilder(
                        browser.origin().resolve("/api/v1/connections/jira")).DELETE(),
                Map.of("X-XSRF-TOKEN", "not-the-cookie-value"));
        assertThat(wrongToken.statusCode()).isEqualTo(403);
        assertThat(BROKER.findAll(anyRequestedFor(urlPathEqualTo("/v1/connections/jira")))).isEmpty();
    }

    @Test
    void sessionEndsAfterTheAbsoluteLifetime() {
        TestBrowser browser = login(ALICE, Instant.now());
        assertThat(browser.get("/api/v1/me").statusCode()).isEqualTo(200);

        clock.advance(Duration.ofHours(8).plusMinutes(1));

        HttpResponse<String> me = browser.get("/api/v1/me");
        C12.assertResponse("GET", "/api/v1/me", me);
        assertThat(me.statusCode()).isEqualTo(401);
    }

    @Test
    void logoutEndsLocalAndIdpSession() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        int idpLogoutsBefore = IDP.logoutRequests().size();

        HttpResponse<String> logout = browser.post("/api/v1/auth/logout", null, true);

        C12.assertResponse("POST", "/api/v1/auth/logout", logout);
        assertThat(logout.statusCode()).isEqualTo(204);
        assertThat(browser.setCookieHeaders(logout, "__Host-session")).anySatisfy(header ->
                assertThat(header.toLowerCase()).startsWith("__host-session=;").contains("expires=thu, 01 jan 1970")
                        .contains("secure").contains("path=/"));
        assertThat(IDP.logoutRequests()).hasSize(idpLogoutsBefore + 1);
        assertThat(IDP.logoutRequests().getLast()).containsKey("refresh_token");
        assertThat(browser.get("/api/v1/me").statusCode()).isEqualTo(401);
    }

    @Test
    void meReturnsOnlyPlatformGroups() {
        TestBrowser browser = login(ALICE, Instant.now());
        HttpResponse<String> me = browser.get("/api/v1/me");

        C12.assertResponse("GET", "/api/v1/me", me);
        JsonNode body = JSON.readTree(me.body());
        assertThat(body.get("username").asString()).isEqualTo("alice");
        assertThat(body.get("displayName").asString()).isEqualTo("Alice Tester");
        assertThat(body.get("isAdmin").asBoolean()).isFalse();
        assertThat(body.get("groups").valueStream().map(JsonNode::asString))
                .containsExactly("mcp-jira-proj-ABC", "mcp-jira-read", "mcp-jira-write");

        HttpResponse<String> admin = login(CAROL, Instant.now()).get("/api/v1/me");
        C12.assertResponse("GET", "/api/v1/me", admin);
        assertThat(JSON.readTree(admin.body()).get("isAdmin").asBoolean()).isTrue();
    }

    @Test
    void catalogCombinesGatewayBrokerAndIga() {
        TestBrowser browser = login(ALICE, Instant.now());
        HttpResponse<String> response = browser.get("/api/v1/catalog");

        C12.assertResponse("GET", "/api/v1/catalog", response);
        JsonNode servers = JSON.readTree(response.body()).get("servers");
        // C5 stub: jira (get_issue granted, update_issue denied), gitlab (denied); C4 stub: jira connected,
        // gitlab expiring; IGA mock: alice has only a rejected request.
        JsonNode jira = servers.get(0);
        assertThat(jira.get("status").asString()).isEqualTo("connected");
        assertThat(jira.get("url").asString()).isEqualTo("https://mcp-gateway.internal/s/mcp-jira/mcp");
        assertThat(jira.get("actions").valueStream().map(JsonNode::asString))
                .containsExactly("copy_link", "request_access", "disconnect");
        JsonNode gitlab = servers.get(1);
        assertThat(gitlab.get("status").asString()).isEqualTo("no_access");
        assertThat(gitlab.get("actions").valueStream().map(JsonNode::asString))
                .containsExactly("request_access");
        assertThat(gitlab.get("connection").get("type").asString()).isEqualTo("user-oauth");

        assertThat(GATEWAY.findAll(anyRequestedFor(urlPathEqualTo("/admin/v1/catalog"))).getLast().getHeader("Authorization"))
                .startsWith("Bearer xt-mcp-gateway-admin-");
        assertThat(BROKER.findAll(anyRequestedFor(urlPathEqualTo("/v1/connections"))).getLast().getHeader("Authorization"))
                .startsWith("Bearer xt-mcp-credential-broker-");
        assertThat(IDP.tokenRequests()).anySatisfy(form -> assertThat(form)
                .containsEntry("grant_type", "urn:ietf:params:oauth:grant-type:token-exchange")
                .containsEntry("audience", "mcp-gateway-admin")
                .containsEntry("scope", "mcp-gateway-admin-audience"));
        assertThat(IDP.tokenRequests()).anySatisfy(form -> assertThat(form)
                .containsEntry("audience", "mcp-credential-broker")
                .containsEntry("scope", "mcp-credential-broker-audience"));
    }

    @Test
    void catalogShowsPendingRequestOnlyWhenNothingIsGranted() {
        // The C5 stub grants jira__get_issue, so a pending request for another tool does not change the table row.
        HttpResponse<String> response = login(BOB, Instant.now()).get("/api/v1/catalog");

        C12.assertResponse("GET", "/api/v1/catalog", response);
        JsonNode jira = JSON.readTree(response.body()).get("servers").get(0);
        assertThat(jira.get("status").asString()).isEqualTo("connected");
        assertThat(jira.get("actions").valueStream().map(JsonNode::asString))
                .containsExactly("copy_link", "request_access", "disconnect");

        HttpResponse<String> mallory = login(MALLORY, Instant.now()).get("/api/v1/catalog");
        C12.assertResponse("GET", "/api/v1/catalog", mallory);
        JsonNode gitlab = JSON.readTree(mallory.body()).get("servers").get(1);
        assertThat(gitlab.get("status").asString()).isEqualTo("request_pending");
        assertThat(gitlab.get("actions").valueStream().map(JsonNode::asString)).containsExactly("view_request");
    }

    @Test
    void exchangedTokensAreReusedWithinTheSession() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/catalog");
        long exchanges = countExchanges();
        browser.get("/api/v1/catalog");
        browser.get("/api/v1/connections");
        assertThat(countExchanges()).isEqualTo(exchanges);
    }

    private static long countExchanges() {
        return IDP.tokenRequests().stream()
                .filter(form -> "urn:ietf:params:oauth:grant-type:token-exchange".equals(form.get("grant_type")))
                .count();
    }

    @Test
    void connectionsPassThroughWithoutValues() {
        HttpResponse<String> response = login(ALICE, Instant.now()).get("/api/v1/connections");

        C12.assertResponse("GET", "/api/v1/connections", response);
        assertThat(JSON.readTree(response.body())).hasSize(2);
    }

    @Test
    void upstreamFailureIsServiceUnavailableJson() {
        GATEWAY.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlPathEqualTo("/admin/v1/catalog"))
                .atPriority(1)
                .withHeader("X-Request-Id", com.github.tomakehurst.wiremock.client.WireMock.matching(".+"))
                .willReturn(aResponse().withStatus(500).withBody("<html>stack trace with internals</html>")));
        try {
            HttpResponse<String> response = login(ALICE, Instant.now()).get("/api/v1/catalog");
            assertThat(response.statusCode()).isEqualTo(503);
            assertThat(response.body()).doesNotContain("stack trace").doesNotContain("internals");
            C12.assertResponse("GET", "/api/v1/catalog", response);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("upstream_unavailable");
        } finally {
            GATEWAY.resetToDefaultMappings();
        }
    }

    @Test
    void secretWithFreshLoginGoesToBrokerAndIsAudited() {
        String secret = "test-only-secret-" + UUID.randomUUID();
        SECRETS.add(secret);
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");

        HttpResponse<String> response = browser.put("/api/v1/connections/jira/secret",
                "{\"secret\":\"" + secret + "\",\"expiresAt\":\"2027-01-31T00:00:00Z\"}", true);

        C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", response);
        assertThat(response.statusCode()).isEqualTo(200);
        LoggedRequest sent = BROKER.findAll(anyRequestedFor(urlPathEqualTo("/v1/connections/jira/secret"))).getLast();
        assertThat(sent.getHeader("Authorization")).startsWith("Bearer xt-mcp-credential-broker-");
        C4.assertComponent("PutSecretRequest", JSON.readTree(sent.getBodyAsString()));
        assertThat(JSON.readTree(sent.getBodyAsString()).get("secret").asString()).isEqualTo(secret);

        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("component").asString()).isEqualTo("portal");
        assertThat(event.get("event").asString()).isEqualTo("connection_change");
        assertThat(event.get("sub").asString()).isEqualTo(ALICE.sub());
        assertThat(event.get("server").asString()).isEqualTo("mcp-jira");
        assertThat(event.get("backendUser").asString())
                .isEqualTo(JSON.readTree(response.body()).get("backendUser").asString());
        assertThat(event.get("outcome").asString()).isEqualTo("ok");
        assertThat(event.get("requestId").asString())
                .isEqualTo(response.headers().firstValue("X-Request-Id").orElseThrow())
                .isEqualTo(sent.getHeader("X-Request-Id"));
    }

    @Test
    void secretNeedsNoFreshMfa() {
        String secret = "test-only-secret-" + UUID.randomUUID();
        SECRETS.add(secret);
        TestBrowser browser = login(ALICE, Instant.now().minus(Duration.ofHours(3)));
        browser.get("/api/v1/me");

        HttpResponse<String> stored = browser.put("/api/v1/connections/jira/secret", "{\"secret\":\"" + secret + "\"}", true);

        C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", stored);
        assertThat(stored.statusCode()).isEqualTo(200);
        assertThat(lastAuditEvent().get("outcome").asString()).isEqualTo("ok");
    }

    @Test
    void expiryDateIsNotJudgedByTheBff() {
        // CC-084 (2.2.1): the date is the user's own note; past and distant dates reach the broker unchanged.
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        for (String expiresAt : List.of("2020-01-01T00:00:00Z", "2099-12-31T23:59:59Z")) {
            String secret = "test-only-secret-" + UUID.randomUUID();
            SECRETS.add(secret);
            HttpResponse<String> response = browser.put("/api/v1/connections/jira/secret",
                    "{\"secret\":\"" + secret + "\",\"expiresAt\":\"" + expiresAt + "\"}", true);
            C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", response);
            assertThat(response.statusCode()).as(expiresAt).isEqualTo(200);
            assertThat(JSON.readTree(BROKER.findAll(anyRequestedFor(urlPathEqualTo("/v1/connections/jira/secret")))
                    .getLast().getBodyAsString()).get("expiresAt").asString()).isEqualTo(expiresAt);
        }
    }

    @Test
    void secretRejectedByTheBrokerIs422() {
        BROKER.stubFor(put(urlPathEqualTo("/v1/connections/confluence/secret")).atPriority(1)
                .withHeader("Authorization", com.github.tomakehurst.wiremock.client.WireMock.matching("^Bearer .+$"))
                .willReturn(aResponse().withStatus(422).withHeader("Content-Type", "application/json")
                        .withBody("{\"error\":\"secret_invalid\"}")));
        String secret = "test-only-secret-" + UUID.randomUUID();
        SECRETS.add(secret);
        try {
            TestBrowser browser = login(ALICE, Instant.now());
            browser.get("/api/v1/me");
            HttpResponse<String> response = browser.put("/api/v1/connections/confluence/secret",
                    "{\"secret\":\"" + secret + "\"}", true);

            C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", response);
            assertThat(response.statusCode()).isEqualTo(422);
            assertThat(response.body()).isEqualTo("{\"error\":\"secret_invalid\"}");
            JsonNode event = lastAuditEvent();
            ContractSchemas.assertValid(AUDIT, event);
            assertThat(event.get("outcome").asString()).isEqualTo("error");
            assertThat(event.get("reason").asString()).isEqualTo("secret_invalid");
        } finally {
            BROKER.resetToDefaultMappings();
        }
    }

    @Test
    void malformedSecretRequestsAreRejectedBeforeTheBroker() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        int before = BROKER.findAll(anyRequestedFor(anyUrl())).size();
        SECRETS.add("test-only-unknown-field");

        for (String body : List.of("{}", "{\"secret\":\"\"}", "{\"secret\":\"x\",\"sub\":\"someone-else\"}",
                "{\"secret\":\"test-only-unknown-field\",\"expiresAt\":\"tomorrow\"}", "not json")) {
            HttpResponse<String> response = browser.put("/api/v1/connections/jira/secret", body, true);
            C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", response);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
        }
        HttpResponse<String> unknownSystem = browser.put("/api/v1/connections/sharepoint/secret", "{\"secret\":\"x\"}", true);
        assertThat(unknownSystem.statusCode()).isEqualTo(400);
        assertThat(BROKER.findAll(anyRequestedFor(anyUrl()))).hasSize(before);
    }

    @Test
    void disconnectCallsBrokerAndIsAudited() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");

        HttpResponse<String> response = browser.delete("/api/v1/connections/gitlab", true);

        C12.assertResponse("DELETE", "/api/v1/connections/{system}", response);
        assertThat(response.statusCode()).isEqualTo(204);
        assertThat(BROKER.findAll(anyRequestedFor(urlPathEqualTo("/v1/connections/gitlab")))).isNotEmpty();
        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("server").asString()).isEqualTo("mcp-gitlab");
        assertThat(event.get("outcome").asString()).isEqualTo("ok");
    }

    @Test
    void spaRoutesServeIndexWithNonceAndSecurityHeaders() {
        for (String route : List.of("/", "/index.html", "/login", "/logout", "/catalog", "/connections/jira", "/confirm/cnf_123", "/a/b/c?x=1")) {
            HttpResponse<String> response = browser().get(route);
            assertThat(response.statusCode()).as(route).isEqualTo(200);
            assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("text/html");
            String csp = response.headers().firstValue("Content-Security-Policy").orElseThrow();
            assertThat(csp).doesNotContain("unsafe-inline").doesNotContain("unsafe-eval")
                    .contains("default-src 'self'").contains("frame-ancestors 'none'").contains("script-src 'self';");
            String nonce = csp.replaceAll(".*style-src 'self' 'nonce-([^']+)'.*", "$1");
            assertThat(response.body()).contains("ngCspNonce=\"" + nonce + "\"").doesNotContain("__CSP_NONCE__");
            assertThat(response.headers().firstValue("Strict-Transport-Security").orElseThrow())
                    .contains("max-age=31536000").contains("includeSubDomains");
            assertThat(response.headers().firstValue("Cache-Control").orElseThrow()).contains("no-store");
        }
    }

    @Test
    void buildFilesAreServedAsTheyAre() {
        HttpResponse<String> response = browser().get("/assets/app.js");
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Content-Type").orElse("")).contains("javascript");
        assertThat(response.body()).contains("fixture");
        assertThat(response.headers().firstValue("Content-Security-Policy")).isPresent();
    }

    @Test
    void apiPathsNeverAnswerWithHtml() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        List<HttpResponse<String>> responses = List.of(
                browser.get("/api/v1/does-not-exist", Map.of("Accept", "text/html")),
                browser.get("/api/v1/../v1/nothing", Map.of("Accept", "text/html")),
                browser.get("/api", Map.of("Accept", "text/html")),
                browser.get("/API/v1/me", Map.of("Accept", "text/html")),
                browser.get("/%61pi/v1/does-not-exist", Map.of("Accept", "text/html")),
                browser.get("/%61pi", Map.of("Accept", "text/html")),
                browser.get("/actuator", Map.of("Accept", "text/html")),
                browser.post("/api/v1/me", null, true),
                browser().get("/api/v1/unknown", Map.of("Accept", "text/html")));
        for (HttpResponse<String> response : responses) {
            assertThat(response.statusCode()).as(response.uri().toString()).isBetween(400, 499);
            assertThat(response.headers().firstValue("Content-Type").orElse(""))
                    .as(response.uri().toString()).startsWith("application/json");
            assertThat(response.body()).doesNotContainIgnoringCase("<html");
            C12.assertComponent("Error", JSON.readTree(response.body()));
        }
    }

    @Test
    void anEncodedApiPrefixIsNotAnSpaRoute() {
        TestBrowser browser = login(ALICE, Instant.now());
        HttpResponse<String> response = browser.get("/%61pi/v1/me", Map.of("Accept", "text/html"));
        assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("application/json");
        assertThat(response.body()).doesNotContainIgnoringCase("<html");
    }

    @Test
    void loginRotatesTheSessionId() {
        TestBrowser browser = browser();
        HttpResponse<String> start = browser.get("/api/v1/auth/login");
        String before = browser.cookie("__Host-session").orElseThrow();
        URI callback = IDP.approve(URI.create(start.headers().firstValue("Location").orElseThrow()), ALICE, Instant.now(), "1");
        browser.get(callback.toString());
        assertThat(browser.cookie("__Host-session").orElseThrow()).isNotEqualTo(before);
    }

    @Test
    void stepUpAsAnotherUserEndsTheSession() {
        TestBrowser browser = login(ALICE, Instant.now().minus(Duration.ofMinutes(10)));
        browser.get("/api/v1/me");
        HttpResponse<String> stepUp = browser.get("/api/v1/auth/login?stepUp=true&returnPath=/connect/jira");
        URI callback = IDP.approve(URI.create(stepUp.headers().firstValue("Location").orElseThrow()), BOB, Instant.now(), "1");

        HttpResponse<String> back = browser.get(callback.toString());

        assertThat(back.statusCode()).isEqualTo(302);
        assertThat(back.headers().firstValue("Location").orElseThrow()).endsWith("/?loginError=step_up_failed");
        HttpResponse<String> me = browser.get("/api/v1/me");
        assertThat(me.statusCode()).isEqualTo(401);
    }

    @Test
    void ordinaryLoginAsAnotherUserKeepsNothingOfTheEarlierOne() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/catalog");
        long exchangesForAlice = countExchanges();
        HttpResponse<String> start = browser.get("/api/v1/auth/login");
        URI callback = IDP.approve(URI.create(start.headers().firstValue("Location").orElseThrow()), BOB, Instant.now(), "1");
        browser.get(callback.toString());

        assertThat(JSON.readTree(browser.get("/api/v1/me").body()).get("username").asString()).isEqualTo("bob");
        browser.get("/api/v1/connections");
        // The broker token cached for alice was dropped with the rest of her session state, so bob's is exchanged anew.
        assertThat(countExchanges()).isGreaterThan(exchangesForAlice);
    }

    @Test
    void loginFailuresUseTheClosedListOfCodes() {
        TestBrowser cancelled = browser();
        HttpResponse<String> start = cancelled.get("/api/v1/auth/login");
        HttpResponse<String> back = cancelled.get(IDP.deny(URI.create(start.headers().firstValue("Location").orElseThrow())).toString());
        assertThat(back.headers().firstValue("Location").orElseThrow()).endsWith("/?loginError=cancelled");

        // Login CSRF: a callback for a login started in another browser does not belong to this session.
        TestBrowser victim = browser();
        victim.get("/api/v1/me");
        HttpResponse<String> attackerStart = browser().get("/api/v1/auth/login");
        URI attackerCallback = IDP.approve(URI.create(attackerStart.headers().firstValue("Location").orElseThrow()),
                BOB, Instant.now(), "1");
        HttpResponse<String> foreign = victim.get(attackerCallback.toString());
        assertThat(foreign.headers().firstValue("Location").orElseThrow()).endsWith("/?loginError=session_expired");
        assertThat(victim.get("/api/v1/me").statusCode()).isEqualTo(401);
    }

    @Test
    void csrfTokenIsAcceptedOnlyFromTheHeader() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        String token = browser.cookie("__Host-XSRF-TOKEN").orElseThrow();
        HttpResponse<String> response = browser.send(java.net.http.HttpRequest.newBuilder(
                        browser.origin().resolve("/api/v1/connections/jira?_csrf=" + token)).DELETE(), Map.of());
        assertThat(response.statusCode()).isEqualTo(403);
        assertThat(response.body()).contains("csrf_invalid");
    }

    @Test
    void springsOwnLoginEntryIsClosed() {
        HttpResponse<String> response = browser().get("/oauth2/authorization/keycloak");
        assertThat(response.statusCode()).isEqualTo(404);
        assertThat(response.headers().firstValue("Location")).isEmpty();
        assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("application/json");
    }

    @Test
    void rejectedInputIsAudited() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        int before = auditEvents().size();

        browser.put("/api/v1/connections/sharepoint/secret", "{\"secret\":\"x\"}", true);
        browser.put("/api/v1/connections/jira/secret", "not json", true);

        List<JsonNode> events = auditEvents().subList(before, auditEvents().size());
        assertThat(events).hasSize(2).allSatisfy(event -> {
            ContractSchemas.assertValid(AUDIT, event);
            assertThat(event.get("decision").asString()).isEqualTo("deny");
            assertThat(event.get("reason").asString()).isEqualTo("invalid_request");
        });
        assertThat(events.getFirst().has("server")).isFalse();
        assertThat(events.getLast().get("server").asString()).isEqualTo("mcp-jira");
    }
}
