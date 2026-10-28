package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.delete;
import static com.github.tomakehurst.wiremock.client.WireMock.deleteRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathMatching;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import ch.qos.logback.classic.spi.ILoggingEvent;
import com.github.tomakehurst.wiremock.client.MappingBuilder;
import com.github.tomakehurst.wiremock.verification.LoggedRequest;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.support.ContractSchemas;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;

/** Authenticator registration (CC-093): step-up MFA, seed shown once, enrollment bound to the session, no secrets in logs. */
class AuthenticatorTest extends PortalHarness {

    private static final String SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    private static final String ENROLLMENT_ID = "enr_8Hq2Zk5LpW9vXc3N";
    private static final String CODE = "938475";
    private static final String START = "/api/v1/authenticator/enrollment";
    private static final String CONFIRM = START + "/confirm";
    private static final String CONFIRM_BODY = "{\"enrollmentId\":\"" + ENROLLMENT_ID + "\",\"code\":\"" + CODE + "\"}";

    @AfterEach
    void defaultStubs() {
        BROKER.resetToDefaultMappings();
        BROKER.resetRequests();
    }

    private TestBrowser fresh() {
        TestBrowser browser = login(ALICE, Instant.now());
        browser.get("/api/v1/me");
        return browser;
    }

    private TestBrowser stale() {
        TestBrowser browser = login(ALICE, Instant.now().minus(Duration.ofHours(2)));
        browser.get("/api/v1/me");
        return browser;
    }

    private static int brokerCalls(String path) {
        return BROKER.findAll(anyRequestedFor(urlPathEqualTo(path))).size();
    }

    private static void stub(MappingBuilder builder, int status, String body) {
        BROKER.stubFor(builder.atPriority(1).willReturn(aResponse().withStatus(status)
                .withHeader("Content-Type", "application/json").withBody(body)));
    }

    private static List<ILoggingEvent> logLines() {
        return List.copyOf(LOGS.list);
    }

    @Test
    void statusPassesThroughEveryStateWithoutCaching() {
        TestBrowser browser = fresh();
        String[] bodies = {
            "{\"state\":\"none\"}",
            "{\"state\":\"active\",\"registeredAt\":\"2026-10-27T09:00:00Z\",\"lastUsedAt\":\"2026-10-27T09:30:00Z\","
                    + "\"lockedUntil\":\"2026-10-27T10:00:00Z\"}",
            "{\"state\":\"disabled\",\"registeredAt\":\"2026-10-27T09:00:00Z\",\"disabledAt\":\"2026-10-28T11:00:00Z\","
                    + "\"disabledReason\":\"daily_failure_limit\"}"};
        for (String body : bodies) {
            stub(get(urlPathEqualTo("/v1/authenticator")), 200, body);
            HttpResponse<String> response = browser.get("/api/v1/authenticator");
            C12.assertResponse("GET", "/api/v1/authenticator", response);
            assertThat(response.statusCode()).isEqualTo(200);
            assertThat(JSON.readTree(response.body())).isEqualTo(JSON.readTree(body));
            assertThat(response.headers().firstValue("Cache-Control")).hasValue("no-store");
        }
    }

    @Test
    void aStatusThatBreaksTheSchemaIsNotShown() {
        TestBrowser browser = fresh();
        for (String body : List.of("{\"state\":\"disabled\",\"registeredAt\":\"2026-10-27T09:00:00Z\"}",
                "{\"state\":\"active\",\"disabledReason\":\"daily_failure_limit\"}",
                "{\"state\":\"paused\"}",
                "{\"state\":\"active\",\"lockedUntil\":\"tomorrow\"}")) {
            stub(get(urlPathEqualTo("/v1/authenticator")), 200, body);
            HttpResponse<String> response = browser.get("/api/v1/authenticator");
            C12.assertResponse("GET", "/api/v1/authenticator", response);
            assertThat(response.statusCode()).as(body).isEqualTo(503);
        }
    }

