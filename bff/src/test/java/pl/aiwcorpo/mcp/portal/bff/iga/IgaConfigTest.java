package pl.aiwcorpo.mcp.portal.bff.iga;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Clock;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;

import pl.aiwcorpo.mcp.portal.bff.config.DevMode;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;

class IgaConfigTest {

    private static PortalProperties properties(String adapter) {
        return new PortalProperties("keycloak", "mcp-portal-bff", null, null, null, null, null, null, null, null,
                new PortalProperties.Iga(adapter, new ByteArrayResource("requests: []".getBytes(StandardCharsets.UTF_8)),
                        "preferred_username"));
    }

    @Test
    void noAdapterIsAStartupError() {
        assertThatThrownBy(() -> new IgaConfig().accessGovernance(properties(null), new DevMode(true), Clock.systemUTC()))
                .hasMessageContaining("No IGA adapter");
    }

    @Test
    void mockOnlyInDev() {
        assertThatThrownBy(() -> new IgaConfig().accessGovernance(properties("mock"), new DevMode(false), Clock.systemUTC()))
                .hasMessageContaining("profile 'dev'");
        assertThat(new IgaConfig().accessGovernance(properties("mock"), new DevMode(true), Clock.systemUTC()))
                .isInstanceOf(MockAccessGovernance.class);
    }
}
