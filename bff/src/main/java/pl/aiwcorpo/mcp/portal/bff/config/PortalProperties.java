package pl.aiwcorpo.mcp.portal.bff.config;

import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.core.io.Resource;

@ConfigurationProperties("portal")
public record PortalProperties(
        @DefaultValue("keycloak") String registrationId,
        @DefaultValue("mcp-portal-bff") String componentId,
        Upstream broker,
        Upstream gatewayAdmin,
        @DefaultValue Tls tls,
        Gateway gateway,
        @DefaultValue TokenExchange tokenExchange,
        @DefaultValue StepUp stepUp,
        @DefaultValue Session session,
        @DefaultValue Web web,
        @DefaultValue Iga iga) {

    /**
     * @param tlsName name that must appear as DNS SAN in the server certificate, independent of the host in
     *                {@code baseUrl} (CC-035); empty means ordinary host name verification
     */
    public record Upstream(
            URI baseUrl,
            String tlsName,
            @DefaultValue("5s") Duration connectTimeout,
            @DefaultValue("10s") Duration readTimeout) {
    }

    /** Client certificate and trust anchors for C4 and C5. No keystore means no client certificate. */
    public record Tls(
            Path keystore,
            String keystorePassword,
            Path truststore,
            String truststorePassword) {

        @Override
        public String toString() {
            return "Tls[keystore=" + keystore + ", truststore=" + truststore + "]";
        }
    }

    /** @param publicUrl base URL of the gateway as MCP clients see it; catalog links are {publicUrl}/s/{serverId}/mcp */
    public record Gateway(URI publicUrl) {
    }

    public record TokenExchange(
            @DefaultValue("mcp-credential-broker") String brokerAudience,
            @DefaultValue("mcp-credential-broker-audience") String brokerScope,
            @DefaultValue("mcp-gateway-admin") String gatewayAdminAudience,
            @DefaultValue("mcp-gateway-admin-audience") String gatewayAdminScope,
            @DefaultValue("30s") Duration expirySkew) {
    }

    /**
     * @param maxAge    how old the last interactive authentication may be for operations that need fresh MFA
     * @param acrValues acr values that count as MFA; empty means any acr (only {@code auth_time} is checked)
     */
    public record StepUp(
            @DefaultValue("5m") Duration maxAge,
            @DefaultValue List<String> acrValues) {
    }

    /** Idle timeout is server.servlet.session.timeout; this is the hard limit from login. */
    public record Session(@DefaultValue("8h") Duration absoluteTimeout) {
    }

    /**
     * @param distPath         directory with the built frontend (the one that contains index.html)
     * @param cspNonceToken    text in index.html replaced with the per-response CSP nonce
     */
    public record Web(
            @DefaultValue("../web/dist/portal") Path distPath,
            @DefaultValue("__CSP_NONCE__") String cspNonceToken) {
    }

    public record Iga(
            @DefaultValue("mock") String adapter,
            @DefaultValue("classpath:iga/mock-iga.yaml") Resource mockFile) {
    }
}
