package pl.aiwcorpo.mcp.portal.bff.mcpendpoint;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties.ClaudeCode;

class ClientConfigsTest {

    private static final String URL = "https://mcp.aiwcorpo.pl/mcp?systems=jira&access=read";

    @Test
    void withoutSettingsTheCommandHasNoOAuthFlags() {
        assertThat(ClientConfigs.of(URL, new ClaudeCode(null, null)).claudeCode())
                .isEqualTo("claude mcp add --transport http aiwcorpo-mcp \"" + URL + "\"");
        assertThat(ClientConfigs.of(URL, new ClaudeCode("  ", null)).claudeCode())
                .isEqualTo("claude mcp add --transport http aiwcorpo-mcp \"" + URL + "\"");
    }

    @Test
    void clientIdAndCallbackPortAreIndependent() {
        assertThat(ClientConfigs.of(URL, new ClaudeCode("claude-code", 33418)).claudeCode())
                .isEqualTo("claude mcp add --transport http --client-id claude-code --callback-port 33418 aiwcorpo-mcp \""
                        + URL + "\"");
        assertThat(ClientConfigs.of(URL, new ClaudeCode("0oa1b2c3", null)).claudeCode())
                .isEqualTo("claude mcp add --transport http --client-id 0oa1b2c3 aiwcorpo-mcp \"" + URL + "\"");
        assertThat(ClientConfigs.of(URL, new ClaudeCode(null, 33418)).claudeCode())
                .isEqualTo("claude mcp add --transport http --callback-port 33418 aiwcorpo-mcp \"" + URL + "\"");
    }

    @Test
    void copilotAndCodexAreNotAffected() {
        ClientConfigs plain = ClientConfigs.of(URL, new ClaudeCode(null, null));
        ClientConfigs configured = ClientConfigs.of(URL, new ClaudeCode("claude-code", 33418));
        assertThat(configured.copilot()).isEqualTo(plain.copilot());
        assertThat(configured.codex()).isEqualTo(plain.codex());
        assertThat(plain.copilot()).isEqualTo("{\"servers\":{\"aiwcorpo-mcp\":{\"type\":\"http\",\"url\":\"" + URL + "\"}}}");
        assertThat(plain.codex()).isEqualTo("[mcp_servers.aiwcorpo-mcp]\nurl = \"" + URL + "\"\n");
    }

    @Test
    void valuesThatCouldBreakTheShellCommandAreRefusedAtStartup() {
        assertThatThrownBy(() -> new ClaudeCode("claude code; rm -rf /", null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ClaudeCode("a$(x)", null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ClaudeCode(null, 80)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ClaudeCode(null, 70000)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void theWholeCommandAtTheBoundariesOfEveryPart() {
        String url = "https://mcp.aiwcorpo.pl:65535/mcp?tools=" + "jira__get_issue,".repeat(30) + "jira__get_page";
        String clientId = "A".repeat(128);
        for (int port : new int[] {1024, 65535}) {
            String command = ClientConfigs.of(url, new ClaudeCode(clientId, port)).claudeCode();
            assertThat(command).isEqualTo("claude mcp add --transport http --client-id " + clientId
                    + " --callback-port " + port + " aiwcorpo-mcp \"" + url + "\"");
        }
    }

    @Test
    void anyAddressWithShellMetacharactersIsRefusedWhateverItsSource() {
        ClaudeCode none = new ClaudeCode(null, null);
        for (String url : new String[] {"https://[2001:db8::1]/mcp", "https://h/mcp;id", "https://h/mcp?a=$(x)",
                "https://h/mcp?a=`x`", "https://h/mcp\"", "https://h/mcp'x", "https://h/mcp#f", "https://h/mcp?a=b c",
                "https://h/mcp\nx", "https://h/mcp!x", "https://h/mcp\\x", "https://h/mcp|x", "https://h/mcp*"}) {
            assertThatThrownBy(() -> ClientConfigs.of(url, none)).as(url).isInstanceOf(IllegalStateException.class);
        }
    }
}
