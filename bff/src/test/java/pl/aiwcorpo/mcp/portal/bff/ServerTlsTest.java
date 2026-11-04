package pl.aiwcorpo.mcp.portal.bff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import pl.aiwcorpo.mcp.portal.bff.support.FakeIdp;
import pl.aiwcorpo.mcp.portal.bff.support.TestPki;

/**
 * Optional TLS on the port of the BFF (PORTAL_SERVER_TLS_*): on, the port speaks https with the PEM certificate and a
 * client that trusts the test CA gets through, plain http does not; the session cookie is the same Secure
 * {@code __Host-} cookie as behind the proxy. Off, every other test of the module runs over plain http.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("dev")
class ServerTlsTest {

    static final FakeIdp IDP = new FakeIdp();
    static final TestPki PKI;

    static {
        try {
            PKI = new TestPki(java.nio.file.Files.createTempDirectory("portal-server-tls"));
        } catch (IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

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
        registry.add("PORTAL_SERVER_TLS_ENABLED", () -> "true");
        registry.add("PORTAL_SERVER_TLS_CERTIFICATE", () -> "file:" + PKI.certificate());
        registry.add("PORTAL_SERVER_TLS_PRIVATE_KEY", () -> "file:" + PKI.privateKey());
    }

    @AfterAll
    static void stop() {
        IDP.close();
    }

    @LocalServerPort
    int port;

    @Test
    void trustingClientReachesTheHttpsPort() throws Exception {
        HttpClient client = HttpClient.newBuilder().sslContext(PKI.clientContext()).build();

        HttpResponse<String> health = client.send(
                HttpRequest.newBuilder(URI.create("https://localhost:" + port + "/actuator/health")).build(),
                HttpResponse.BodyHandlers.ofString());

        assertThat(health.statusCode()).isEqualTo(200);
        assertThat(health.body()).contains("UP");
    }

    @Test
    void sessionCookieStaysSecureAndHostPrefixed() throws Exception {
        HttpClient client = HttpClient.newBuilder().sslContext(PKI.clientContext())
                .followRedirects(HttpClient.Redirect.NEVER).build();

        HttpResponse<String> login = client.send(
                HttpRequest.newBuilder(URI.create("https://localhost:" + port + "/api/v1/auth/login")).build(),
                HttpResponse.BodyHandlers.ofString());

        assertThat(login.statusCode()).isEqualTo(302);
        List<String> cookies = login.headers().allValues("Set-Cookie");
        assertThat(cookies).anySatisfy(cookie -> assertThat(cookie)
                .startsWith("__Host-session=").contains("Secure").contains("HttpOnly").contains("Path=/")
                .doesNotContain("Domain="));
    }

    @Test
    void clientWithoutTheCaIsRefused() {
        HttpClient client = HttpClient.newHttpClient();

        assertThatThrownBy(() -> client.send(
                HttpRequest.newBuilder(URI.create("https://localhost:" + port + "/actuator/health")).build(),
                HttpResponse.BodyHandlers.ofString())).isInstanceOf(IOException.class);
    }

    @Test
    void plainHttpOnTheTlsPortIsNotServed() throws Exception {
        HttpClient client = HttpClient.newHttpClient();

        HttpResponse<String> plain = client.send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/actuator/health")).build(),
                HttpResponse.BodyHandlers.ofString());

        assertThat(plain.statusCode()).isEqualTo(400);
    }

    @Test
    void enabledWithoutCertificateFilesRefusesToStart(@TempDir Path empty) {
        SpringApplicationBuilder builder = new SpringApplicationBuilder(PortalBffApplication.class)
                .web(WebApplicationType.SERVLET).profiles("dev")
                .properties("server.port=0", "PORTAL_SERVER_TLS_ENABLED=true",
                        "PORTAL_SERVER_TLS_CERTIFICATE=file:" + empty.resolve("missing.pem"),
                        "PORTAL_SERVER_TLS_PRIVATE_KEY=file:" + empty.resolve("missing.key"),
                        "spring.security.oauth2.client.provider.keycloak.issuer-uri=" + IDP.issuer(),
                        "spring.security.oauth2.client.registration.keycloak.client-id=" + FakeIdp.CLIENT_ID,
                        "portal.public-base-url=https://mcp.aiwcorpo.pl",
                        "portal.tls.insecure-plain-http-for-tests=true",
                        "portal.broker.base-url=http://127.0.0.1:9", "portal.gateway-admin.base-url=http://127.0.0.1:9",
                        "portal.web.dist-path=src/test/resources/spa-fixture");

        assertThatThrownBy(builder::run).hasRootCauseInstanceOf(java.io.FileNotFoundException.class);
    }

    @Test
    void enabledWithoutAnyCertificateSettingRefusesToStart() {
        SpringApplicationBuilder builder = new SpringApplicationBuilder(PortalBffApplication.class)
                .web(WebApplicationType.SERVLET).profiles("dev")
                .properties("server.port=0", "PORTAL_SERVER_TLS_ENABLED=true",
                        "spring.security.oauth2.client.provider.keycloak.issuer-uri=" + IDP.issuer(),
                        "spring.security.oauth2.client.registration.keycloak.client-id=" + FakeIdp.CLIENT_ID,
                        "portal.public-base-url=https://mcp.aiwcorpo.pl",
                        "portal.tls.insecure-plain-http-for-tests=true",
                        "portal.broker.base-url=http://127.0.0.1:9", "portal.gateway-admin.base-url=http://127.0.0.1:9",
                        "portal.web.dist-path=src/test/resources/spa-fixture");

        assertThatThrownBy(builder::run).isInstanceOf(Exception.class);
    }
}
