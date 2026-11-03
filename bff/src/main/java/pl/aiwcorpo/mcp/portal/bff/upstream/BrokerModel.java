package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

/** C4 shapes used by the BFF ({@code credential-broker.v1.yaml}). Timestamps stay strings and pass through as is. */
public final class BrokerModel {

    private BrokerModel() {
    }

    /** {@code Connection}; all fields always present, {@code expiresAt}/{@code lastUsedAt} may be null (CC-013). */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Connection(
            String system,
            String type,
            String status,
            String backendUser,
            String expiresAt,
            String connectedAt,
            String lastUsedAt) {
    }

    public record SystemInfo(
            String system,
            List<String> supportedTypes,
            String defaultType,
            List<String> oauthScopes,
            String userSecretScheme,
            String deployment) {

        public SystemInfo(String system, List<String> supportedTypes, String defaultType, List<String> oauthScopes) {
            this(system, supportedTypes, defaultType, oauthScopes, null, null);
        }
    }

    /** {@code PutSecretRequest}. The secret is only ever passed through; it is not logged or printed. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PutSecretRequest(String secret, String username, String expiresAt) {

        /** Neither the secret nor the login is ever printed (CC-222). */
        @Override
        public String toString() {
            return "PutSecretRequest[secret=<redacted>, username=<redacted>, expiresAt=" + expiresAt + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record PutSecretResponse(String status, String backendUser, String expiresAt) {
    }

    public record OAuthStartRequest(String returnPath) {
    }

    public record OAuthStartResponse(String authorizeUrl, String flowId) {

        @Override
        public String toString() {
            return "OAuthStartResponse[flowId=" + flowId + "]";
        }
    }

    /** {@code OAuthCompleteRequest}; {@code code} is a one-time grant and stays out of logs. */
    public record OAuthCompleteRequest(String flowId, String code, String state) {

        @Override
        public String toString() {
            return "OAuthCompleteRequest[flowId=" + flowId + ", code=<redacted>, state=<redacted>]";
        }
    }

    public record OAuthCompleteResponse(String status, String backendUser) {
    }

    /** {@code AuthenticatorStatus}; timestamps and the disabled reason pass through after {@link BrokerData} checked them. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record AuthenticatorStatus(
            String state,
            String registeredAt,
            String lastUsedAt,
            String lockedUntil,
            String disabledAt,
            String disabledReason) {
    }

    /** {@code AuthenticatorEnrollment}: the only C4 answer with the TOTP seed. Never printed, logged or stored. */
    public record AuthenticatorEnrollment(String enrollmentId, String otpauthUri, String secret, String expiresAt) {

        @Override
        public String toString() {
            return "AuthenticatorEnrollment[enrollmentId=" + enrollmentId + ", otpauthUri=<redacted>, secret=<redacted>]";
        }
    }

    /** {@code AuthenticatorEnrollmentConfirm}; the first code of a new seed is not logged either. */
    public record AuthenticatorEnrollmentConfirm(String enrollmentId, String code) {

        @Override
        public String toString() {
            return "AuthenticatorEnrollmentConfirm[enrollmentId=" + enrollmentId + ", code=<redacted>]";
        }
    }
}
