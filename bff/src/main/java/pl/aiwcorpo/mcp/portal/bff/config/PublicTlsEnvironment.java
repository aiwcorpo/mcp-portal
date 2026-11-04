package pl.aiwcorpo.mcp.portal.bff.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Map;

import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.Profiles;

/**
 * Prepares the optional TLS of the public port (PORTAL_PUBLIC_TLS_*) before the SSL bundle is built. Operators give plain
 * file paths, but a Spring resource location without a scheme is read from the classpath, so the {@code file:} prefix is
 * added here. With TLS on, a private key that other users of the host can read stops the start unless the profile
 * {@code dev} is active (same rule as DevstackGuard of the gateway).
 */
public class PublicTlsEnvironment implements EnvironmentPostProcessor {

    static final String ENABLED = "PORTAL_PUBLIC_TLS_ENABLED";
    static final String CERTIFICATE = "PORTAL_PUBLIC_TLS_CERTIFICATE";
    static final String PRIVATE_KEY = "PORTAL_PUBLIC_TLS_PRIVATE_KEY";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        if (!Boolean.parseBoolean(environment.getProperty(ENABLED, "false"))) {
            return;
        }
        String key = environment.getProperty(PRIVATE_KEY, "");
        if (!environment.acceptsProfiles(Profiles.of(DevMode.PROFILE)) && readableByOthers(key)) {
            throw new IllegalStateException("PORTAL_PUBLIC_TLS_PRIVATE_KEY is readable by all users of the host: " + key
                    + " (chmod o-rwx; the relaxation exists only with the Spring profile '" + DevMode.PROFILE + "')");
        }
        environment.getPropertySources().addFirst(new MapPropertySource("portalPublicTls", Map.of(
                "portal.public-tls.certificate-location", location(environment.getProperty(CERTIFICATE, "")),
                "portal.public-tls.private-key-location", location(key))));
    }

    static String location(String path) {
        if (path.isBlank() || path.startsWith("file:")) {
            return path;
        }
        return "file:" + path;
    }

    static boolean readableByOthers(String file) {
        if (file.isBlank()) {
            return false;
        }
        try {
            return Files.getPosixFilePermissions(Path.of(file.startsWith("file:") ? file.substring(5) : file)).stream()
                    .anyMatch(p -> p == PosixFilePermission.OTHERS_READ || p == PosixFilePermission.OTHERS_WRITE
                            || p == PosixFilePermission.OTHERS_EXECUTE);
        } catch (IOException | UnsupportedOperationException e) {
            return false;
        }
    }
}
