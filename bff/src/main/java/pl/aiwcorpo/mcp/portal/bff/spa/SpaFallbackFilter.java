package pl.aiwcorpo.mcp.portal.bff.spa;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Serves index.html for every browser route of the SPA (deep links, page refresh) and lets existing build files
 * through to the static resource handler. API, gateway (/s, /v, /.well-known: routed elsewhere by the proxy),
 * OAuth and actuator paths are never touched, so /api/** cannot answer with HTML.
 */
class SpaFallbackFilter extends OncePerRequestFilter {

    private static final List<String> NOT_SPA = List.of("/api", "/s", "/v", "/.well-known", "/oauth2", "/actuator", "/error");
    private static final String INDEX = "index.html";

    private final Path distRoot;
    private final String nonceToken;

    SpaFallbackFilter(Path distRoot, String nonceToken) {
        this.distRoot = distRoot.toAbsolutePath().normalize();
        this.nonceToken = nonceToken;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String method = request.getMethod();
        if (!"GET".equals(method) && !"HEAD".equals(method)) {
            return true;
        }
        // Case-insensitive, so /API/v1/me is not answered with HTML either (it ends as a JSON 404). Both the raw and
        // the decoded path are checked: Spring routes /%61pi/v1/me to the API, a proxy may do the same.
        return isReserved(pathWithinApplication(request)) || isReserved(decodedPath(request));
    }

    private static boolean isReserved(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        return NOT_SPA.stream().anyMatch(prefix -> lower.equals(prefix) || lower.startsWith(prefix + "/"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = decodedPath(request);
        if (!path.equals("/") && !path.equals("/" + INDEX) && isBuildFile(path)) {
            chain.doFilter(request, response);
            return;
        }
        Path index = distRoot.resolve(INDEX);
        if (!Files.isRegularFile(index)) {
            response.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }
        Object nonce = request.getAttribute(ContentSecurityPolicyFilter.NONCE_ATTRIBUTE);
        String html = Files.readString(index, StandardCharsets.UTF_8);
        if (nonce != null) {
            html = html.replace(nonceToken, nonce.toString());
        }
        byte[] body = html.getBytes(StandardCharsets.UTF_8);
        response.setStatus(HttpServletResponse.SC_OK);
        response.setContentType(MediaType.TEXT_HTML_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        // The nonce changes per response, so index.html must never come from a cache.
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        response.setContentLength(body.length);
        if (!"HEAD".equals(request.getMethod())) {
            response.getOutputStream().write(body);
        }
    }

    private boolean isBuildFile(String path) {
        Path candidate = distRoot.resolve(path.substring(1)).normalize();
        return candidate.startsWith(distRoot) && Files.isRegularFile(candidate);
    }

    /** The container's decoded and normalized path, which is what the MVC and security matchers see. */
    private static String decodedPath(HttpServletRequest request) {
        String path = request.getServletPath() + (request.getPathInfo() == null ? "" : request.getPathInfo());
        return path.isEmpty() ? "/" : path;
    }

    private static String pathWithinApplication(HttpServletRequest request) {
        String uri = request.getRequestURI();
        String context = request.getContextPath();
        String path = uri.substring(context.length());
        return path.isEmpty() ? "/" : path;
    }
}
