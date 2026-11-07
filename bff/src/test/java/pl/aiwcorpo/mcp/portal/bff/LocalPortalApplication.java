package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.options;

import java.util.Map;
import java.util.UUID;

import com.github.tomakehurst.wiremock.WireMockServer;

import org.springframework.boot.builder.SpringApplicationBuilder;

/**
 * The BFF on a developer's machine without the dev stack: the credential broker (C4) and the gateway admin (C5) are the WireMock
 * stubs from the mcp-contracts jar on 127.0.0.1:18721 and :18722, and a third stub on :18723 serves only the OIDC discovery
 * document, so the BFF starts without Keycloak. {@code /api/v1/me} answers 401 and logging in does not work; to log in, point
 * {@code PORTAL_OIDC_ISSUER_URI} and {@code PORTAL_OIDC_CLIENT_SECRET} at a real Keycloak in the run configuration.
 *
 * <p>Run it from the IDE (.run/LocalPortal.run.xml, working directory bff/) or with
 * {@code ./mvnw spring-boot:test-run -Dspring-boot.run.mainClass=pl.aiwcorpo.mcp.portal.bff.LocalPortalApplication}. The BFF listens on
 * http://localhost:18720 and serves the application built in ../web/dist/portal when there is one. The profile dev and plain http
 * to the stubs are the settings that the BFF refuses outside it.
 */
public final class LocalPortalApplication {

    static final int PORTAL_PORT = 18720;
    static final int BROKER_PORT = 18721;
    static final int GATEWAY_ADMIN_PORT = 18722;
    static final int IDP_DISCOVERY_PORT = 18723;

    private LocalPortalApplication() {
    }

    public static void main(String[] args) {
        WireMockServer broker = new WireMockServer(options().bindAddress("127.0.0.1").port(BROKER_PORT)
                .usingFilesUnderClasspath("mcp-contracts/mocks/wiremock/credential-broker"));
        WireMockServer gatewayAdmin = new WireMockServer(options().bindAddress("127.0.0.1").port(GATEWAY_ADMIN_PORT)
                .usingFilesUnderClasspath("mcp-contracts/mocks/wiremock/gateway-admin"));
        WireMockServer idpDiscovery = new WireMockServer(options().bindAddress("127.0.0.1").port(IDP_DISCOVERY_PORT)
                .usingFilesUnderDirectory("dev/idp-stub").globalTemplating(true));
        for (WireMockServer server : new WireMockServer[] {broker, gatewayAdmin, idpDiscovery}) {
            server.start();
        }
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            broker.stop();
            gatewayAdmin.stop();
            idpDiscovery.stop();
        }));

        Map<String, Object> defaults = Map.of(
                "PORTAL_PORT", PORTAL_PORT,
                "PORTAL_PUBLIC_BASE_URL", "http://localhost:" + PORTAL_PORT,
                "PORTAL_OIDC_ISSUER_URI", "http://127.0.0.1:" + IDP_DISCOVERY_PORT + "/realms/corp",
                "PORTAL_OIDC_CLIENT_SECRET", "local-" + UUID.randomUUID(),
                "PORTAL_BROKER_URL", broker.baseUrl(),
                "PORTAL_GATEWAY_ADMIN_URL", gatewayAdmin.baseUrl(),
                "portal.tls.insecure-plain-http-for-tests", "true");
        new SpringApplicationBuilder(PortalBffApplication.class)
                .profiles("dev")
                .properties(defaults)
                .run(args);
    }
}
