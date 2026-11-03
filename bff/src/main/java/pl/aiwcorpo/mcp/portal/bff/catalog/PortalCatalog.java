package pl.aiwcorpo.mcp.portal.bff.catalog;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerModel;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel;

/** C12 {@code PortalCatalog}. */
public record PortalCatalog(List<Server> servers) {

    /**
     * @param credential absent when the broker does not know the system; {@code connection} is always sent, null
     *                   when there is none or nothing to connect (service-account, token-exchange)
     */
    public record Server(
            String serverId,
            String system,
            String version,
            String url,
            String status,
            List<String> actions,
            @JsonInclude(JsonInclude.Include.NON_NULL) Credential credential,
            @JsonInclude(JsonInclude.Include.ALWAYS) BrokerModel.Connection connection,
            List<GatewayModel.CatalogTool> tools) {
    }

    /** {@code CatalogCredential}; {@code userSecretScheme} decides about the login field of the token form (CC-222). */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Credential(List<String> supportedTypes, String defaultType, String userSecretScheme,
                             String deployment) {
    }
}
