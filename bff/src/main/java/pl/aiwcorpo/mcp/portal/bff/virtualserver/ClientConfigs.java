package pl.aiwcorpo.mcp.portal.bff.virtualserver;

import java.util.regex.Pattern;

import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;

/**
 * Ready-to-paste client settings of a virtual server (C12 {@code ClientConfigs}). They carry the link and nothing
 * else: no token, no OAuth client secret. The MCP client runs its own OAuth login against the gateway.
 */
record ClientConfigs(String claudeCode, String copilot, String codex) {

    private static final Pattern SHELL_SAFE = Pattern.compile("^[A-Za-z0-9 ._:/=-]+$");

    /** @param slug validated {@code VirtualServerSlug} ([a-z0-9-]); @param url built from the public base URL */
    static ClientConfigs of(String slug, String url, PortalProperties.ClaudeCode claudeCode) {
        StringBuilder command = new StringBuilder("claude mcp add --transport http");
        if (claudeCode.clientId() != null) {
            command.append(" --client-id ").append(claudeCode.clientId());
        }
        if (claudeCode.callbackPort() != null) {
            command.append(" --callback-port ").append(claudeCode.callbackPort());
        }
        String claudeCodeCommand = command + " " + slug + " " + url;
        // The command is pasted into a shell unquoted; this holds whatever the individual validations let through.
        if (!SHELL_SAFE.matcher(claudeCodeCommand).matches()) {
            throw new IllegalStateException("clientConfigs.claudeCode would contain characters that need shell quoting");
        }
        return new ClientConfigs(
                claudeCodeCommand,
                "{\"servers\":{\"" + slug + "\":{\"type\":\"http\",\"url\":\"" + url + "\"}}}",
                "[mcp_servers." + slug + "]\nurl = \"" + url + "\"\n");
    }
}
