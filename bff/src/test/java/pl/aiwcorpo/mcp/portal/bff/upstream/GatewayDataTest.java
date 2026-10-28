package pl.aiwcorpo.mcp.portal.bff.upstream;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

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
}
