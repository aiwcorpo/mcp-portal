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
}
