package pl.aiwcorpo.mcp.portal.bff.iga;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.time.Clock;

import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.config.DevMode;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;

class IgaConfigTest {

    private static PortalProperties properties(String adapter) {
        return new PortalProperties("keycloak", "mcp-portal-bff", null, null, null, null, null, null, null, null,
                new PortalProperties.Iga(adapter, "dev/iga-mock.yaml", "preferred_username"), null);
    }

    @Test
    void noAdapterIsAStartupError() {
        assertThatThrownBy(() -> new IgaConfig().accessGovernance(properties(null), new DevMode(true), Clock.systemUTC()))
                .hasMessageContaining("No IGA adapter");
    }

    @Test
    void mockFileIsAPlainPathAndMustExist() {
        PortalProperties absolute = new PortalProperties("keycloak", "mcp-portal-bff", null, null, null, null, null, null,
                null, null, new PortalProperties.Iga("mock", Path.of("dev/iga-mock.yaml").toAbsolutePath().toString(),
                "preferred_username"), null);
        assertThat(new IgaConfig().accessGovernance(absolute, new DevMode(true), Clock.systemUTC())).isNotNull();
        PortalProperties missing = new PortalProperties("keycloak", "mcp-portal-bff", null, null, null, null, null, null,
                null, null, new PortalProperties.Iga("mock", "dev/no-such-file.yaml", "preferred_username"), null);
        assertThatThrownBy(() -> new IgaConfig().accessGovernance(missing, new DevMode(true), Clock.systemUTC()))
                .hasMessageContaining("does not exist");
    }

    @Test
    void mockOnlyInDev() {
        assertThatThrownBy(() -> new IgaConfig().accessGovernance(properties("mock"), new DevMode(false), Clock.systemUTC()))
                .hasMessageContaining("profile 'dev'");
        assertThat(new IgaConfig().accessGovernance(properties("mock"), new DevMode(true), Clock.systemUTC()))
                .isInstanceOf(MockAccessGovernance.class);
    }
}
