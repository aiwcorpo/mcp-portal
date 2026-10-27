package pl.aiwcorpo.mcp.portal.bff.catalog;

import java.net.URI;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import pl.aiwcorpo.mcp.portal.bff.iga.AccessGovernance.AccessRequest;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerModel.Connection;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerModel.SystemInfo;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel.Catalog;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel.CatalogServer;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel.CatalogTool;

/**
 * Status and actions per server (C12, CC-021) from C5 catalog, C4 connections and systems, and C13 requests.
 *
 * <p>Status, first matching rule wins: no granted tool and a pending request for one of the server's entitlements
 * {@code request_pending}; no granted tool {@code no_access}; default credential type {@code service-account} or
 * {@code token-exchange} {@code connected}; C4 {@code connected}/{@code expiring} as is,
 * {@code expired}/{@code revoked}/{@code error} (and anything unknown) {@code reconnect_required}; no connection
 * {@code not_connected}.
 *
 * <p>Actions, in enum order: {@code copy_link} when the link works (connected, expiring); {@code connect_oauth} and
 * {@code add_secret} when not connected and the broker supports that type for the system; {@code reconnect} when
 * reconnect_required or expiring; {@code request_access} when a denied tool names an entitlement without a pending
 * request; {@code view_request} when such a request is pending; {@code disconnect} when the broker has a connection.
 */
public final class CatalogAssembler {

    static final String CONNECTED = "connected";
    static final String EXPIRING = "expiring";
    static final String RECONNECT_REQUIRED = "reconnect_required";
    static final String NOT_CONNECTED = "not_connected";
    static final String REQUEST_PENDING = "request_pending";
    static final String NO_ACCESS = "no_access";

    private static final Set<String> NOTHING_TO_CONNECT = Set.of("service-account", "token-exchange");

    private final URI gatewayPublicUrl;

    public CatalogAssembler(URI gatewayPublicUrl) {
        this.gatewayPublicUrl = gatewayPublicUrl;
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

    private PortalCatalog.Server server(CatalogServer server, Connection connection, SystemInfo system,
                                        Set<String> pendingEntitlements) {
        boolean granted = false;
        boolean pending = false;
        boolean requestable = false;
        List<CatalogTool> tools = server.tools() == null ? List.of() : server.tools();
        for (CatalogTool tool : tools) {
            boolean toolGranted = "granted".equals(tool.access());
            boolean toolPending = entitlements(tool).stream().anyMatch(pendingEntitlements::contains);
            granted |= toolGranted;
            pending |= toolPending;
            // Any one of requiredEntitlements grants the tool, so one pending request covers it.
            requestable |= !toolGranted && !toolPending && !entitlements(tool).isEmpty();
        }
        String status = status(granted, pending, connection, system);

        List<String> actions = new ArrayList<>();
        if (CONNECTED.equals(status) || EXPIRING.equals(status)) {
            actions.add("copy_link");
        }
        if (NOT_CONNECTED.equals(status) && supports(system, "user-oauth")) {
            actions.add("connect_oauth");
        }
        if (NOT_CONNECTED.equals(status) && supports(system, "user-secret")) {
            actions.add("add_secret");
        }
        if (RECONNECT_REQUIRED.equals(status) || EXPIRING.equals(status)) {
            actions.add("reconnect");
        }
        if (requestable) {
            actions.add("request_access");
        }
        if (pending) {
            actions.add("view_request");
        }
        if (connection != null) {
            actions.add("disconnect");
        }
        return new PortalCatalog.Server(server.serverId(), server.system(), server.version(),
                link(server.serverId()), status, List.copyOf(actions), tools);
    }

    private static String status(boolean granted, boolean pending, Connection connection, SystemInfo system) {
        if (!granted) {
            return pending ? REQUEST_PENDING : NO_ACCESS;
        }
        if (system != null && NOTHING_TO_CONNECT.contains(system.defaultType())) {
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

    private String link(String serverId) {
        String base = gatewayPublicUrl.toString();
        return (base.endsWith("/") ? base.substring(0, base.length() - 1) : base) + "/s/" + serverId + "/mcp";
    }
}
