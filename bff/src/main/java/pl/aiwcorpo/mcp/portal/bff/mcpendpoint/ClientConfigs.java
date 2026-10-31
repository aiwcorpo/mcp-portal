package pl.aiwcorpo.mcp.portal.bff.mcpendpoint;

import java.util.regex.Pattern;

import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;

/**
 * Ready-to-paste client settings for the address of the aggregate endpoint (C12 {@code ClientConfigs}). They carry the
 * address and nothing else: no token, no OAuth client secret. The MCP client runs its own OAuth login against the gateway.
 */
record ClientConfigs(String claudeCode, String copilot, String codex) {

    /** Name under which the clients register the platform; the vectors of {@code mcp-endpoint/} fix it. */
    static final String NAME = "aiwcorpo-mcp";

    // The address is pasted into a shell inside double quotes: '&' and '?' are safe there, '$', '`', '"', '\' and '!' are not.
    private static final Pattern QUOTED_URL = Pattern.compile("^[A-Za-z0-9._:/=,&?-]+$");
    private static final Pattern SHELL_SAFE = Pattern.compile("^[A-Za-z0-9 ._:/=-]+$");

    /** @param url {@code <publicBaseUrl>/mcp} with the canonical filter, built by the caller from configuration */
    static ClientConfigs of(String url, PortalProperties.ClaudeCode claudeCode) {
        if (!QUOTED_URL.matcher(url).matches()) {
            throw new IllegalStateException("clientConfigs would contain characters that need shell quoting");
        }
        StringBuilder command = new StringBuilder("claude mcp add --transport http");
        if (claudeCode.clientId() != null) {
            command.append(" --client-id ").append(claudeCode.clientId());
        }
        if (claudeCode.callbackPort() != null) {
            command.append(" --callback-port ").append(claudeCode.callbackPort());
        }
        // Flags come from configuration and are checked at startup; this holds whatever the individual checks let through.
        if (!SHELL_SAFE.matcher(command).matches()) {
            throw new IllegalStateException("clientConfigs.claudeCode would contain characters that need shell quoting");
        }
        return new ClientConfigs(
                command + " " + NAME + " \"" + url + "\"",
                "{\"servers\":{\"" + NAME + "\":{\"type\":\"http\",\"url\":\"" + url + "\"}}}",
                "[mcp_servers." + NAME + "]\nurl = \"" + url + "\"\n");
    }
}
