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
            throw new IllegalStateException("No IGA adapter configured (portal.iga.adapter); available: mock (dev only)");
        }
        if ("mock".equals(adapter)) {
            devMode.require(true, "portal.iga.adapter=mock");
            if (iga.mockFile() == null || iga.mockFile().isBlank()) {
                throw new IllegalStateException("portal.iga.mock-file is required for the mock adapter");
            }
            Path file = Path.of(iga.mockFile()).toAbsolutePath().normalize();
            if (!Files.isRegularFile(file)) {
                throw new IllegalStateException("IGA mock file " + file + " does not exist");
            }
            return new MockAccessGovernance(new FileSystemResource(file), iga.requesterIdClaim(), clock);
        }
        throw new IllegalStateException("Unknown IGA adapter '" + adapter + "'; available: mock (dev only)");
    }
}
