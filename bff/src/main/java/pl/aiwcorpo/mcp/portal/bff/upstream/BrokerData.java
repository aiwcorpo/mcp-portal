package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Checks C4 and C5 data against the contract enums before it reaches the browser or the catalog rules. Unknown
 * systems, types, risks and actions are dropped (fail-closed) instead of being passed on and breaking C12.
 */
public final class BrokerData {

    static final Set<String> CREDENTIAL_TYPES = Set.of("user-oauth", "user-secret", "token-exchange", "service-account");
    static final Set<String> CONNECTION_STATUSES = Set.of("connected", "expiring", "expired", "revoked", "error",
            "needs_reconnect");
    static final Set<String> SCHEMES = Set.of("Bearer", "Basic");
    static final Set<String> DEPLOYMENTS = Set.of("dc", "cloud");
    static final Set<String> RISKS = Set.of("READ_ONLY", "UPDATE", "DESTRUCTIVE");
    static final Set<String> DISABLED_BY = Set.of("kill_switch", "approval", "configuration");
    static final Set<String> TOOL_ACTIONS = Set.of("read", "update", "delete", "admin");

    private static final Logger log = LoggerFactory.getLogger(BrokerData.class);

    private BrokerData() {
    }

    /** Connections with known system and type; an unknown status becomes {@code error} (reconnect needed). */
    public static List<BrokerModel.Connection> validConnections(List<BrokerModel.Connection> connections) {
        List<BrokerModel.Connection> result = new ArrayList<>();
        for (BrokerModel.Connection c : connections == null ? List.<BrokerModel.Connection>of() : connections) {
            if (c == null || !ContractValues.isSystemId(c.system()) || !CREDENTIAL_TYPES.contains(c.type())
                    || c.backendUser() == null || c.connectedAt() == null) {
                log.warn("Dropping a C4 connection outside the contract");
                continue;
            }
            String status = CONNECTION_STATUSES.contains(c.status()) ? c.status() : "error";
            result.add(new BrokerModel.Connection(c.system(), c.type(), status, c.backendUser(), c.expiresAt(),
                    c.connectedAt(), c.lastUsedAt()));
        }
        return result;
    }

    public static List<BrokerModel.SystemInfo> validSystems(List<BrokerModel.SystemInfo> systems) {
        List<BrokerModel.SystemInfo> result = new ArrayList<>();
        for (BrokerModel.SystemInfo s : systems == null ? List.<BrokerModel.SystemInfo>of() : systems) {
            if (s == null || !ContractValues.isSystemId(s.system())) {
                continue;
            }
            List<String> supported = s.supportedTypes() == null ? List.of()
                    : s.supportedTypes().stream().filter(CREDENTIAL_TYPES::contains).toList();
            // Without a valid defaultType among the supported types the catalog would break its schema, so the
            // system is treated like one the broker does not know: no credential, no connect actions.
            if (!supported.isEmpty() && !supported.contains(s.defaultType())) {
                log.warn("Dropping a C4 system with defaultType outside its supportedTypes");
                continue;
            }
            result.add(new BrokerModel.SystemInfo(s.system(), supported, s.defaultType(),
                    s.oauthScopes() == null ? List.of() : s.oauthScopes(),
                    s.userSecretScheme() != null && SCHEMES.contains(s.userSecretScheme()) ? s.userSecretScheme() : null,
                    s.deployment() != null && DEPLOYMENTS.contains(s.deployment()) ? s.deployment() : null,
                    // The label is optional in C4 and the catalog of C12 has no field for it, so a bad one is simply dropped.
                    ContractValues.isDisplayName(s.displayName()) ? s.displayName() : null));
        }
        return result;
    }

