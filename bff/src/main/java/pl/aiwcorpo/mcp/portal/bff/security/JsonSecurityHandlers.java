package pl.aiwcorpo.mcp.portal.bff.security;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.MediaType;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.csrf.CsrfException;

import pl.aiwcorpo.mcp.portal.bff.web.ApiError;

/** 401 and 403 from the security filters as C12 {@code Error} JSON instead of redirects or HTML. */
final class JsonSecurityHandlers {

    private JsonSecurityHandlers() {
    }

    static AuthenticationEntryPoint unauthenticated() {
        return (request, response, e) -> write(response, HttpServletResponse.SC_UNAUTHORIZED, ApiError.UNAUTHENTICATED);
    }

    static AccessDeniedHandler accessDenied() {
        return (request, response, e) -> write(response, HttpServletResponse.SC_FORBIDDEN,
                e instanceof CsrfException ? ApiError.CSRF_INVALID : ApiError.ACCESS_DENIED);
    }

    private static void write(HttpServletResponse response, int status, String error) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        // Codes are fixed snake_case constants, so no JSON escaping is needed.
        response.getWriter().write("{\"error\":\"" + error + "\"}");
    }
}
