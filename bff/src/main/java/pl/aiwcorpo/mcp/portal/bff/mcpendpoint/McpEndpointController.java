package pl.aiwcorpo.mcp.portal.bff.mcpendpoint;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.manifest.EndpointFilter;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;
import pl.aiwcorpo.mcp.portal.bff.config.PublicUrls;
import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import pl.aiwcorpo.mcp.portal.bff.token.UserTokens;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerData;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayAdminClient;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel;
import pl.aiwcorpo.mcp.portal.bff.web.ApiError;
import pl.aiwcorpo.mcp.portal.bff.web.RequestIds;

/**
 * {@code GET /api/v1/me/mcp-endpoint} (CC-175, CC-182). Nothing is stored and nothing is audited: the filter is a
 * convenience and not a permission. The count comes from the user's catalog at the gateway, so a bad filter is refused
 * before any upstream call and the refusal says nothing about the user's tools.
 */
@RestController
class McpEndpointController {

    // A '%' that does not start an escape: the container drops such a parameter, which would turn a broken filter into none.
    private static final Pattern BROKEN_ESCAPE = Pattern.compile("%(?![0-9A-Fa-f]{2})");

    private final UserTokens tokens;
    private final GatewayAdminClient gateway;
    private final PublicUrls publicUrls;
    private final PortalProperties.ClaudeCode claudeCode;

    McpEndpointController(UserTokens tokens, GatewayAdminClient gateway, PublicUrls publicUrls,
                          PortalProperties properties) {
        this.tokens = tokens;
        this.gateway = gateway;
        this.publicUrls = publicUrls;
        this.claudeCode = properties.clientConfigs().claudeCode();
    }

    @GetMapping("/api/v1/me/mcp-endpoint")
    ResponseEntity<Object> get(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        PortalUser.from(authentication);
        String requestId = RequestIds.of(request);
        String query = composedQuery(request);
        if (query == null) {
            return invalidFilter(requestId);
        }
        try {
            EndpointFilter.parse(query);
        } catch (EndpointFilter.Invalid e) {
            return invalidFilter(requestId);
        }
        BearerToken token = tokens.tokenFor(UserTokens.Audience.GATEWAY_ADMIN, authentication, request, response);
        GatewayModel.Catalog catalog = BrokerData.validCatalog(gateway.catalog(token, requestId));
        List<GatewayModel.CatalogTool> tools = new ArrayList<>();
        catalog.servers().forEach(server -> tools.addAll(server.tools()));
        return ResponseEntity.ok(McpEndpoint.of(publicUrls.mcp(), query, tools, claudeCode));
    }

    /** The query composed from the decoded parameters; null when the request itself is not a valid filter. */
    static String composedQuery(HttpServletRequest request) {
        String raw = request.getQueryString();
        if (raw != null && BROKEN_ESCAPE.matcher(raw).find()) {
            return null;
        }
        List<Map.Entry<String, String>> pairs = new ArrayList<>();
        for (Map.Entry<String, String[]> parameter : request.getParameterMap().entrySet()) {
            if (parameter.getValue().length != 1) {
                return null;
            }
            pairs.add(Map.entry(parameter.getKey(), parameter.getValue()[0]));
        }
        return McpEndpoint.composeQuery(pairs);
    }

    private static ResponseEntity<Object> invalidFilter(String requestId) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new InvalidFilter(ApiError.INVALID_REQUEST, "invalid_filter", "The filter is not valid.", requestId));
    }

    /** {@code InvalidFilter} of C12: the closed schema has a {@code reason}, which {@link ApiError} does not. */
    record InvalidFilter(String error, String reason, String message, String requestId) {
    }
}
