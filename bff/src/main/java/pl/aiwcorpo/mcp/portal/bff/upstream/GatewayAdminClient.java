package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.MediaType;

import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;

/** C5 operations of the BFF. Every call carries the user's token exchanged for the gateway admin API. */
public class GatewayAdminClient {

    private final UpstreamCalls calls;

    GatewayAdminClient(UpstreamCalls calls) {
        this.calls = calls;
    }

    public GatewayModel.Catalog catalog(BearerToken token, String requestId) {
        return calls.call(calls.authorize(calls.http().get().uri("/admin/v1/catalog"), token, requestId),
                response -> calls.read(response, GatewayModel.Catalog.class));
    }

    public List<JsonNode> registry(BearerToken token, String requestId) {
        return calls.call(calls.authorize(calls.http().get().uri("/admin/v1/registry/servers"), token, requestId),
                response -> calls.read(response, new TypeReference<List<JsonNode>>() { }));
    }

    public JsonNode pendingTool(BearerToken token, String requestId, String serverId, String tool) {
        return calls.call(calls.authorize(calls.http().get()
                        .uri("/admin/v1/registry/servers/{serverId}/tools/{tool}/pending", serverId, tool), token, requestId),
                response -> calls.read(response, JsonNode.class));
    }

    public void approveTool(BearerToken token, String requestId, String serverId, String tool,
                            GatewayModel.ApproveRequest approval) {
        calls.call(calls.authorize(calls.http().post()
                        .uri("/admin/v1/registry/servers/{serverId}/tools/{tool}/approve", serverId, tool)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(approval), token, requestId),
                response -> null);
    }

    public JsonNode killSwitches(BearerToken token, String requestId) {
        return calls.call(calls.authorize(calls.http().get().uri("/admin/v1/kill-switches"), token, requestId),
                response -> calls.read(response, JsonNode.class));
    }

    public void switchOffServer(BearerToken token, String requestId, String serverId, String reason) {
        calls.call(calls.authorize(calls.http().put().uri("/admin/v1/registry/servers/{serverId}/kill-switch", serverId)
                .contentType(MediaType.APPLICATION_JSON).body(new GatewayModel.KillSwitchRequest(reason)), token, requestId),
                response -> null);
    }

    public void switchOnServer(BearerToken token, String requestId, String serverId) {
        calls.call(calls.authorize(calls.http().delete().uri("/admin/v1/registry/servers/{serverId}/kill-switch", serverId),
                token, requestId), response -> null);
    }

    public void switchOffTool(BearerToken token, String requestId, String serverId, String tool, String reason) {
        calls.call(calls.authorize(calls.http().put()
                .uri("/admin/v1/registry/servers/{serverId}/tools/{tool}/kill-switch", serverId, tool)
                .contentType(MediaType.APPLICATION_JSON).body(new GatewayModel.KillSwitchRequest(reason)), token, requestId),
                response -> null);
    }

    public void switchOnTool(BearerToken token, String requestId, String serverId, String tool) {
        calls.call(calls.authorize(calls.http().delete()
                .uri("/admin/v1/registry/servers/{serverId}/tools/{tool}/kill-switch", serverId, tool), token, requestId),
                response -> null);
    }

    public JsonNode confirmation(BearerToken token, String requestId, String confirmationId) {
        return calls.call(calls.authorize(calls.http().get().uri("/admin/v1/confirmations/{id}", confirmationId),
                        token, requestId),
                response -> calls.read(response, JsonNode.class));
    }

    public void markConfirmationViewed(BearerToken token, String requestId, String confirmationId) {
        calls.call(calls.authorize(calls.http().post().uri("/admin/v1/confirmations/{id}/viewed", confirmationId),
                token, requestId), response -> null);
    }

    public void cancelConfirmation(BearerToken token, String requestId, String confirmationId) {
        calls.call(calls.authorize(calls.http().post().uri("/admin/v1/confirmations/{id}/cancel", confirmationId),
                token, requestId), response -> null);
    }

    /** {@code query} holds only the already validated filters; the cursor goes through exactly as received. */
    public GatewayModel.ActivityCallsPage activityCalls(BearerToken token, String requestId, Map<String, String> query) {
        Map<String, String> variables = new LinkedHashMap<>(query);
        return calls.call(calls.authorize(calls.http().get().uri(builder -> {
                    builder.path("/admin/v1/activity/calls");
                    variables.keySet().forEach(name -> builder.queryParam(name, "{" + name + "}"));
                    return builder.build(variables);
                }), token, requestId),
                response -> new GatewayModel.ActivityCallsPage(
                        calls.read(response, new TypeReference<List<JsonNode>>() { }),
                        response.getHeaders().getFirst("X-Next-Cursor")));
    }
}
