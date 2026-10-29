package pl.aiwcorpo.mcp.portal.bff.iga;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;

class IgaDataTest {

    @ParameterizedTest
    @ValueSource(strings = {"javascript:alert(1)", "data:text/html,x", "//iga.corp.test/x", "/relative", "ftp://iga.corp.test/x",
            "https://user:pw@iga.corp.test/x", "https://iga.corp.test/x#frag", "https://iga.corp.test/a b",
            "https://iga.corp.test/‮", "https:///x", "http://iga.corp.test/x"})
    void unsafeAddressesAreRefused(String url) {
        assertThat(IgaData.isSafeUrl(url, false)).as(url).isFalse();
    }

    @Test
    void httpIsAcceptedOnlyWhenTheProfileAllowsIt() {
        assertThat(IgaData.isSafeUrl("http://localhost:18740/requests/1", true)).isTrue();
        assertThat(IgaData.isSafeUrl("http://localhost:18740/requests/1", false)).isFalse();
        assertThat(IgaData.isSafeUrl("https://iga.corp.test/requests/1?x=1&y=2", false)).isTrue();
        assertThat(IgaData.isSafeUrl("https://iga.corp.test/" + "a".repeat(2100), false)).isFalse();
    }

    @Test
    void aResultNeedsExactlyOneField() {
        assertThat(IgaData.validResult(new AccessGovernance.RequestResult(null, "REQ-1"), false)).isNotNull();
        assertThat(IgaData.validResult(new AccessGovernance.RequestResult("https://iga.corp.test/x", null), false)).isNotNull();
        assertThat(IgaData.validResult(new AccessGovernance.RequestResult(null, null), false)).isNull();
        assertThat(IgaData.validResult(new AccessGovernance.RequestResult("https://iga.corp.test/x", "REQ-1"), false)).isNull();
        assertThat(IgaData.validResult(new AccessGovernance.RequestResult(null, ""), false)).isNull();
        assertThat(IgaData.validResult(new AccessGovernance.RequestResult(null, "REQ\u200b1"), false)).isNull();
        assertThat(IgaData.validResult(null, false)).isNull();
    }

    @Test
    void requestableLeavesOutHeldEntitlementsAndBadNames() {
        List<AccessGovernance.Entitlement> result = IgaData.requestable(List.of(
                new AccessGovernance.Entitlement("mcp-jira-read", null),
                new AccessGovernance.Entitlement("mcp-jira-write", "  "),
                new AccessGovernance.Entitlement("jira-admin", "no prefix"),
                new AccessGovernance.Entitlement("mcp-jira-destructive\n", "newline in the name"),
                new AccessGovernance.Entitlement("mcp-jira-proj-ABC", "Project ABC")), Set.of("mcp-jira-read"));

        assertThat(result).extracting(AccessGovernance.Entitlement::name).containsExactly("mcp-jira-write", "mcp-jira-proj-ABC");
        assertThat(result.get(0).description()).isNull();
    }

    @Test
    void aTextCutAtTheLimitDoesNotSplitTheNotation() {
        String text = "x".repeat(497) + "‮";
        List<AccessGovernance.Entitlement> result = IgaData.requestable(
                List.of(new AccessGovernance.Entitlement("mcp-jira-read", text)), Set.of());
        assertThat(result.getFirst().description()).isEqualTo("x".repeat(497));
    }
}
