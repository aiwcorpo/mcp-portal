package pl.aiwcorpo.mcp.portal.bff.virtualserver;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties.ClaudeCode;

class ClientConfigsTest {

    private static final String URL = "https://mcp.aiwcorpo.pl/v/team-a-dev/mcp";

    @Test
    void withoutSettingsTheCommandHasNoOAuthFlags() {
        assertThat(ClientConfigs.of("team-a-dev", URL, new ClaudeCode(null, null)).claudeCode())
                .isEqualTo("claude mcp add --transport http team-a-dev " + URL);
        assertThat(ClientConfigs.of("team-a-dev", URL, new ClaudeCode("  ", null)).claudeCode())
                .isEqualTo("claude mcp add --transport http team-a-dev " + URL);
    }

    @Test
    void clientIdAndCallbackPortAreIndependent() {
        assertThat(ClientConfigs.of("team-a-dev", URL, new ClaudeCode("claude-code", 33418)).claudeCode())
                .isEqualTo("claude mcp add --transport http --client-id claude-code --callback-port 33418 team-a-dev "
                        + URL);
        assertThat(ClientConfigs.of("team-a-dev", URL, new ClaudeCode("0oa1b2c3", null)).claudeCode())
                .isEqualTo("claude mcp add --transport http --client-id 0oa1b2c3 team-a-dev " + URL);
        assertThat(ClientConfigs.of("team-a-dev", URL, new ClaudeCode(null, 33418)).claudeCode())
                .isEqualTo("claude mcp add --transport http --callback-port 33418 team-a-dev " + URL);
    }

    @Test
    void copilotAndCodexAreNotAffected() {
        ClientConfigs plain = ClientConfigs.of("team-a-dev", URL, new ClaudeCode(null, null));
        ClientConfigs configured = ClientConfigs.of("team-a-dev", URL, new ClaudeCode("claude-code", 33418));
        assertThat(configured.copilot()).isEqualTo(plain.copilot());
        assertThat(configured.codex()).isEqualTo(plain.codex());
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
        String slug = "a" + "b".repeat(61) + "c";
        String clientId = "A".repeat(128);
        String url = "https://mcp.aiwcorpo.pl:65535/v/" + slug + "/mcp";
        for (int port : new int[] {1024, 65535}) {
            String command = ClientConfigs.of(slug, url, new ClaudeCode(clientId, port)).claudeCode();
            assertThat(command).isEqualTo("claude mcp add --transport http --client-id " + clientId
                    + " --callback-port " + port + " " + slug + " " + url);
            assertThat(command).matches("^[A-Za-z0-9 ._:/=-]+$");
        }
    }

    @Test
    void anyInputWithShellMetacharactersIsRefusedWhateverItsSource() {
        ClaudeCode none = new ClaudeCode(null, null);
        for (String slug : new String[] {"a;b", "a b$(x)", "a`b`", "a|b", "a&b", "a'b", "a\"b", "a*b", "a\nb"}) {
            assertThatThrownBy(() -> ClientConfigs.of(slug, URL, none)).as(slug).isInstanceOf(IllegalStateException.class);
        }
        for (String url : new String[] {"https://[2001:db8::1]/v/x/mcp", "https://h/v/x/mcp;id", "https://h/v/x/mcp?a=b",
                "https://h/v/x/mcp#f"}) {
            assertThatThrownBy(() -> ClientConfigs.of("x", url, none)).as(url).isInstanceOf(IllegalStateException.class);
        }
    }
}
