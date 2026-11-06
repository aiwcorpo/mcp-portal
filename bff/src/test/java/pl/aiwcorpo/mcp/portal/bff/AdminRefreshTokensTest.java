package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.put;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import com.github.tomakehurst.wiremock.verification.LoggedRequest;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.support.FakeIdp;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;

/**
 * The admin calls after a step-up login (Keycloak re-derives {@code acr} on a token exchange, so the BFF gets the admin
 * audiences with the login and narrows one refresh grant per audience): which scopes the step-up asks for, which tokens
 * reach the gateway and the broker, what is cached, rotation of refresh tokens and the fallback to the exchange.
 */
class AdminRefreshTokensTest extends PortalHarness {

    private static final String OVERRIDE = "/api/v1/admin/policy/overrides/{id}";
    private static final String OVERRIDE_PATH = "/api/v1/admin/policy/overrides/override-block-drop-table";
    private static final String UPSTREAM_OVERRIDE = "/admin/v1/policy/overrides/override-block-drop-table";
    private static final String OVERRIDE_BODY = C12.requestExample("PUT", OVERRIDE, "block_drop_table").toString();
    private static final String OVERRIDE_ANSWER = C12.responseExample("PUT", OVERRIDE, 200, "block_drop_table").toString();
    private static final String SYSTEMS_ANSWER = C12.responseExample("GET", "/api/v1/admin/systems", 200, "one").toString();
    private static final String GATEWAY_SCOPE = "openid mcp-gateway-admin-audience";
    private static final String BROKER_SCOPE = "openid mcp-credential-broker-audience";

    private URI lastAuthorization;

    @BeforeEach
    void stubsAndIdp() {
        IDP.tokenRequests().clear();
        IDP.rotateRefreshTokens(false);
        IDP.refuseNarrowedRefresh(false);
        GATEWAY.stubFor(put(urlPathEqualTo(UPSTREAM_OVERRIDE)).willReturn(aResponse().withStatus(200)
                .withHeader("Content-Type", "application/json").withHeader("ETag", "\"Zx8Tq2LmWk93vNpA\"")
                .withBody(OVERRIDE_ANSWER)));
        BROKER.stubFor(get(urlPathEqualTo("/v1/admin/systems")).willReturn(aResponse().withStatus(200)
                .withHeader("Content-Type", "application/json").withBody(SYSTEMS_ANSWER)));
    }

    @AfterEach
    void defaults() {
        GATEWAY.resetToDefaultMappings();
        GATEWAY.resetRequests();
        BROKER.resetToDefaultMappings();
        BROKER.resetRequests();
    }

    private TestBrowser stepUp(FakeIdp.User user) {
        TestBrowser browser = login(user, Instant.now().minus(Duration.ofHours(1)));
        browser.get("/api/v1/me");
        HttpResponse<String> start = browser.get("/api/v1/auth/login?stepUp=true&returnPath=/admin/overrides");
        assertThat(start.statusCode()).isEqualTo(302);
        lastAuthorization = URI.create(start.headers().firstValue("Location").orElseThrow());
        URI callback = IDP.approve(lastAuthorization, user, Instant.now(), "mfa");
        HttpResponse<String> back = browser.get(callback.toString());
        assertThat(back.statusCode()).isEqualTo(302);
        browser.get("/api/v1/me");
        return browser;
    }

    private HttpResponse<String> createOverride(TestBrowser browser) {
        return browser.request("PUT", OVERRIDE_PATH, OVERRIDE_BODY, true, Map.of("If-None-Match", "*"));
    }

    private static List<Map<String, String>> grants(String type) {
        return IDP.tokenRequests().stream().filter(request -> type.equals(request.get("grant_type"))).toList();
    }

    private static List<String> narrowedRefreshScopes() {
        return grants("refresh_token").stream().map(request -> request.get("scope")).filter(java.util.Objects::nonNull).toList();
    }

    private static String authorization(LoggedRequest request) {
        return request.getHeader("Authorization");
    }

    @Test
    void theStepUpOfAnAdministratorAsksForTheAdminAudienceScopesAndOthersDoNot() {
        stepUp(CAROL);
        Map<String, String> admin = FakeIdp.parse(lastAuthorization.getRawQuery());
        assertThat(admin.get("scope").split(" ")).contains("openid", "mcp-gateway-admin-audience",
                "mcp-credential-broker-audience");
        assertThat(admin.get("max_age")).isEqualTo("0");

        stepUp(ALICE);
        Map<String, String> user = FakeIdp.parse(lastAuthorization.getRawQuery());
        assertThat(user.get("scope")).doesNotContain("mcp-gateway-admin-audience")
                .doesNotContain("mcp-credential-broker-audience");
    }

    @Test
    void theOrdinaryLoginNeverAsksForThem() {
        login(CAROL, Instant.now());
        assertThat(grants("authorization_code")).hasSize(1);
        assertThat(grants("authorization_code").getFirst().get("scope")).isNull();
    }

