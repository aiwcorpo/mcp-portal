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

    /** {@code ConfirmationView}: what the pending call really is, as the gateway recorded it. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ConfirmationView(
            String confirmationId,
            String tool,
            String system,
            Resource resource,
            List<ConfirmationArgument> arguments,
            String expiresAt) {
    }

    /** {@code resource} of C8: type, id and optional parent, the same value the audit event carries. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Resource(String type, String id, String parent) {
    }

    public record ConfirmationArgument(String name, String value, Boolean truncated) {
    }

    /** {@code ActivityCall}: one row per tool call; a {@code null errorCode} is the same as an absent one. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ActivityCall(
            String requestId,
            String ts,
            String client,
            String virtualServer,
            String tool,
            String risk,
            Resource resource,
            String result,
            Integer wrongCodeCount,
            String errorCode) {
    }

    /** One page of {@code activity/calls}; {@code nextCursor} is the gateway's {@code X-Next-Cursor}, untouched. */
    public record ActivityCallsPage(List<ActivityCall> calls, String nextCursor) {
    }
}
