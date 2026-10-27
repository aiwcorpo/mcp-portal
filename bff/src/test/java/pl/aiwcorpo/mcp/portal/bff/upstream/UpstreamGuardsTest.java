package pl.aiwcorpo.mcp.portal.bff.upstream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.config.DevMode;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;

class UpstreamGuardsTest {

    private static PortalProperties.Upstream upstream(String url) {
        return new PortalProperties.Upstream(URI.create(url), null, Duration.ofSeconds(1), Duration.ofSeconds(1));
    }

    private static PortalProperties.Tls tls(Path keystore, Path truststore, boolean plainHttpForTests) {
        return new PortalProperties.Tls(keystore, "x", truststore, "x", plainHttpForTests);
    }

    @Test
    void plainHttpOnlyWithTheTestFlagInDev() {
        assertThatThrownBy(() -> UpstreamHttp.restClient("broker", upstream("http://broker:8080"),
                tls(null, null, false), new DevMode(true))).hasMessageContaining("https");
        assertThatThrownBy(() -> UpstreamHttp.restClient("broker", upstream("http://broker:8080"),
                tls(null, null, true), new DevMode(false))).hasMessageContaining("profile 'dev'");
        assertThat(UpstreamHttp.restClient("broker", upstream("http://broker:8080"),
                tls(null, null, true), new DevMode(true))).isNotNull();
    }

    @Test
    void httpsNeedsClientCertificateAndTrustStore() {
        assertThatThrownBy(() -> UpstreamHttp.restClient("broker", upstream("https://broker:8443"),
                tls(null, Path.of("ca.p12"), false), new DevMode(true))).hasMessageContaining("keystore");
        assertThatThrownBy(() -> UpstreamHttp.restClient("broker", upstream("https://broker:8443"),
                tls(Path.of("bff.p12"), null, false), new DevMode(true))).hasMessageContaining("truststore");
    }

    @Test
    void dataOutsideTheContractIsDroppedOrNormalized() {
        List<BrokerModel.Connection> connections = BrokerData.validConnections(List.of(
                new BrokerModel.Connection("jira", "user-secret", "suspended", "alice", null, "2026-10-01T08:00:00Z", null),
                new BrokerModel.Connection("sharepoint", "user-secret", "connected", "alice", null, "2026-10-01T08:00:00Z", null),
                new BrokerModel.Connection("gitlab", "magic", "connected", "alice", null, "2026-10-01T08:00:00Z", null)));
        assertThat(connections).singleElement().satisfies(c -> {
            assertThat(c.system()).isEqualTo("jira");
            assertThat(c.status()).isEqualTo("error");
        });

        GatewayModel.Catalog catalog = BrokerData.validCatalog(new GatewayModel.Catalog(List.of(
                new GatewayModel.CatalogServer("mcp-jira", "jira", "1.0.0", null),
                new GatewayModel.CatalogServer("mcp-gitlab", "gitlab", "1.0.0", List.of(
                        new GatewayModel.CatalogTool("gitlab__a", null, "READ_ONLY", "read", "maybe", null),
                        new GatewayModel.CatalogTool("gitlab__b", "b", "HARMLESS", "read", "granted", List.of()))),
                new GatewayModel.CatalogServer("mcp-x", "sharepoint", "1.0.0", List.of()))));
        assertThat(catalog.servers()).extracting(GatewayModel.CatalogServer::system).containsExactly("jira", "gitlab");
        assertThat(catalog.servers().getFirst().tools()).isEmpty();
        assertThat(catalog.servers().get(1).tools()).singleElement().satisfies(tool -> {
            assertThat(tool.name()).isEqualTo("gitlab__a");
            assertThat(tool.access()).isEqualTo("denied");
            assertThat(tool.requiredEntitlements()).isEmpty();
            assertThat(tool.description()).isEmpty();
        });
    }
}
