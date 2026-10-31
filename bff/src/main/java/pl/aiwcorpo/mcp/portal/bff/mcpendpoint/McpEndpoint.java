package pl.aiwcorpo.mcp.portal.bff.mcpendpoint;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonInclude;

import pl.aiwcorpo.mcp.manifest.EndpointFilter;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel;

/**
 * The answer of {@code GET /api/v1/me/mcp-endpoint} (CC-175, CC-182): the address of {@code /mcp} for a filter, the client
 * configurations and the number of tools the filter leaves visible. The filter is parsed by {@link EndpointFilter}, the
 * class of the gateway, so there is one canonical form.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
record McpEndpoint(String url, String filter, int toolCount, ClientConfigs clientConfigs) {

    /** The four names of the query (CC-170); the gateway refuses any other. */
    static final List<String> PARAMETERS = List.of("systems", "tools", "access", "exclude");

    /**
     * CC-182: {@code name=value} joined with {@code &}, nothing encoded again. The values are already decoded by the HTTP layer;
     * a value that holds {@code &} or {@code =} would change the structure of the query, so it is written as {@code %26} or
     * {@code %3D}, which the parser refuses: the filter is invalid, never a different one.
     */
    static String composeQuery(List<Map.Entry<String, String>> pairs) {
        StringBuilder query = new StringBuilder();
        for (Map.Entry<String, String> pair : pairs) {
            if (!query.isEmpty()) {
                query.append('&');
            }
            query.append(pair.getKey()).append('=')
                    .append(pair.getValue().replace("&", "%26").replace("=", "%3D"));
        }
        return query.toString();
    }

    /**
     * @param baseMcpUrl {@code <publicBaseUrl>/mcp}
     * @param rawQuery   the composed query
     * @param tools      tools of the user's catalog (C5), flattened from {@code servers[].tools[]}
     * @throws EndpointFilter.Invalid when the query is not a valid filter
     */
    static McpEndpoint of(String baseMcpUrl, String rawQuery, List<GatewayModel.CatalogTool> tools,
                          PortalProperties.ClaudeCode claudeCode) {
        EndpointFilter parsed = EndpointFilter.parse(rawQuery);
        String canonical = parsed.canonical();
        String url = canonical.isEmpty() ? baseMcpUrl : baseMcpUrl + "?" + canonical;
        int count = (int) tools.stream()
                .filter(tool -> "granted".equals(tool.access()) && !Boolean.TRUE.equals(tool.disabled()))
                .filter(tool -> tool.name() != null && tool.name().contains("__"))
                .filter(tool -> parsed.allows(tool.name(), tool.risk()))
                .count();
        return new McpEndpoint(url, canonical.isEmpty() ? null : canonical, count, ClientConfigs.of(url, claudeCode));
    }
}
