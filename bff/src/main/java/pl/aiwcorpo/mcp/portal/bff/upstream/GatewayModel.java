package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

/** C5 shapes used by the BFF ({@code gateway-admin.v1.yaml}). */
public final class GatewayModel {

    private GatewayModel() {
    }

    public record Catalog(List<CatalogServer> servers) {
    }

    public record CatalogServer(String serverId, String system, String version, List<CatalogTool> tools) {
    }

    /**
     * {@code CatalogTool}. {@code disabled} and {@code requiresConfirmation} default to false in the contract, so
     * the BFF sends them only when true ({@code null} otherwise); {@code title} is absent when the tool has none.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CatalogTool(
            String name,
            String description,
            String risk,
            String action,
            String access,
            List<String> requiredEntitlements,
            String title,
            Boolean disabled,
            Boolean requiresConfirmation) {
    }

    /** {@code VirtualServer} from C5; {@code url} is ignored, the BFF builds links from its own public base URL. */
    public record VirtualServer(String slug, String displayName, List<String> tools) {
    }

    /** {@code VirtualServerCreate}; {@code resourceDefaults} is dormant (CC-085) and never sent. */
    public record VirtualServerCreate(String slug, String displayName, List<String> tools) {
    }

    public record VirtualServerCreated(String slug, String url) {
    }
}
