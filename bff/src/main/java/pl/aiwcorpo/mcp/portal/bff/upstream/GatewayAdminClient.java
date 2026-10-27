package pl.aiwcorpo.mcp.portal.bff.upstream;

import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;

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
}
