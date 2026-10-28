package pl.aiwcorpo.mcp.portal.bff.config;

import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("portal")
public record PortalProperties(
        @DefaultValue("keycloak") String registrationId,
        @DefaultValue("mcp-portal-bff") String componentId,
        Upstream broker,
        Upstream gatewayAdmin,
        @DefaultValue Tls tls,
        URI publicBaseUrl,
        @DefaultValue TokenExchange tokenExchange,
        @DefaultValue StepUp stepUp,
        @DefaultValue Session session,
        @DefaultValue Web web,
        @DefaultValue Iga iga,
        @DefaultValue ClientConfigs clientConfigs) {

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

    /**
     * Client certificate and trust anchors for C4 and C5, both required.
     *
     * @param insecurePlainHttpForTests allows http:// upstreams without mTLS; only with the dev profile, for tests
     *                                  against plain WireMock stubs
     */
    public record Tls(
            Path keystore,
            String keystorePassword,
            Path truststore,
            String truststorePassword,
            @DefaultValue("false") boolean insecurePlainHttpForTests) {

        @Override
        public String toString() {
            return "Tls[keystore=" + keystore + ", truststore=" + truststore + "]";
        }
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
     * @param loginReturnOrigin dev only: origin of a separately served frontend (ng serve on :4200) that the
     *                          browser returns to after login; never taken from the request
     */
    public record Web(
            // String, not Path: Spring's String-to-Path conversion goes through Resource and rejects "../".
            @DefaultValue("../web/dist/portal") String distPath,
            @DefaultValue("__CSP_NONCE__") String cspNonceToken,
            URI loginReturnOrigin) {
    }

    /**
     * @param adapter          C13 adapter; none configured is a start-up error ({@code mock} only in dev)
     * @param mockFile         file system path of the mock data; a plain path, because the environment variable
     *                         PORTAL_IGA_MOCK_FILE binds to this property directly (relaxed binding)
     * @param requesterIdClaim identity claim the adapter uses to identify the requester
     */
    public record Iga(
            String adapter,
            String mockFile,
            @DefaultValue("preferred_username") String requesterIdClaim) {
    }

    /** Extra settings that go into the ready-to-paste client commands (C12 {@code clientConfigs}). */
    public record ClientConfigs(@DefaultValue ClaudeCode claudeCode) {
    }

    /**
     * Claude Code cannot register an OAuth client dynamically against an IdP that forbids it (Keycloak in dev), so
     * the command then needs {@code --client-id} and {@code --callback-port}. Both optional and independent: with
     * Entra ID in production a pre-registered client may be different or not needed at all.
     *
     * @param clientId     public client registered at the IdP for Claude Code; empty means no {@code --client-id}
     * @param callbackPort fixed local port of the OAuth redirect (1024-65535); null means no {@code --callback-port}
     */
    public record ClaudeCode(String clientId, Integer callbackPort) {

        public ClaudeCode {
            clientId = clientId == null || clientId.isBlank() ? null : clientId.strip();
            if (clientId != null && !clientId.matches("[A-Za-z0-9._-]{1,128}")) {
                throw new IllegalArgumentException(
                        "portal.client-configs.claude-code.client-id may only contain letters, digits, '.', '_' and '-'");
            }
            if (callbackPort != null && (callbackPort < 1024 || callbackPort > 65535)) {
                throw new IllegalArgumentException(
                        "portal.client-configs.claude-code.callback-port must be between 1024 and 65535");
            }
        }
    }
}
