package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.MediaType;

import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import tools.jackson.core.type.TypeReference;

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

    public List<GatewayModel.VirtualServer> virtualServers(BearerToken token, String requestId) {
        return calls.call(calls.authorize(calls.http().get().uri("/admin/v1/virtual-servers"), token, requestId),
                response -> calls.read(response, new TypeReference<List<GatewayModel.VirtualServer>>() { }));
    }

    public GatewayModel.VirtualServerCreated createVirtualServer(BearerToken token, String requestId,
                                                                 GatewayModel.VirtualServerCreate body) {
        return calls.call(calls.authorize(calls.http().post()
                                .uri("/admin/v1/virtual-servers")
                                .contentType(MediaType.APPLICATION_JSON)
                                .body(body), token, requestId),
                response -> calls.read(response, GatewayModel.VirtualServerCreated.class));
    }

    public void deleteVirtualServer(BearerToken token, String requestId, String slug) {
        calls.call(calls.authorize(calls.http().delete().uri("/admin/v1/virtual-servers/{slug}", slug), token, requestId),
                response -> null);
    }

    public GatewayModel.ConfirmationView confirmation(BearerToken token, String requestId, String confirmationId) {
        return calls.call(calls.authorize(calls.http().get().uri("/admin/v1/confirmations/{id}", confirmationId),
                        token, requestId),
                response -> calls.read(response, GatewayModel.ConfirmationView.class));
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
                        calls.read(response, new TypeReference<List<GatewayModel.ActivityCall>>() { }),
                        response.getHeaders().getFirst("X-Next-Cursor")));
    }
}
