package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.util.List;

import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;

import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;

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

    public BrokerModel.OAuthStartResponse startOAuth(BearerToken token, String requestId, String system,
                                                     BrokerModel.OAuthStartRequest body) {
        return calls.call(calls.authorize(calls.http().post()
                                .uri("/v1/connections/{system}/oauth/start", system)
                                .contentType(MediaType.APPLICATION_JSON)
                                .body(body), token, requestId),
                response -> calls.read(response, BrokerModel.OAuthStartResponse.class));
    }

    public BrokerModel.OAuthCompleteResponse completeOAuth(BearerToken token, String requestId, String system,
                                                           BrokerModel.OAuthCompleteRequest body) {
        return calls.call(calls.authorize(calls.http().post()
                                .uri("/v1/connections/{system}/oauth/complete", system)
                                .contentType(MediaType.APPLICATION_JSON)
                                .body(body), token, requestId),
                response -> calls.read(response, BrokerModel.OAuthCompleteResponse.class));
    }

    public BrokerModel.AuthenticatorStatus authenticatorStatus(BearerToken token, String requestId) {
        return calls.call(calls.authorize(calls.http().get().uri("/v1/authenticator"), token, requestId),
                response -> calls.read(response, BrokerModel.AuthenticatorStatus.class));
    }

    public void deleteAuthenticator(BearerToken token, String requestId) {
        calls.call(calls.authorize(calls.http().delete().uri("/v1/authenticator"), token, requestId), response -> null);
    }

    /** The answer carries the seed: the caller hands it to the browser and keeps nothing but {@code enrollmentId}. */
    public BrokerModel.AuthenticatorEnrollment startAuthenticatorEnrollment(BearerToken token, String requestId) {
        return calls.call(calls.authorize(calls.http().post().uri("/v1/authenticator/enrollment"), token, requestId),
                response -> calls.read(response, BrokerModel.AuthenticatorEnrollment.class));
    }

    public BrokerModel.AuthenticatorStatus confirmAuthenticatorEnrollment(BearerToken token, String requestId,
                                                                          BrokerModel.AuthenticatorEnrollmentConfirm body) {
        return calls.call(calls.authorize(calls.http().post()
                                .uri("/v1/authenticator/enrollment/confirm")
                                .contentType(MediaType.APPLICATION_JSON)
                                .body(body), token, requestId),
                response -> calls.read(response, BrokerModel.AuthenticatorStatus.class));
    }

    /** The system administration of C4 ({@code /v1/admin/systems}); the body may carry a client secret and is never printed. */
    public AdminReply admin(HttpMethod method, String uri, Object[] variables, BearerToken token, String requestId,
                            AdminPreconditions preconditions, JsonNode body) {
        return calls.admin(method, uri, variables, token, requestId, preconditions, body);
    }
}
