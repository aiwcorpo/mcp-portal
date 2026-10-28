package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Checks C4 and C5 data against the contract enums before it reaches the browser or the catalog rules. Unknown
 * systems, types, risks and actions are dropped (fail-closed) instead of being passed on and breaking C12.
 */
public final class BrokerData {

    public static final Set<String> SYSTEMS = Set.of("jira", "confluence", "gitlab", "servicedesk", "opensearch");

    static final Set<String> CREDENTIAL_TYPES = Set.of("user-oauth", "user-secret", "token-exchange", "service-account");
    static final Set<String> CONNECTION_STATUSES = Set.of("connected", "expiring", "expired", "revoked", "error");
    static final Set<String> RISKS = Set.of("READ_ONLY", "UPDATE", "DESTRUCTIVE");
    static final Set<String> TOOL_ACTIONS = Set.of("read", "update", "delete", "admin");

    private static final Logger log = LoggerFactory.getLogger(BrokerData.class);

    private BrokerData() {
    }

    /** Connections with known system and type; an unknown status becomes {@code error} (reconnect needed). */
    public static List<BrokerModel.Connection> validConnections(List<BrokerModel.Connection> connections) {
        List<BrokerModel.Connection> result = new ArrayList<>();
        for (BrokerModel.Connection c : connections == null ? List.<BrokerModel.Connection>of() : connections) {
            if (c == null || !SYSTEMS.contains(c.system()) || !CREDENTIAL_TYPES.contains(c.type())
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
            if (s == null || !SYSTEMS.contains(s.system())) {
                continue;
            }
            List<String> supported = s.supportedTypes() == null ? List.of()
                    : s.supportedTypes().stream().filter(CREDENTIAL_TYPES::contains).toList();
            result.add(new BrokerModel.SystemInfo(s.system(), supported, s.defaultType(),
                    s.oauthScopes() == null ? List.of() : s.oauthScopes()));
        }
        return result;
    }

    /** Servers of known systems and tools with known risk and action; {@code access} other than granted is denied. */
    public static GatewayModel.Catalog validCatalog(GatewayModel.Catalog catalog) {
        List<GatewayModel.CatalogServer> servers = new ArrayList<>();
        if (catalog != null && catalog.servers() != null) {
            for (GatewayModel.CatalogServer server : catalog.servers()) {
                if (server == null || !SYSTEMS.contains(server.system()) || server.serverId() == null
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
            if (tool == null || tool.name() == null || !RISKS.contains(tool.risk()) || !TOOL_ACTIONS.contains(tool.action())) {
                log.warn("Dropping a C5 catalog tool outside the contract");
                continue;
            }
            result.add(new GatewayModel.CatalogTool(tool.name(), tool.description() == null ? "" : tool.description(),
                    tool.risk(), tool.action(), "granted".equals(tool.access()) ? "granted" : "denied",
                    tool.requiredEntitlements() == null ? List.of() : tool.requiredEntitlements(),
                    tool.title() == null || tool.title().isEmpty() ? null : tool.title(),
                    Boolean.TRUE.equals(tool.disabled()) ? Boolean.TRUE : null,
                    // The gateway computes this flag; a DESTRUCTIVE tool is never shown without it.
                    Boolean.TRUE.equals(tool.requiresConfirmation()) || "DESTRUCTIVE".equals(tool.risk())
                            ? Boolean.TRUE : null));
        }
        return result;
    }
}
