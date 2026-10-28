package pl.aiwcorpo.mcp.portal.bff.virtualserver;

/**
 * Ready-to-paste client settings of a virtual server (C12 {@code ClientConfigs}). They carry the link and nothing
 * else: no token, no OAuth client secret. The MCP client runs its own OAuth login against the gateway.
 */
record ClientConfigs(String claudeCode, String copilot, String codex) {

    /** @param slug validated {@code VirtualServerSlug} ([a-z0-9-]); @param url built from the public base URL */
    static ClientConfigs of(String slug, String url) {
        return new ClientConfigs(
                "claude mcp add --transport http " + slug + " " + url,
                "{\"servers\":{\"" + slug + "\":{\"type\":\"http\",\"url\":\"" + url + "\"}}}",
                "[mcp_servers." + slug + "]\nurl = \"" + url + "\"\n");
    }
}
