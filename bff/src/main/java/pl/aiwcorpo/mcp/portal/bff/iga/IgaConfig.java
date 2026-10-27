package pl.aiwcorpo.mcp.portal.bff.iga;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

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
            if (iga.mockFile() == null) {
                throw new IllegalStateException("portal.iga.mock-file is required for the mock adapter");
            }
            return new MockAccessGovernance(iga.mockFile(), iga.requesterIdClaim(), clock);
        }
        throw new IllegalStateException("Unknown IGA adapter '" + adapter + "'; available: mock (dev only)");
    }
}
