package pl.aiwcorpo.mcp.portal.bff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.net.URI;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import pl.aiwcorpo.mcp.portal.bff.support.FakeIdp;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;

/**
 * The real Angular build of ws-08 ({@code ../web/dist/portal}, skipped when not built) behind the BFF, and the
 * dev-only return to a separately served frontend after login.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("dev")
class FrontendBuildTest {

    static final Path DIST = Path.of("../web/dist/portal");
    static final FakeIdp IDP = new FakeIdp();
    static final Pattern ASSET = Pattern.compile("(?:src|href)=\"([^\"/][^\"]*\\.(?:js|css))\"");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.security.oauth2.client.provider.keycloak.issuer-uri", IDP::issuer);
        registry.add("spring.security.oauth2.client.registration.keycloak.client-id", () -> FakeIdp.CLIENT_ID);
        registry.add("spring.security.oauth2.client.registration.keycloak.client-secret", () -> FakeIdp.CLIENT_SECRET);
        // Upstreams are not called in this test.
        registry.add("portal.broker.base-url", () -> "http://127.0.0.1:9");
        registry.add("portal.gateway-admin.base-url", () -> "http://127.0.0.1:9");
        registry.add("portal.tls.insecure-plain-http-for-tests", () -> "true");
        registry.add("portal.gateway.public-url", () -> "https://mcp-gateway.internal");
        registry.add("portal.web.dist-path", DIST::toString);
        registry.add("portal.web.login-return-origin", () -> "http://localhost:4200");
    }

    @AfterAll
    static void stop() {
        IDP.close();
    }

    @LocalServerPort
    int port;

    private TestBrowser browser() {
        return new TestBrowser(URI.create("http://localhost:" + port), new ArrayList<>());
    }

    @Test
    void servesTheAngularBuildWithNoncedStyles() {
        boolean built = Files.isRegularFile(DIST.resolve("index.html"));
        // -Dportal.test.require-web-dist=true turns the skip into a failure (CI with the frontend built first).
        if (Boolean.getBoolean("portal.test.require-web-dist")) {
            assertThat(built).as("web/dist/portal/index.html").isTrue();
        }
        assumeTrue(built, "web/dist/portal not built (npm run build in web/)");
        TestBrowser browser = browser();

        for (String route : List.of("/", "/catalog", "/connect/jira", "/connections")) {
            HttpResponse<String> page = browser.get(route);
            assertThat(page.statusCode()).as(route).isEqualTo(200);
            String csp = page.headers().firstValue("Content-Security-Policy").orElseThrow();
            assertThat(csp).doesNotContain("unsafe-inline").contains("script-src 'self';");
            String nonce = csp.replaceAll(".*style-src 'self' 'nonce-([^']+)'.*", "$1");
            assertThat(page.body()).doesNotContain("__CSP_NONCE__").contains("\"" + nonce + "\"");
            assertThat(page.body()).containsIgnoringCase("ngCspNonce=\"" + nonce + "\"");
            assertThat(page.headers().firstValue("Cache-Control").orElseThrow()).contains("no-store");

            Matcher assets = ASSET.matcher(page.body());
            int found = 0;
            while (assets.find()) {
                found++;
                HttpResponse<String> asset = browser.get("/" + assets.group(1));
                assertThat(asset.statusCode()).as(assets.group(1)).isEqualTo(200);
                assertThat(asset.headers().firstValue("Content-Type").orElse("")).doesNotStartWith("text/html");
            }
            assertThat(found).isPositive();
        }
    }

    @Test
    void devLoginReturnsToTheConfiguredFrontendOrigin() {
        TestBrowser browser = browser();
        HttpResponse<String> start = browser.get("/api/v1/auth/login?returnPath=/connections");
        URI callback = IDP.approve(URI.create(start.headers().firstValue("Location").orElseThrow()),
                new FakeIdp.User("sub-dev", "alice", "Alice Tester", List.of("mcp-jira-read")), Instant.now(), "1");

        HttpResponse<String> back = browser.get(callback.toString());

        assertThat(back.statusCode()).isEqualTo(302);
        assertThat(back.headers().firstValue("Location").orElseThrow()).isEqualTo("http://localhost:4200/connections");
    }
}
