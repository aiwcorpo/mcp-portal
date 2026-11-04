package pl.aiwcorpo.mcp.portal.bff.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;

import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;

class PublicTlsEnvironmentTest {

    private final PublicTlsEnvironment processor = new PublicTlsEnvironment();

    private Path key(Path dir, String mode) throws Exception {
        Path key = Files.writeString(dir.resolve("key.pem"), "x");
        Files.setPosixFilePermissions(key, PosixFilePermissions.fromString(mode));
        return key;
    }

    @ParameterizedTest
    @ValueSource(strings = {"true", "TRUE", "yes", "on", "1"})
    void everySpellingSpringReadsAsTrueTurnsOnTheGuardAndThePrefix(String spelling, @TempDir Path dir) throws Exception {
        Path key = key(dir, "rw-r--r--");
        MockEnvironment open = new MockEnvironment().withProperty("PORTAL_PUBLIC_TLS_ENABLED", spelling)
                .withProperty("PORTAL_PUBLIC_TLS_CERTIFICATE", "/certs/tls.crt")
                .withProperty("PORTAL_PUBLIC_TLS_PRIVATE_KEY", key.toString());

        assertThatThrownBy(() -> processor.postProcessEnvironment(open, null))
                .hasMessageContaining("readable by all users");

        Files.setPosixFilePermissions(key, PosixFilePermissions.fromString("rw-------"));
        MockEnvironment closed = new MockEnvironment().withProperty("PORTAL_PUBLIC_TLS_ENABLED", spelling)
                .withProperty("PORTAL_PUBLIC_TLS_CERTIFICATE", "/certs/tls.crt")
                .withProperty("PORTAL_PUBLIC_TLS_PRIVATE_KEY", key.toString());
        processor.postProcessEnvironment(closed, null);
        assertThat(closed.getProperty("portal.public-tls.certificate-location")).isEqualTo("file:/certs/tls.crt");
        assertThat(closed.getProperty("portal.public-tls.private-key-location")).isEqualTo("file:" + key);
    }

    @ParameterizedTest
    @ValueSource(strings = {"false", "no", "off", "0", ""})
    void otherSpellingsLeaveTheEnvironmentAlone(String spelling, @TempDir Path dir) throws Exception {
        MockEnvironment env = new MockEnvironment().withProperty("PORTAL_PUBLIC_TLS_ENABLED", spelling)
                .withProperty("PORTAL_PUBLIC_TLS_CERTIFICATE", "/certs/tls.crt")
                .withProperty("PORTAL_PUBLIC_TLS_PRIVATE_KEY", key(dir, "rw-rw-rw-").toString());

        processor.postProcessEnvironment(env, null);

        assertThat(env.getProperty("portal.public-tls.private-key-location")).isNull();
    }

    @org.junit.jupiter.api.Test
    void keyWithoutAccessForOthersStartsOutsideDev(@TempDir Path dir) throws Exception {
        for (String mode : new String[] {"rw-------", "rw-r-----"}) {
            MockEnvironment env = new MockEnvironment().withProperty("PORTAL_PUBLIC_TLS_ENABLED", "true")
                    .withProperty("PORTAL_PUBLIC_TLS_CERTIFICATE", "/certs/tls.crt")
                    .withProperty("PORTAL_PUBLIC_TLS_PRIVATE_KEY", key(dir, mode).toString());
            processor.postProcessEnvironment(env, null);
        }
    }

    @org.junit.jupiter.api.Test
    void devProfileAllowsAKeyReadableByOthers(@TempDir Path dir) throws Exception {
        MockEnvironment env = new MockEnvironment().withProperty("PORTAL_PUBLIC_TLS_ENABLED", "true")
                .withProperty("PORTAL_PUBLIC_TLS_CERTIFICATE", "/certs/tls.crt")
                .withProperty("PORTAL_PUBLIC_TLS_PRIVATE_KEY", key(dir, "rw-r--r--").toString());
        env.setActiveProfiles("dev");

        processor.postProcessEnvironment(env, null);
    }
}
