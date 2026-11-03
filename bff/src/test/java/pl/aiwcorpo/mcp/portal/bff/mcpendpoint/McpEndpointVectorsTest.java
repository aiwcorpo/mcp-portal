package pl.aiwcorpo.mcp.portal.bff.mcpendpoint;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import pl.aiwcorpo.mcp.manifest.EndpointFilter;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties.ClaudeCode;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** {@code test-vectors/mcp-endpoint/} (CC-175, CC-182) against the composition and the answer of the BFF. */
class McpEndpointVectorsTest {

    static final JsonMapper JSON = JsonMapper.builder().build();

    static Stream<Arguments> vectors() throws IOException {
        Resource[] files = new PathMatchingResourcePatternResolver()
                .getResources("classpath*:mcp-contracts/test-vectors/mcp-endpoint/*.json");
        assertThat(files).isNotEmpty();
        List<Arguments> result = new ArrayList<>();
        for (Resource file : files) {
            try (InputStream in = file.getInputStream()) {
                result.add(Arguments.of(file.getFilename(), JSON.readTree(in)));
            }
        }
        return result.stream();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("vectors")
    void answerMatchesTheVector(String name, JsonNode vector) {
        JsonNode input = vector.get("input");
        JsonNode expected = vector.get("expected");
        String base = input.get("publicBaseUrl").asString() + "/mcp";
        String query = input.get("rawQuery").asString();
        List<GatewayModel.CatalogTool> catalog = catalog(input.get("catalog"));

        if (expected.get("status").asInt() == 400) {
            assertThatThrownBy(() -> McpEndpoint.of(base, query, catalog, new ClaudeCode(null, null)))
                    .isInstanceOf(EndpointFilter.Invalid.class);
            return;
        }
        McpEndpoint answer = McpEndpoint.of(base, query, catalog, new ClaudeCode(null, null));
        JsonNode body = expected.get("body");
        assertThat(answer.url()).isEqualTo(body.get("url").asString());
        assertThat(answer.filter()).isEqualTo(body.has("filter") ? body.get("filter").asString() : null);
        assertThat(answer.toolCount()).isEqualTo(body.get("toolCount").asInt());
        assertThat(answer.clientConfigs().claudeCode()).isEqualTo(body.get("clientConfigs").get("claudeCode").asString());
        assertThat(answer.clientConfigs().copilot()).isEqualTo(body.get("clientConfigs").get("copilot").asString());
        assertThat(answer.clientConfigs().codex()).isEqualTo(body.get("clientConfigs").get("codex").asString());
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("vectors")
    void theQueryAsTheClientSentItComposesTheRawQuery(String name, JsonNode vector) {
        JsonNode input = vector.get("input");
        if (!input.has("httpQuery") || vector.get("expected").get("status").asInt() == 400) {
            return;
        }
        List<Map.Entry<String, String>> pairs = new ArrayList<>();
        for (String part : input.get("httpQuery").asString().split("&")) {
            int eq = part.indexOf('=');
            pairs.add(Map.entry(URLDecoder.decode(part.substring(0, eq), StandardCharsets.UTF_8),
                    URLDecoder.decode(part.substring(eq + 1), StandardCharsets.UTF_8)));
        }
        assertThat(McpEndpoint.composeQuery(pairs)).isEqualTo(input.get("rawQuery").asString());
    }

    /** The flat list the BFF builds from {@code servers[].tools[]}; the vectors keep only what the count needs. */
    static List<GatewayModel.CatalogTool> catalog(JsonNode tools) {
        List<GatewayModel.CatalogTool> result = new ArrayList<>();
        for (JsonNode tool : tools) {
            result.add(new GatewayModel.CatalogTool(tool.get("name").asString(), "", tool.get("risk").asString(), "read",
                    tool.get("access").asString(), List.of(), null, tool.get("disabled").asBoolean() ? Boolean.TRUE : null,
                    null));
        }
        return result;
    }
}