    @Test
    void afterTheStepUpAdminCallsCarryOneNarrowedTokenPerAudienceAndNoExchangeHappens() {
        TestBrowser admin = stepUp(CAROL);

        assertThat(createOverride(admin).statusCode()).isEqualTo(200);
        assertThat(admin.get("/api/v1/admin/systems").statusCode()).isEqualTo(200);

        assertThat(GATEWAY.findAll(anyRequestedFor(urlPathEqualTo(UPSTREAM_OVERRIDE)))).singleElement()
                .satisfies(request -> assertThat(authorization(request)).startsWith("Bearer na-mcp-gateway-admin-"));
        assertThat(BROKER.findAll(anyRequestedFor(urlPathEqualTo("/v1/admin/systems")))).singleElement()
                .satisfies(request -> assertThat(authorization(request)).startsWith("Bearer na-mcp-credential-broker-"));
        assertThat(narrowedRefreshScopes()).containsExactlyInAnyOrder(GATEWAY_SCOPE, BROKER_SCOPE);
        assertThat(grants("urn:ietf:params:oauth:grant-type:token-exchange")).isEmpty();
    }

    @Test
    void theTokenOfTheLoginItselfCarriesBothAudiencesAndNeverLeavesTheBff() {
        TestBrowser admin = stepUp(CAROL);
        createOverride(admin);
        admin.get("/api/v1/admin/systems");

        List<String> sent = new java.util.ArrayList<>();
        GATEWAY.getAllServeEvents().forEach(event -> sent.add(authorization(event.getRequest())));
        BROKER.getAllServeEvents().forEach(event -> sent.add(authorization(event.getRequest())));
        assertThat(sent).isNotEmpty().allSatisfy(header -> assertThat(header).doesNotStartWith("Bearer at-"));
    }

    @Test
    void aNarrowedTokenIsReusedUntilItsShortTimeToLiveIsOver() {
        TestBrowser admin = stepUp(CAROL);
        createOverride(admin);
        createOverride(admin);
        assertThat(narrowedRefreshScopes()).containsExactly(GATEWAY_SCOPE);

        clock.advance(Duration.ofMinutes(3));
        createOverride(admin);
        assertThat(narrowedRefreshScopes()).containsExactly(GATEWAY_SCOPE, GATEWAY_SCOPE);
    }

    @Test
    void aStepUpThrowsTheCachedTokensAwayWithTheRestOfTheOldSession() {
        TestBrowser admin = createdAfterStepUp();
        String before = IDP.tokenRequests().toString();

        HttpResponse<String> start = admin.get("/api/v1/auth/login?stepUp=true&returnPath=/admin/overrides");
        URI callback = IDP.approve(URI.create(start.headers().firstValue("Location").orElseThrow()), CAROL, Instant.now(), "mfa");
        admin.get(callback.toString());
        createOverride(admin);

        assertThat(narrowedRefreshScopes()).containsExactly(GATEWAY_SCOPE, GATEWAY_SCOPE);
        assertThat(IDP.tokenRequests().toString()).isNotEqualTo(before);
    }

    private TestBrowser createdAfterStepUp() {
        TestBrowser admin = stepUp(CAROL);
        createOverride(admin);
        return admin;
    }

    @Test
    void anIdpThatRotatesRefreshTokensKeepsWorkingBecauseTheSessionHoldsTheNewOne() {
        IDP.rotateRefreshTokens(true);
        TestBrowser admin = stepUp(CAROL);

        assertThat(createOverride(admin).statusCode()).isEqualTo(200);
        assertThat(admin.get("/api/v1/admin/systems").statusCode()).isEqualTo(200);

        List<String> used = grants("refresh_token").stream().map(request -> request.get("refresh_token")).toList();
        assertThat(used).hasSize(2).doesNotHaveDuplicates();
        assertThat(IDP.issuedTokens()).containsAll(used);
    }

    @Test
    void anIdpThatRefusesTheNarrowedRefreshFallsBackToTheExchange() {
        IDP.refuseNarrowedRefresh(true);
        TestBrowser admin = stepUp(CAROL);

        assertThat(createOverride(admin).statusCode()).isEqualTo(200);

        assertThat(GATEWAY.findAll(anyRequestedFor(urlPathEqualTo(UPSTREAM_OVERRIDE)))).singleElement()
                .satisfies(request -> assertThat(authorization(request)).startsWith("Bearer xt-mcp-gateway-admin-"));
        assertThat(grants("urn:ietf:params:oauth:grant-type:token-exchange")).hasSize(1);
    }

    @Test
    void withoutTheScopesInTheLoginAdminCallsStayOnTheExchange() {
        TestBrowser admin = login(CAROL, Instant.now());
        admin.get("/api/v1/me");

        assertThat(createOverride(admin).statusCode()).isEqualTo(200);

        assertThat(GATEWAY.findAll(anyRequestedFor(urlPathEqualTo(UPSTREAM_OVERRIDE)))).singleElement()
                .satisfies(request -> assertThat(authorization(request)).startsWith("Bearer xt-mcp-gateway-admin-"));
        assertThat(narrowedRefreshScopes()).isEmpty();
    }

    @Test
    void theUserFlowsKeepTheExchangeAfterTheStepUp() {
        TestBrowser admin = stepUp(CAROL);

        admin.get("/api/v1/connections");

        assertThat(grants("urn:ietf:params:oauth:grant-type:token-exchange")).isNotEmpty();
        assertThat(narrowedRefreshScopes()).isEmpty();
    }
}
