package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.util.List;

import org.springframework.http.MediaType;

import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import tools.jackson.core.type.TypeReference;

/** C4 operations open to {@code CN=mcp-portal-bff}. Every call carries the user's token exchanged for the broker. */
public class BrokerClient {

    private final UpstreamCalls calls;

    BrokerClient(UpstreamCalls calls) {
        this.calls = calls;
    }

    public List<BrokerModel.Connection> listConnections(BearerToken token, String requestId) {
        return calls.call(calls.authorize(calls.http().get().uri("/v1/connections"), token, requestId),
                response -> calls.read(response, new TypeReference<List<BrokerModel.Connection>>() { }));
    }

    public List<BrokerModel.SystemInfo> listSystems(BearerToken token, String requestId) {
        return calls.call(calls.authorize(calls.http().get().uri("/v1/systems"), token, requestId),
                response -> calls.read(response, new TypeReference<List<BrokerModel.SystemInfo>>() { }));
    }

    public BrokerModel.PutSecretResponse putSecret(BearerToken token, String requestId, String system,
                                                   BrokerModel.PutSecretRequest body) {
        return calls.call(calls.authorize(calls.http().put()
                                .uri("/v1/connections/{system}/secret", system)
                                .contentType(MediaType.APPLICATION_JSON)
                                .body(body), token, requestId),
                response -> calls.read(response, BrokerModel.PutSecretResponse.class));
    }

    public void deleteConnection(BearerToken token, String requestId, String system) {
        calls.call(calls.authorize(calls.http().delete().uri("/v1/connections/{system}", system), token, requestId),
                response -> null);
    }
}
