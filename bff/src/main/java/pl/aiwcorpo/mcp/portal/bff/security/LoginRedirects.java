package pl.aiwcorpo.mcp.portal.bff.security;

import java.io.IOException;
import java.net.URI;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpHeaders;

import pl.aiwcorpo.mcp.portal.bff.config.DevMode;

/**
 * Where the browser goes at the end of an OIDC login: the portal origin, or in dev a configured origin of a
 * separately served frontend (ng serve). The origin comes from configuration only, never from the request.
 */
public final class LoginRedirects {

    /** Closed list of {@code loginError} codes (accepted 2026-10-27, mcp-contracts 2.0.0). */
    public static final String CANCELLED = "cancelled";
    public static final String IDP_ERROR = "idp_error";
    public static final String SESSION_EXPIRED = "session_expired";
    public static final String STEP_UP_FAILED = "step_up_failed";

    private final String origin;

    public LoginRedirects(URI configuredOrigin, DevMode devMode) {
        this.origin = origin(configuredOrigin);
        devMode.require(this.origin != null, "portal.web.login-return-origin");
    }

    private static String origin(URI uri) {
        if (uri == null || uri.toString().isEmpty()) {
            return null;
        }
        boolean plainOrigin = ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                && uri.getHost() != null && (uri.getRawPath() == null || uri.getRawPath().isEmpty())
                && uri.getRawQuery() == null && uri.getRawFragment() == null && uri.getRawUserInfo() == null;
        if (!plainOrigin) {
            throw new IllegalStateException("portal.web.login-return-origin must be scheme://host[:port]");
        }
        return uri.toString();
    }

    /**
     * 302 with a relative {@code Location} (C12 examples): {@code sendRedirect} would make it absolute from the
     * request's {@code Host}, and public addresses come from configuration only (CC-089).
     *
     * @param path a validated return path or a fixed portal path
     */
    public void redirect(HttpServletRequest request, HttpServletResponse response, String path) throws IOException {
        response.setStatus(HttpServletResponse.SC_FOUND);
        response.setHeader(HttpHeaders.LOCATION, (origin != null ? origin : request.getContextPath()) + path);
        response.setContentLength(0);
        response.flushBuffer();
    }

    public void redirectToError(HttpServletRequest request, HttpServletResponse response, String code) throws IOException {
        redirect(request, response, "/?loginError=" + code);
    }
}
