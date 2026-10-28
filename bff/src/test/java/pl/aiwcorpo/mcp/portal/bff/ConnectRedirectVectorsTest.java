package pl.aiwcorpo.mcp.portal.bff;

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

import pl.aiwcorpo.mcp.portal.bff.support.ConnectRedirectRules;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** The rules used to judge the BFF's redirects agree with the contract vectors (connect-redirects, CC-086). */
class ConnectRedirectVectorsTest {

    static Stream<Arguments> vectors() throws IOException {
        Resource[] files = new PathMatchingResourcePatternResolver()
                .getResources("classpath*:mcp-contracts/test-vectors/connect-redirects/*.json");
        assertThat(files).hasSizeGreaterThanOrEqualTo(10);
        JsonMapper json = JsonMapper.builder().build();
        List<Arguments> result = new ArrayList<>();
        for (Resource file : files) {
            // The test-vectors jar of 3.0.1 in ~/.m2 still carries these two files from 2.x; the repository and its
            // tag only have the negative invalid-identity-mismatch*.json (contracts must be rebuilt with clean).
            if (file.getFilename().startsWith("valid-identity-mismatch")) {
                continue;
            }
            try (InputStream in = file.getInputStream()) {
                JsonNode vector = json.readTree(in);
                result.add(Arguments.of(file.getFilename(), vector.get("location").asString(),
                        vector.get("expected").get("valid").asBoolean()));
            }
        }
        return result.stream();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("vectors")
    void rulesMatchTheVector(String name, String location, boolean valid) {
        assertThat(ConnectRedirectRules.isValid(location)).isEqualTo(valid);
    }
}
