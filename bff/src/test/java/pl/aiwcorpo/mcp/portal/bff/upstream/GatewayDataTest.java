package pl.aiwcorpo.mcp.portal.bff.upstream;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class GatewayDataTest {

    @Test
    void hiddenCharactersBecomeTheirVisibleNotation() {
        assertThat(GatewayData.neutralize("a‮b⁦c‏d e\u0001f\u009fg"))
                .isEqualTo("a<U+202E>b<U+2066>c<U+200F>d<U+2029>e<U+0001>f<U+009F>g");
        assertThat(GatewayData.neutralize("x\ud800y\udc00z")).isEqualTo("x<U+D800>y<U+DC00>z");
    }

    @Test
    void ordinaryTextNewlinesTabsAndValidSurrogatePairsStay() {
        String text = "line1\nline2\tZażółć 😀";
        assertThat(GatewayData.neutralize(text)).isSameAs(text);
        assertThat(GatewayData.neutralize("😀‮")).isEqualTo("😀<U+202E>");
    }

    @Test
    void zeroWidthTagAndFillerCharactersAreNotLetThrough() {
        String[] hidden = {"\u200b", "\u200c", "\u200d", "\u200e", "\u2060", "\ufeff", "\u00ad", "\u061c", "\u180e",
            "\u115f", "\u3164", "\uffa0", "\u2800", "\u034f", "\ufe00", "\udb40\udc01", "\ue000", "\u0378"};
        for (String character : hidden) {
            assertThat(GatewayData.neutralize("a" + character + "b")).as(Integer.toHexString(character.codePointAt(0)))
                    .startsWith("a<U+").endsWith(">b");
        }
        assertThat(GatewayData.neutralize("a\udb40\udc01b")).isEqualTo("a<U+E0001>b");
        assertThat(GatewayData.neutralize("\u2764\ufe0f")).isEqualTo("\u2764\ufe0f");
        assertThat(GatewayData.neutralize("a\ufe0f")).isEqualTo("a<U+FE0F>");
    }

    @Test
    void resourceIdsWithHiddenCharactersAreRefused() {
        for (String id : List.of("ABC\u200b-1", "ABC\u200e-1", "ABC\u061c-1", "ABC\udb40\udc01-1", "ABC\u3164-1")) {
            GatewayModel.ConfirmationView view = new GatewayModel.ConfirmationView("cnf_4k9Qe2LxW7tB3mZp",
                    "jira__delete_issue", "jira", new GatewayModel.Resource("Jira::Issue", id, null), List.of(),
                    "2026-10-26T20:02:00Z");
            assertThat(GatewayData.validConfirmation(view, "cnf_4k9Qe2LxW7tB3mZp")).as(id).isNull();
        }
    }

    static Stream<String[]> hygieneVectors() throws IOException {
        JsonMapper json = JsonMapper.builder().build();
        List<String[]> vectors = new ArrayList<>();
        for (Resource file : new PathMatchingResourcePatternResolver()
                .getResources("classpath*:mcp-contracts/test-vectors/text-hygiene/*.json")) {
            try (InputStream in = file.getInputStream()) {
                JsonNode vector = json.readTree(in);
                String mode = vector.get("mode").asString();
                if (mode.equals("argument") || mode.equals("system-text")) {
                    boolean changes = mode.equals("argument") ? !vector.get("expected").get("valid").asBoolean()
                            : !vector.get("expected").get("output").asString().equals(vector.get("input").asString());
                    vectors.add(new String[] {file.getFilename(), vector.get("input").asString(), Boolean.toString(changes)});
                }
            }
        }
        return vectors.stream();
    }

    // What the contract forbids or replaces is also neutralized here. The extra characters this class treats as
    // hidden (U+200C..U+200F, CR, private use) are the only ones allowed to differ in the other direction.
    private static final Set<Integer> STRICTER = Set.of(0x200c, 0x200d, 0x200e, 0x200f, 0x0d);

    @ParameterizedTest(name = "{0}")
    @MethodSource("hygieneVectors")
    void agreesWithTheContractVectors(String name, String input, String contractChangesIt) {
        boolean neutralized = !GatewayData.neutralize(input).equals(input);
        if (Boolean.parseBoolean(contractChangesIt)) {
            // Tab, newline and CR are legal in a pattern-free argument; the contract vector for them is a valid one.
            assertThat(neutralized).as(name).isTrue();
        } else {
            boolean stricter = input.codePoints().anyMatch(STRICTER::contains);
            assertThat(neutralized && !stricter).as(name + " must keep legitimate text").isFalse();
        }
    }
}
