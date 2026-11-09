package pl.aiwcorpo.mcp.portal.bff.catalog;

import java.util.List;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.config.PublicUrls;
import pl.aiwcorpo.mcp.portal.bff.config.DevMode;
import pl.aiwcorpo.mcp.portal.bff.iga.AccessGovernance;
import pl.aiwcorpo.mcp.portal.bff.iga.IgaData;
import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import pl.aiwcorpo.mcp.portal.bff.token.UserTokens;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerClient;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerData;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerModel;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayAdminClient;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel;
import pl.aiwcorpo.mcp.portal.bff.web.RequestIds;

/** {@code GET /api/v1/catalog}. Any failing source makes the whole answer 503 (a partial catalog would mislead). */
@RestController
class CatalogController {

    private final UserTokens tokens;
    private final GatewayAdminClient gateway;
    private final BrokerClient broker;
    private final AccessGovernance iga;
    private final CatalogAssembler assembler;
    private final boolean allowPlainHttp;

    CatalogController(UserTokens tokens, GatewayAdminClient gateway, BrokerClient broker, AccessGovernance iga,
                      PublicUrls publicUrls, DevMode devMode) {
        this.allowPlainHttp = devMode.enabled();
        this.tokens = tokens;
        this.gateway = gateway;
        this.broker = broker;
        this.iga = iga;
        this.assembler = new CatalogAssembler(publicUrls, iga.supportsRequests());
    }

    @GetMapping("/api/v1/catalog")
    PortalCatalog catalog(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        PortalUser user = PortalUser.from(authentication);
        String requestId = RequestIds.of(request);
        BearerToken adminToken = tokens.tokenFor(UserTokens.Audience.GATEWAY_ADMIN, authentication, request, response);
        BearerToken brokerToken = tokens.tokenFor(UserTokens.Audience.BROKER, authentication, request, response);
        GatewayModel.Catalog catalog = BrokerData.validCatalog(gateway.catalog(adminToken, requestId));
        List<BrokerModel.Connection> connections =
                BrokerData.validConnections(broker.listConnections(brokerToken, requestId));
        List<BrokerModel.SystemInfo> systems = BrokerData.validSystems(broker.listSystems(brokerToken, requestId));
        List<AccessGovernance.AccessRequest> requests =
                IgaData.validRequests(iga.requestsOf(
                        new AccessGovernance.Requester(user.sub(), user.username(), user.email(), user.claims())), allowPlainHttp);
        return assembler.assemble(catalog, connections, systems, requests);
    }
}