    /** Servers of known systems and tools with known risk and action; {@code access} other than granted is denied. */
    public static GatewayModel.Catalog validCatalog(GatewayModel.Catalog catalog) {
        List<GatewayModel.CatalogServer> servers = new ArrayList<>();
        if (catalog != null && catalog.servers() != null) {
            for (GatewayModel.CatalogServer server : catalog.servers()) {
                if (server == null || !ContractValues.isSystemId(server.system()) || !ContractValues.isServerId(server.serverId())
                        || !("mcp-" + server.system()).equals(server.serverId())
                        || server.version() == null) {
                    log.warn("Dropping a C5 catalog server outside the contract");
                    continue;
                }
                servers.add(new GatewayModel.CatalogServer(server.serverId(), server.system(), server.version(),
                        validTools(server.tools())));
            }
        }
        return new GatewayModel.Catalog(servers);
    }

    private static List<GatewayModel.CatalogTool> validTools(List<GatewayModel.CatalogTool> tools) {
        List<GatewayModel.CatalogTool> result = new ArrayList<>();
        for (GatewayModel.CatalogTool tool : tools == null ? List.<GatewayModel.CatalogTool>of() : tools) {
            if (tool == null || tool.name() == null || !ContractValues.QUALIFIED_TOOL.matcher(tool.name()).matches() || !RISKS.contains(tool.risk()) || !TOOL_ACTIONS.contains(tool.action())) {
                log.warn("Dropping a C5 catalog tool outside the contract");
                continue;
            }
            result.add(new GatewayModel.CatalogTool(tool.name(), tool.description() == null ? "" : tool.description(),
                    tool.risk(), tool.action(), "granted".equals(tool.access()) ? "granted" : "denied",
                    tool.requiredEntitlements() == null ? List.of() : tool.requiredEntitlements(),
                    tool.title() == null || tool.title().isEmpty() ? null : tool.title(),
                    Boolean.TRUE.equals(tool.disabled()) ? Boolean.TRUE : null,
                    // Present only for a disabled tool (CC-194); a value outside the enum is left out, not guessed.
                    Boolean.TRUE.equals(tool.disabled()) && tool.disabledBy() != null && DISABLED_BY.contains(tool.disabledBy())
                            ? tool.disabledBy() : null,
                    // The gateway computes this flag; a DESTRUCTIVE tool is never shown without it.
                    Boolean.TRUE.equals(tool.requiresConfirmation()) || "DESTRUCTIVE".equals(tool.risk())
                            ? Boolean.TRUE : null));
        }
        return result;
    }

    private static final Set<String> AUTHENTICATOR_STATES = Set.of("none", "active", "disabled");

    /**
     * Status of the registration as C12 may show it, or null when the broker's answer breaks the schema (state
     * outside the enum, bad timestamp, {@code disabled} without its reason, a reason without {@code disabled}).
     */
    public static BrokerModel.AuthenticatorStatus validAuthenticatorStatus(BrokerModel.AuthenticatorStatus status) {
        if (status == null || !AUTHENTICATOR_STATES.contains(status.state())) {
            return null;
        }
        for (String time : Arrays.asList(status.registeredAt(), status.lastUsedAt(), status.lockedUntil(),
                status.disabledAt())) {
            if (time != null && !ContractValues.isTimestamp(time)) {
                return null;
            }
        }
        boolean disabled = "disabled".equals(status.state());
        if (disabled != (status.disabledAt() != null) || disabled != (status.disabledReason() != null)
                || disabled && !"daily_failure_limit".equals(status.disabledReason())) {
            return null;
        }
        return status;
    }

    /** The answer of the registration start, or null when it does not fit {@code AuthenticatorEnrollment}. */
    public static BrokerModel.AuthenticatorEnrollment validEnrollment(BrokerModel.AuthenticatorEnrollment enrollment) {
        if (enrollment == null || enrollment.enrollmentId() == null
                || !ContractValues.ENROLLMENT_ID.matcher(enrollment.enrollmentId()).matches()
                || enrollment.secret() == null || !enrollment.secret().matches("^[A-Z2-7]{32}$")
                || enrollment.otpauthUri() == null || !enrollment.otpauthUri().startsWith("otpauth://totp/")
                || !ContractValues.isTimestamp(enrollment.expiresAt())) {
            return null;
        }
        return enrollment;
    }
}
