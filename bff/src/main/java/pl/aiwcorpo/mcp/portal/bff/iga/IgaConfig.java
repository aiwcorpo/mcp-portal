package pl.aiwcorpo.mcp.portal.bff.iga;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.FileSystemResource;

import pl.aiwcorpo.mcp.portal.bff.config.DevMode;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;

/** Selects the C13 adapter. No adapter configured is a start-up error, never a silent default. */
@Configuration(proxyBeanMethods = false)
class IgaConfig {

    @Bean
    AccessGovernance accessGovernance(PortalProperties properties, DevMode devMode, Clock clock) {
        PortalProperties.Iga iga = properties.iga();
        String adapter = iga.adapter();
        if (adapter == null || adapter.isBlank()) {
            throw new IllegalStateException("No IGA adapter configured (portal.iga.adapter); available: keycloak-groups, mock (dev only)");
        }
        if ("keycloak-groups".equals(adapter)) {
            return new KeycloakGroupsAccessGovernance(new FileSystemResource(existing(iga.catalogFile(), "portal.iga.catalog-file", "IGA catalog file")));
        }
        if ("mock".equals(adapter)) {
            devMode.require(true, "portal.iga.adapter=mock");
            return new MockAccessGovernance(new FileSystemResource(existing(iga.mockFile(), "portal.iga.mock-file",
                    "IGA mock file")), iga.requesterIdClaim(), clock);
        }
        throw new IllegalStateException("Unknown IGA adapter '" + adapter + "'; available: keycloak-groups, mock (dev only)");
    }

    private static Path existing(String configured, String setting, String what) {
        if (configured == null || configured.isBlank()) {
            throw new IllegalStateException(setting + " is required for this adapter");
        }
        Path file = Path.of(configured).toAbsolutePath().normalize();
        if (!Files.isRegularFile(file)) {
            throw new IllegalStateException(what + " " + file + " does not exist");
        }
        return file;
    }
}
