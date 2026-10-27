package pl.aiwcorpo.mcp.portal.bff.catalog;

import java.util.List;

import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel;

/** C12 {@code PortalCatalog}. */
public record PortalCatalog(List<Server> servers) {

    public record Server(
            String serverId,
            String system,
            String version,
            String url,
            String status,
            List<String> actions,
            List<GatewayModel.CatalogTool> tools) {
    }
}