    @Test
    void startingARegistrationNeedsAFreshMfa() {
        TestBrowser browser = stale();

        HttpResponse<String> response = browser.post(START, null, true);

        C12.assertResponse("POST", START, response);
        assertThat(response.statusCode()).isEqualTo(401);
        JsonNode body = JSON.readTree(response.body());
        assertThat(body.get("error").asString()).isEqualTo("step_up_required");
        assertThat(body.get("stepUpUrl").asString()).isEqualTo("/api/v1/auth/login?stepUp=true&returnPath=/authenticator");
        assertThat(brokerCalls("/v1/authenticator/enrollment")).isZero();
        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("event").asString()).isEqualTo("authenticator");
        assertThat(event.get("reason").asString()).isEqualTo("step_up_required");
        assertThat(event.get("outcome").asString()).isEqualTo("denied");
    }

    @Test
    void removingARegistrationNeedsAFreshMfa() {
        HttpResponse<String> response = stale().delete("/api/v1/authenticator", true);

        C12.assertResponse("DELETE", "/api/v1/authenticator", response);
        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("step_up_required");
        assertThat(BROKER.findAll(deleteRequestedFor(urlPathEqualTo("/v1/authenticator")))).isEmpty();
    }

    @Test
    void theStepUpLoginMakesTheSameSessionFresh() {
        TestBrowser browser = stale();
        assertThat(browser.post(START, null, true).statusCode()).isEqualTo(401);

        HttpResponse<String> stepUp = browser.get("/api/v1/auth/login?stepUp=true&returnPath=/authenticator");
        var callback = IDP.approve(java.net.URI.create(stepUp.headers().firstValue("Location").orElseThrow()), ALICE,
                Instant.now(), "1");
        HttpResponse<String> back = browser.get(callback.toString());
        assertThat(back.headers().firstValue("Location").orElseThrow()).endsWith("/authenticator");

        HttpResponse<String> started = browser.post(START, null, true);
        assertThat(started.statusCode()).isEqualTo(201);
    }

    @Test
    void writesNeedTheCsrfHeader() {
        TestBrowser browser = fresh();

        for (HttpResponse<String> response : List.of(browser.post(START, null, false),
                browser.post(CONFIRM, CONFIRM_BODY, false), browser.delete("/api/v1/authenticator", false))) {
            assertThat(response.statusCode()).isEqualTo(403);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("csrf_invalid");
        }
        assertThat(BROKER.findAll(anyRequestedFor(urlPathMatching("/v1/authenticator.*")))).isEmpty();
    }

    @Test
    void theSeedIsShownOnceWithNoStoreAndStaysOutOfLogsAndAudit() {
        TestBrowser browser = fresh();

        HttpResponse<String> response = browser.post(START, null, true);

        C12.assertResponse("POST", START, response);
        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(response.headers().firstValue("Cache-Control")).hasValue("no-store");
        assertThat(response.headers().firstValue("Pragma")).hasValue("no-cache");
        JsonNode body = JSON.readTree(response.body());
        assertThat(body.get("secret").asString()).isEqualTo(SEED);
        assertThat(body.get("otpauthUri").asString()).contains("secret=" + SEED);
        LoggedRequest sent = BROKER.findAll(postRequestedFor(urlPathEqualTo("/v1/authenticator/enrollment"))).getLast();
        assertThat(sent.getHeader("Authorization")).startsWith("Bearer xt-mcp-credential-broker-");

        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("event").asString()).isEqualTo("authenticator");
        assertThat(event.get("reason").asString()).isEqualTo("authenticator_enrollment_started");
        assertThat(event.get("outcome").asString()).isEqualTo("ok");
        assertThat(event.get("sub").asString()).isEqualTo(ALICE.sub());
        for (ILoggingEvent line : logLines()) {
            assertThat(line.getFormattedMessage()).doesNotContain(SEED).doesNotContain("otpauth");
        }
    }

    @Test
    void theSeedIsNotRepeatedByAnyOtherAnswer() {
        TestBrowser browser = fresh();
        browser.post(START, null, true);

        List<HttpResponse<String>> others = List.of(
                browser.get("/api/v1/authenticator"),
                browser.post(CONFIRM, CONFIRM_BODY, true),
                browser.get("/api/v1/me"),
                browser.get("/api/v1/connections"));

        for (HttpResponse<String> response : others) {
            assertThat(response.headers().map() + response.body()).doesNotContain(SEED).doesNotContain("otpauth");
        }
    }

    @Test
    void anActiveRegistrationAndTheStartLimitArePassedOn() {
        TestBrowser browser = fresh();
        stub(post(urlPathEqualTo("/v1/authenticator/enrollment")), 409, "{\"error\":\"already_registered\"}");
        HttpResponse<String> conflict = browser.post(START, null, true);
        C12.assertResponse("POST", START, conflict);
        assertThat(conflict.statusCode()).isEqualTo(409);
        assertThat(JSON.readTree(conflict.body()).get("error").asString()).isEqualTo("already_registered");
        ContractSchemas.assertValid(AUDIT, lastAuditEvent());
        assertThat(lastAuditEvent().get("reason").asString()).isEqualTo("authenticator_enrollment_failed");

        stub(post(urlPathEqualTo("/v1/authenticator/enrollment")), 429, "{\"error\":\"rate_limited\"}");
        HttpResponse<String> limited = browser.post(START, null, true);
        C12.assertResponse("POST", START, limited);
        assertThat(limited.statusCode()).isEqualTo(429);
        ContractSchemas.assertValid(AUDIT, lastAuditEvent());

        stub(post(urlPathEqualTo("/v1/authenticator/enrollment")), 500, "{\"error\":\"internal\",\"secret\":\"" + SEED + "\"}");
        HttpResponse<String> broken = browser.post(START, null, true);
        C12.assertResponse("POST", START, broken);
        assertThat(broken.statusCode()).isEqualTo(503);
        assertThat(broken.body()).doesNotContain(SEED);
    }

    @Test
    void anEnrollmentAnswerOutsideTheSchemaIsNotPassedOn() {
        TestBrowser browser = fresh();
        stub(post(urlPathEqualTo("/v1/authenticator/enrollment")), 201, """
                {"enrollmentId":"%s","otpauthUri":"https://elsewhere.test/qr","secret":"%s",
                 "expiresAt":"2026-10-27T09:10:00Z"}""".formatted(ENROLLMENT_ID, SEED));

        HttpResponse<String> response = browser.post(START, null, true);

        C12.assertResponse("POST", START, response);
        assertThat(response.statusCode()).isEqualTo(503);
        assertThat(response.body()).doesNotContain(SEED);
        assertThat(browser.post(CONFIRM, CONFIRM_BODY, true).statusCode()).as("nothing was remembered").isEqualTo(404);
    }

    @Test
    void aRegistrationFromTheDisabledStateStartsWithoutRemovingTheOldOne() {
        TestBrowser browser = fresh();
        stub(get(urlPathEqualTo("/v1/authenticator")), 200, "{\"state\":\"disabled\",\"registeredAt\":\"2026-10-27T09:00:00Z\","
                + "\"disabledAt\":\"2026-10-28T11:00:00Z\",\"disabledReason\":\"daily_failure_limit\"}");

        assertThat(browser.get("/api/v1/authenticator").statusCode()).isEqualTo(200);
        assertThat(browser.post(START, null, true).statusCode()).isEqualTo(201);

        assertThat(BROKER.findAll(deleteRequestedFor(urlPathEqualTo("/v1/authenticator")))).isEmpty();
    }

    @Test
    void theFirstCodeActivatesOnlyTheEnrollmentOfThisSession() {
        TestBrowser owner = fresh();
        TestBrowser other = fresh();
        owner.post(START, null, true);

        HttpResponse<String> foreign = other.post(CONFIRM, CONFIRM_BODY, true);
        C12.assertResponse("POST", CONFIRM, foreign);
        assertThat(foreign.statusCode()).isEqualTo(404);
        assertThat(JSON.readTree(foreign.body()).get("error").asString()).isEqualTo("not_found_or_denied");
        assertThat(brokerCalls("/v1/authenticator/enrollment/confirm")).isZero();

        HttpResponse<String> wrongId = owner.post(CONFIRM,
                "{\"enrollmentId\":\"enr_AAAAAAAAAAAAAAAA\",\"code\":\"" + CODE + "\"}", true);
        assertThat(wrongId.statusCode()).isEqualTo(404);
        assertThat(brokerCalls("/v1/authenticator/enrollment/confirm")).isZero();

        HttpResponse<String> activated = owner.post(CONFIRM, CONFIRM_BODY, true);
        C12.assertResponse("POST", CONFIRM, activated);
        assertThat(activated.statusCode()).isEqualTo(200);
        assertThat(JSON.readTree(activated.body()).get("state").asString()).isEqualTo("active");
        LoggedRequest sent = BROKER.findAll(postRequestedFor(urlPathEqualTo("/v1/authenticator/enrollment/confirm"))).getLast();
        assertThat(JSON.readTree(sent.getBodyAsString()).get("code").asString()).isEqualTo(CODE);
        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("reason").asString()).isEqualTo("authenticator_registered");
        for (ILoggingEvent line : logLines()) {
            assertThat(line.getFormattedMessage()).doesNotContain(CODE);
        }

        assertThat(owner.post(CONFIRM, CONFIRM_BODY, true).statusCode()).as("the enrollment is used up").isEqualTo(404);
    }

    @Test
    void aWrongCodeLeavesTheEnrollmentOpenAndAnExpiredOneEndsIt() {
        TestBrowser browser = fresh();
        browser.post(START, null, true);

        stub(post(urlPathEqualTo("/v1/authenticator/enrollment/confirm")), 422, "{\"error\":\"invalid_code\"}");
        HttpResponse<String> wrong = browser.post(CONFIRM, CONFIRM_BODY, true);
        C12.assertResponse("POST", CONFIRM, wrong);
        assertThat(wrong.statusCode()).isEqualTo(422);
        assertThat(JSON.readTree(wrong.body()).get("error").asString()).isEqualTo("invalid_code");
        ContractSchemas.assertValid(AUDIT, lastAuditEvent());
        assertThat(lastAuditEvent().get("reason").asString()).isEqualTo("authenticator_enrollment_failed");

        stub(post(urlPathEqualTo("/v1/authenticator/enrollment/confirm")), 422, "{\"error\":\"enrollment_invalid\"}");
        HttpResponse<String> expired = browser.post(CONFIRM, CONFIRM_BODY, true);
        C12.assertResponse("POST", CONFIRM, expired);
        assertThat(expired.statusCode()).isEqualTo(422);
        assertThat(JSON.readTree(expired.body()).get("error").asString()).isEqualTo("enrollment_invalid");

        assertThat(browser.post(CONFIRM, CONFIRM_BODY, true).statusCode()).as("start again").isEqualTo(404);
        for (ILoggingEvent line : logLines()) {
            assertThat(line.getFormattedMessage()).doesNotContain(CODE);
        }
    }

    @Test
    void confirmBodiesOutsideTheContractAreRefusedBeforeTheBroker() {
        TestBrowser browser = fresh();
        browser.post(START, null, true);
        int before = brokerCalls("/v1/authenticator/enrollment/confirm");

        for (String body : List.of("", "{}", "not json", "[]",
                "{\"enrollmentId\":\"" + ENROLLMENT_ID + "\",\"code\":\"12345\"}",
                "{\"enrollmentId\":\"" + ENROLLMENT_ID + "\",\"code\":\"1234567\"}",
                "{\"enrollmentId\":\"" + ENROLLMENT_ID + "\",\"code\":\"12345a\"}",
                "{\"enrollmentId\":\"" + ENROLLMENT_ID + "\",\"code\":123456}",
                "{\"enrollmentId\":\"" + ENROLLMENT_ID + "\",\"code\":\"123456\",\"extra\":1}",
                "{\"enrollmentId\":\"short\",\"code\":\"123456\"}",
                "{\"code\":\"123456\"}")) {
            HttpResponse<String> response = browser.post(CONFIRM, body, true);
            C12.assertResponse("POST", CONFIRM, response);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
        }
        assertThat(brokerCalls("/v1/authenticator/enrollment/confirm")).isEqualTo(before);
    }

    @Test
    void removingIsIdempotentAndDropsAPendingEnrollmentOfTheSession() {
        TestBrowser browser = fresh();
        browser.post(START, null, true);

        HttpResponse<String> first = browser.delete("/api/v1/authenticator", true);
        HttpResponse<String> again = browser.delete("/api/v1/authenticator", true);

        for (HttpResponse<String> response : List.of(first, again)) {
            C12.assertResponse("DELETE", "/api/v1/authenticator", response);
            assertThat(response.statusCode()).isEqualTo(204);
        }
        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("reason").asString()).isEqualTo("authenticator_removed");
        assertThat(browser.post(CONFIRM, CONFIRM_BODY, true).statusCode()).isEqualTo(404);
    }

    @Test
    void aBrokerFailureWhileRemovingIsAuditedAndUnavailable() {
        TestBrowser browser = fresh();
        stub(delete(urlPathEqualTo("/v1/authenticator")), 503, "{\"error\":\"upstream_unavailable\"}");

        HttpResponse<String> response = browser.delete("/api/v1/authenticator", true);

        C12.assertResponse("DELETE", "/api/v1/authenticator", response);
        assertThat(response.statusCode()).isEqualTo(503);
        JsonNode event = lastAuditEvent();
        ContractSchemas.assertValid(AUDIT, event);
        assertThat(event.get("reason").asString()).isEqualTo("upstream_unavailable");
    }

    @Test
    void meShowsHowLongTheMfaCountsAsFresh() {
        JsonNode freshMe = JSON.readTree(fresh().get("/api/v1/me").body());
        JsonNode staleMe = JSON.readTree(stale().get("/api/v1/me").body());

        C12.assertComponent("Me", freshMe);
        assertThat(Instant.parse(freshMe.get("mfaFreshUntil").asString())).isAfter(Instant.now());
        C12.assertComponent("Me", staleMe);
        assertThat(staleMe.has("mfaFreshUntil")).isFalse();
    }
}
