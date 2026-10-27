package pl.aiwcorpo.mcp.portal.bff.upstream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.config.DevMode;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;
import pl.aiwcorpo.mcp.portal.bff.support.DevEnvironment;
import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;

/** mTLS to the C4 stub of mcp-platform-dev: client certificate required, server name pinned (CC-035). */
@Tag("dev-env")
class UpstreamTlsDevEnvironmentTest {

    static final DevEnvironment DEV = DevEnvironment.locate();
    static final BearerToken TOKEN = new BearerToken("not-checked-by-the-stub", Instant.now().plusSeconds(60));
    static final String REQUEST_ID = "0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e7f";

    @BeforeAll
    static void requireEnvironment() {
        assumeTrue(DEV.keycloakReachable(), "mcp-platform-dev is not running (make up)");
    }

    private static BrokerClient broker(String tlsName, Path clientKeystore) {
        Path certs = DEV.certs();
        PortalProperties.Tls tls = new PortalProperties.Tls(clientKeystore, DEV.value("TLS_STORE_PASSWORD"),
                certs.resolve("ca/truststore.p12"), DEV.value("TLS_STORE_PASSWORD"), false);
        PortalProperties.Upstream upstream = new PortalProperties.Upstream(
                URI.create("https://localhost:" + DEV.value("BROKER_MOCK_PORT")), tlsName,
                Duration.ofSeconds(3), Duration.ofSeconds(5));
        return new BrokerClient(new UpstreamCalls("credential broker", UpstreamHttp.restClient("broker", upstream, tls, new DevMode(true))));
    }

    @Test
    void acceptsTheBrokerUnderItsConfiguredName() {
        assertThat(broker(DEV.value("MCP_BROKER_TLS_NAME"), DEV.certs().resolve("mcp-portal-bff/keystore.p12")).listSystems(TOKEN, REQUEST_ID)).isNotEmpty();
    }

    @Test
    void rejectsAServerCertificateWithoutTheConfiguredName() {
        assertThatThrownBy(() -> broker("mcp-jira.internal", DEV.certs().resolve("mcp-portal-bff/keystore.p12")).listSystems(TOKEN, REQUEST_ID))
                .isInstanceOf(UpstreamException.class)
                .hasMessageContaining("unreachable");
    }

    @Test
    void stubRefusesAClientCertificateOfAnotherCa() {
        assertThatThrownBy(() -> broker(DEV.value("MCP_BROKER_TLS_NAME"),
                DEV.certs().resolve("untrusted/mcp-gateway/keystore.p12")).listSystems(TOKEN, REQUEST_ID))
                .isInstanceOf(UpstreamException.class);
    }
}
