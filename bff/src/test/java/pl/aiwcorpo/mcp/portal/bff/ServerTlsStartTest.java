package pl.aiwcorpo.mcp.portal.bff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

import pl.aiwcorpo.mcp.portal.bff.support.FakeIdp;
import pl.aiwcorpo.mcp.portal.bff.support.TestPki;

/** Start-up rules of PORTAL_PUBLIC_TLS_*: what refuses to start, and the dev-profile relaxation for the key file mode. */
class ServerTlsStartTest {

    static final FakeIdp IDP = new FakeIdp();

    @AfterAll
    static void stop() {
        IDP.close();
    }

    /** Command-line arguments, because application-dev.yml outranks default properties. */
    private ConfigurableApplicationContext start(boolean dev, String... tls) {
        List<String> properties = new ArrayList<>(List.of("server.port=0",
                "spring.security.oauth2.client.provider.keycloak.issuer-uri=" + IDP.issuer(),
                "spring.security.oauth2.client.registration.keycloak.client-id=" + FakeIdp.CLIENT_ID,
                "portal.public-base-url=https://mcp.aiwcorpo.pl",
                "portal.tls.insecure-plain-http-for-tests=true",
                "portal.broker.base-url=http://127.0.0.1:9", "portal.gateway-admin.base-url=http://127.0.0.1:9",
                "portal.web.dist-path=src/test/resources/spa-fixture"));
        properties.addAll(List.of(tls));
        SpringApplicationBuilder builder = new SpringApplicationBuilder(PortalBffApplication.class)
                .web(WebApplicationType.SERVLET);
        if (dev) {
            builder.profiles("dev");
        }
        return builder.run(properties.stream().map(p -> "--" + p).toArray(String[]::new));
    }

    @Test
    void enabledWithMissingFilesRefusesToStart(@TempDir Path empty) {
        assertThatThrownBy(() -> start(true, "PORTAL_PUBLIC_TLS_ENABLED=true",
                "PORTAL_PUBLIC_TLS_CERTIFICATE=" + empty.resolve("missing.pem"),
                "PORTAL_PUBLIC_TLS_PRIVATE_KEY=" + empty.resolve("missing.key"))).hasRootCauseInstanceOf(java.io.FileNotFoundException.class);
    }

    @Test
    void enabledWithoutAnySettingRefusesToStart() {
        assertThatThrownBy(() -> start(true, "PORTAL_PUBLIC_TLS_ENABLED=true"))
                .hasMessageContaining("PORTAL_PUBLIC_TLS_CERTIFICATE or PORTAL_PUBLIC_TLS_PRIVATE_KEY is empty");
    }

    @Test
    void keyReadableByOthersRefusesToStartOutsideDev(@TempDir Path dir) throws Exception {
        TestPki pki = new TestPki(dir);
        Files.setPosixFilePermissions(pki.privateKey(), PosixFilePermissions.fromString("rw-r--r--"));

        assertThatThrownBy(() -> start(false, "PORTAL_PUBLIC_TLS_ENABLED=true", "PORTAL_PUBLIC_TLS_CERTIFICATE=" + pki.certificate(),
                "PORTAL_PUBLIC_TLS_PRIVATE_KEY=" + pki.privateKey()))
                .hasMessageContaining("PORTAL_PUBLIC_TLS_PRIVATE_KEY is readable by all users");
    }

    @Test
    void keyReadableByOthersStartsInDevAndPrivateKeyStartsAnywhere(@TempDir Path dir) throws Exception {
        TestPki pki = new TestPki(dir);
        Files.setPosixFilePermissions(pki.privateKey(), PosixFilePermissions.fromString("rw-r--r--"));
        try (ConfigurableApplicationContext context = start(true, "PORTAL_PUBLIC_TLS_ENABLED=true",
                "PORTAL_PUBLIC_TLS_CERTIFICATE=" + pki.certificate(), "PORTAL_PUBLIC_TLS_PRIVATE_KEY=" + pki.privateKey())) {
            assertThat(context.isRunning()).isTrue();
        }

        Files.setPosixFilePermissions(pki.privateKey(), PosixFilePermissions.fromString("rw-------"));
        try (ConfigurableApplicationContext context = start(true, "PORTAL_PUBLIC_TLS_ENABLED=true",
                "PORTAL_PUBLIC_TLS_CERTIFICATE=" + pki.certificate(), "PORTAL_PUBLIC_TLS_PRIVATE_KEY=" + pki.privateKey())) {
            assertThat(context.isRunning()).isTrue();
        }
    }

    @Test
    void disabledNeedsNoFilesAndIgnoresTheKeyMode(@TempDir Path dir) throws Exception {
        Path key = Files.writeString(dir.resolve("key.pem"), "x");
        Files.setPosixFilePermissions(key, PosixFilePermissions.fromString("rw-rw-rw-"));
        try (ConfigurableApplicationContext context = start(true, "PORTAL_PUBLIC_TLS_PRIVATE_KEY=" + key)) {
            assertThat(context.isRunning()).isTrue();
        }
    }

    /** A start without the dev profile, with mTLS stores and https upstreams that are never called. */
    private ConfigurableApplicationContext startWithStores(Path dir, Path keystore, Path truststore) throws Exception {
        Path catalog = Files.writeString(dir.resolve("catalog.yaml"), "entitlements:\n  jira: [mcp-jira-read]\n");
        List<String> properties = List.of("server.port=0",
                "spring.security.oauth2.client.provider.keycloak.issuer-uri=" + IDP.issuer(),
                "spring.security.oauth2.client.registration.keycloak.client-id=" + FakeIdp.CLIENT_ID,
                "portal.public-base-url=https://mcp.aiwcorpo.pl",
                "portal.web.dist-path=src/test/resources/spa-fixture",
                "portal.step-up.acr-values=mfa",
                "portal.iga.adapter=keycloak-groups", "portal.iga.catalog-file=" + catalog,
                "portal.broker.base-url=https://localhost:1", "portal.gateway-admin.base-url=https://localhost:1",
                "portal.tls.insecure-plain-http-for-tests=false",
                "portal.tls.keystore=" + keystore, "portal.tls.keystore-password=changeit",
                "portal.tls.truststore=" + truststore, "portal.tls.truststore-password=changeit");
        return new SpringApplicationBuilder(PortalBffApplication.class).web(WebApplicationType.SERVLET)
                .run(properties.stream().map(p -> "--" + p).toArray(String[]::new));
    }

    @Test
    void anMtlsKeystoreReadableByOthersRefusesToStartOutsideDev(@TempDir Path dir) throws Exception {
        new TestPki(dir);
        Path keystore = dir.resolve("server.p12");
        Files.setPosixFilePermissions(keystore, PosixFilePermissions.fromString("rw-r--r--"));
        assertThatThrownBy(() -> startWithStores(dir, keystore, dir.resolve("ca.p12")))
                .hasStackTraceContaining("portal.tls.keystore readable by all users of the host");

        Files.setPosixFilePermissions(keystore, PosixFilePermissions.fromString("rw-r-----"));
        try (ConfigurableApplicationContext context = startWithStores(dir, keystore, dir.resolve("ca.p12"))) {
            assertThat(context.isRunning()).isTrue();
        }
    }
}
