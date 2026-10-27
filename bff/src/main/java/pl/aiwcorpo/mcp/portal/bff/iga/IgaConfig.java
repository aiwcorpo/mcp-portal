package pl.aiwcorpo.mcp.portal.bff.iga;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;

@Configuration(proxyBeanMethods = false)
class IgaConfig {

    @Bean
    AccessGovernance accessGovernance(PortalProperties properties, Clock clock) {
        String adapter = properties.iga().adapter();
        if ("mock".equals(adapter)) {
            return new MockAccessGovernance(properties.iga().mockFile(), clock);
        }
        throw new IllegalStateException("Unknown IGA adapter '" + adapter + "'; available: mock");
    }
}
