package pl.aiwcorpo.mcp.portal.bff.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** {@code returnPath} vectors of mcp-contracts (CC-032). */
class ReturnPathsTest {

    static Stream<Arguments> vectors() throws IOException {
        Resource[] files = new PathMatchingResourcePatternResolver()
                .getResources("classpath*:mcp-contracts/test-vectors/return-paths/*.json");
        assertThat(files).isNotEmpty();
        JsonMapper json = JsonMapper.builder().build();
        List<Arguments> result = new ArrayList<>();
        for (Resource file : files) {
            try (InputStream in = file.getInputStream()) {
                JsonNode vector = json.readTree(in);
                result.add(Arguments.of(file.getFilename(), vector.get("value").asString(),
                        vector.get("expected").get("valid").asBoolean()));
            }
        }
        return result.stream();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("vectors")
    void matchesContractVector(String name, String value, boolean valid) {
        assertThat(ReturnPaths.isValid(value)).isEqualTo(valid);
    }
}
