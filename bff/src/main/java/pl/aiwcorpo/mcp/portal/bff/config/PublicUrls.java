package pl.aiwcorpo.mcp.portal.bff.config;

import java.net.URI;

/**
 * Public addresses of the one domain behind the reverse proxy (CC-089). They come from configuration only, never
 * from {@code Host} or {@code X-Forwarded-Host} of a request.
 */
public class PublicUrls {

    private final String base;

    public PublicUrls(URI publicBaseUrl, DevMode devMode) {
        if (publicBaseUrl == null || publicBaseUrl.toString().isBlank()) {
            throw new IllegalStateException("portal.public-base-url (PORTAL_PUBLIC_BASE_URL) is not configured");
        }
        boolean https = "https".equalsIgnoreCase(publicBaseUrl.getScheme());
        boolean http = "http".equalsIgnoreCase(publicBaseUrl.getScheme());
        String path = publicBaseUrl.getRawPath();
        boolean bareOrigin = publicBaseUrl.getHost() != null && (path == null || path.isEmpty() || path.equals("/"))
                && publicBaseUrl.getRawQuery() == null && publicBaseUrl.getRawFragment() == null
                && publicBaseUrl.getRawUserInfo() == null;
        if (!(https || http) || !bareOrigin) {
            throw new IllegalStateException("portal.public-base-url must be scheme://host[:port] without a path");
        }
        devMode.require(http, "An http portal.public-base-url");
        String text = publicBaseUrl.toString();
        this.base = text.endsWith("/") ? text.substring(0, text.length() - 1) : text;
    }

    public String base() {
        return base;
    }

    /** MCP endpoint of a registered server, as handed to MCP clients (C12 {@code PortalCatalogServer.url}). */
    public String server(String serverId) {
        return base + "/s/" + serverId + "/mcp";
    }

    /** MCP endpoint of a virtual server. */
    public String virtualServer(String slug) {
        return base + "/v/" + slug + "/mcp";
    }
}
