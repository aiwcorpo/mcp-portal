package pl.aiwcorpo.mcp.portal.bff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.Map;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import pl.aiwcorpo.mcp.portal.bff.config.DevMode;
import pl.aiwcorpo.mcp.portal.bff.config.PublicUrls;
import pl.aiwcorpo.mcp.portal.bff.support.FakeIdp;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;

/**
 * Public addresses come from {@code portal.public-base-url} (CC-089): the OIDC redirect URI is
 * {@code <publicBaseUrl>/api/v1/auth/callback} whatever {@code Host} or {@code X-Forwarded-Host} the request had.
 * No test override of the redirect URI here, unlike in the other API tests.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("dev")
class PublicBaseUrlTest {

    static final FakeIdp IDP = new FakeIdp();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.security.oauth2.client.provider.keycloak.issuer-uri", IDP::issuer);
        registry.add("spring.security.oauth2.client.registration.keycloak.client-id", () -> FakeIdp.CLIENT_ID);
        registry.add("spring.security.oauth2.client.registration.keycloak.client-secret", () -> FakeIdp.CLIENT_SECRET);
        registry.add("portal.broker.base-url", () -> "http://127.0.0.1:9");
        registry.add("portal.gateway-admin.base-url", () -> "http://127.0.0.1:9");
        registry.add("portal.tls.insecure-plain-http-for-tests", () -> "true");
        registry.add("portal.public-base-url", () -> "https://mcp.aiwcorpo.pl");
        registry.add("portal.web.dist-path", () -> "src/test/resources/spa-fixture");
    }

    @AfterAll
    static void stop() {
        IDP.close();
    }

    @LocalServerPort
    int port;

    @Test
    void redirectUriIsTheConfiguredCallbackUnderApi() {
        TestBrowser browser = new TestBrowser(URI.create("http://localhost:" + port), new ArrayList<>());

        HttpResponse<String> plain = browser.get("/api/v1/auth/login");
        HttpResponse<String> spoofed = browser.send(HttpRequest.newBuilder(browser.origin().resolve("/api/v1/auth/login")).GET(),
                Map.of("X-Forwarded-Host", "evil.test", "X-Forwarded-Proto", "https", "X-Forwarded-Port", "443"));

        for (HttpResponse<String> response : java.util.List.of(plain, spoofed)) {
            Map<String, String> query = FakeIdp.parse(URI.create(response.headers().firstValue("Location").orElseThrow()).getRawQuery());
            assertThat(java.net.URLDecoder.decode(query.get("redirect_uri"), java.nio.charset.StandardCharsets.UTF_8))
                    .isEqualTo("https://mcp.aiwcorpo.pl/api/v1/auth/callback");
        }
    }

    @Test
    void theBaseUrlMustBeAnOriginAndHttpsOutsideDev() {
        assertThat(new PublicUrls(URI.create("https://mcp.aiwcorpo.pl/"), new DevMode(false)).mcp())
                .isEqualTo("https://mcp.aiwcorpo.pl/mcp");
        assertThat(new PublicUrls(URI.create("http://localhost:18700"), new DevMode(true)).server("mcp-jira"))
                .isEqualTo("http://localhost:18700/s/mcp-jira/mcp");
        for (String bad : new String[] {"https://[2001:db8::1]", "https://[::1]:8443", "", "mcp.aiwcorpo.pl", "https://mcp.aiwcorpo.pl/portal", "https://u:p@mcp.aiwcorpo.pl",
                "https://mcp.aiwcorpo.pl/?x=1", "ftp://mcp.aiwcorpo.pl"}) {
            assertThatThrownBy(() -> new PublicUrls(URI.create(bad), new DevMode(true))).as(bad)
                    .isInstanceOf(IllegalStateException.class);
        }
        assertThatThrownBy(() -> new PublicUrls(URI.create("http://mcp.aiwcorpo.pl"), new DevMode(false)))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("dev");
        assertThatThrownBy(() -> new PublicUrls(null, new DevMode(true))).isInstanceOf(IllegalStateException.class);
    }
}
