package pl.aiwcorpo.mcp.portal.bff.catalog;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import pl.aiwcorpo.mcp.portal.bff.config.PublicUrls;
import pl.aiwcorpo.mcp.portal.bff.iga.AccessGovernance.AccessRequest;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerModel.Connection;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerModel.SystemInfo;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel.Catalog;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel.CatalogServer;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel.CatalogTool;

/**
 * Status and actions per server (C12, CC-021, CC-083) from C5 catalog, C4 connections and systems, and C13 requests.
 *
 * <p>Status, first matching rule wins: no granted tool and a pending request for one of the server's entitlements
 * {@code request_pending}; no granted tool {@code no_access}; default credential type {@code service-account} or
 * {@code token-exchange} {@code connected}; C4 {@code connected}/{@code expiring} as is,
 * {@code expired}/{@code revoked}/{@code error} (and anything unknown) {@code reconnect_required}; no connection
 * {@code not_connected}.
 *
 * <p>Actions follow the table of {@code getPortalCatalog} (CC-083, CC-113; vectors {@code test-vectors/catalog-actions/}). The type
 * of the existing connection decides for {@code expiring} and {@code reconnect_required}; the credential types the
 * broker supports for {@code not_connected}. Order is stable (enum order of the contract); the contract treats the
 * list as a set.
 */
public final class CatalogAssembler {

    static final String CONNECTED = "connected";
    static final String EXPIRING = "expiring";
    static final String RECONNECT_REQUIRED = "reconnect_required";
    static final String NOT_CONNECTED = "not_connected";
    static final String REQUEST_PENDING = "request_pending";
    static final String NO_ACCESS = "no_access";

    private static final String USER_OAUTH = "user-oauth";
    private static final String USER_SECRET = "user-secret";
    private static final Set<String> NOTHING_TO_CONNECT = Set.of("service-account", "token-exchange");

    private final PublicUrls publicUrls;

    public CatalogAssembler(PublicUrls publicUrls) {
        this.publicUrls = publicUrls;
    }

    public PortalCatalog assemble(Catalog catalog, List<Connection> connections, List<SystemInfo> systems,
                                  List<AccessRequest> requests) {
        Map<String, Connection> connectionBySystem = new HashMap<>();
        for (Connection connection : connections) {
            connectionBySystem.put(connection.system(), connection);
        }
        Map<String, SystemInfo> systemById = new HashMap<>();
        for (SystemInfo system : systems) {
            systemById.put(system.system(), system);
        }
        Set<String> pendingEntitlements = new HashSet<>();
        for (AccessRequest request : requests) {
            if (request.pending()) {
                pendingEntitlements.add(request.entitlement());
            }
        }
        List<PortalCatalog.Server> servers = new ArrayList<>();
        for (CatalogServer server : catalog.servers() == null ? List.<CatalogServer>of() : catalog.servers()) {
            servers.add(server(server, connectionBySystem.get(server.system()), systemById.get(server.system()),
                    pendingEntitlements));
        }
        return new PortalCatalog(servers);
    }

    private PortalCatalog.Server server(CatalogServer server, Connection existing, SystemInfo system,
                                        Set<String> pendingEntitlements) {
        boolean granted = false;
        boolean pending = false;
        boolean someDenied = false;
        boolean entitlementsKnown = false;
        List<CatalogTool> tools = server.tools() == null ? List.of() : server.tools();
        for (CatalogTool tool : tools) {
            boolean toolGranted = "granted".equals(tool.access());
            granted |= toolGranted;
            someDenied |= !toolGranted;
            entitlementsKnown |= !toolGranted && !entitlements(tool).isEmpty();
            // Any one of requiredEntitlements grants the tool, so one pending request covers it.
            pending |= !toolGranted && entitlements(tool).stream().anyMatch(pendingEntitlements::contains);
        }
        boolean nothingToConnect = system != null && NOTHING_TO_CONNECT.contains(system.defaultType());
        // A service account or token exchange has no connection of its own to show or remove (CC-080).
        Connection connection = nothingToConnect ? null : existing;
        String status = status(granted, pending, nothingToConnect, connection);

        List<String> actions = new ArrayList<>();
        if (CONNECTED.equals(status) || EXPIRING.equals(status)) {
            actions.add("copy_link");
        }
        if (NOT_CONNECTED.equals(status)) {
            if (supports(system, USER_OAUTH)) {
                actions.add("connect_oauth");
            }
            if (supports(system, USER_SECRET)) {
                actions.add("add_secret");
            }
        }
        if (EXPIRING.equals(status) || RECONNECT_REQUIRED.equals(status)) {
            String type = connection.type();
            if (USER_OAUTH.equals(type)) {
                actions.add("reconnect");
            } else if (USER_SECRET.equals(type)) {
                actions.add("add_secret");
            }
        }
        // CC-113: nothing to ask for without a named entitlement; a pending request for what a denied tool needs is
        // shown instead of a new request, also for a connected server.
        if (REQUEST_PENDING.equals(status) || CONNECTED.equals(status) && someDenied && pending) {
            actions.add("view_request");
        } else if ((NO_ACCESS.equals(status) || CONNECTED.equals(status) && someDenied) && entitlementsKnown) {
            actions.add("request_access");
        }
        if (connection != null && (CONNECTED.equals(status) || EXPIRING.equals(status)
                || RECONNECT_REQUIRED.equals(status))) {
            actions.add("disconnect");
        }
        PortalCatalog.Credential credential = system == null || system.supportedTypes().isEmpty() ? null
                : new PortalCatalog.Credential(system.supportedTypes(), system.defaultType(),
                        system.userSecretScheme(), system.deployment());
        return new PortalCatalog.Server(server.serverId(), server.system(), server.version(),
                publicUrls.server(server.serverId()), status, List.copyOf(actions), credential, connection, tools);
    }

    private static String status(boolean granted, boolean pending, boolean nothingToConnect, Connection connection) {
        if (!granted) {
            return pending ? REQUEST_PENDING : NO_ACCESS;
        }
        if (nothingToConnect) {
            return CONNECTED;
        }
        if (connection == null) {
            return NOT_CONNECTED;
        }
        return switch (connection.status()) {
            case "connected" -> CONNECTED;
            case "expiring" -> EXPIRING;
            default -> RECONNECT_REQUIRED;
        };
    }

    private static boolean supports(SystemInfo system, String type) {
        return system != null && system.supportedTypes() != null && system.supportedTypes().contains(type);
    }

    private static List<String> entitlements(CatalogTool tool) {
        return tool.requiredEntitlements() == null ? List.of() : tool.requiredEntitlements();
    }
}
