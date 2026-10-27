package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.util.List;

/** C5 shapes used by the BFF ({@code gateway-admin.v1.yaml}). */
public final class GatewayModel {

    private GatewayModel() {
    }

    public record Catalog(List<CatalogServer> servers) {
    }

    public record CatalogServer(String serverId, String system, String version, List<CatalogTool> tools) {
    }

    public record CatalogTool(
            String name,
            String description,
            String risk,
            String action,
            String access,
            List<String> requiredEntitlements) {
    }
}
