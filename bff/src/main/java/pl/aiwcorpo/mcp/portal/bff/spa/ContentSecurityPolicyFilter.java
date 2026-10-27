package pl.aiwcorpo.mcp.portal.bff.spa;

import java.io.IOException;
import java.security.SecureRandom;
import java.util.Base64;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * CSP without {@code unsafe-inline} on every response, as agreed with ws-08 (web/README.md): scripts only from
 * files, styles from files or with the per-response nonce. Angular inserts component styles as {@code <style>}
 * elements at runtime and takes the nonce from {@code ngCspNonce}, which {@link SpaFallbackFilter} writes into
 * index.html.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class ContentSecurityPolicyFilter extends OncePerRequestFilter {

    static final String NONCE_ATTRIBUTE = ContentSecurityPolicyFilter.class.getName() + ".nonce";

    private static final SecureRandom RANDOM = new SecureRandom();

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        byte[] bytes = new byte[16];
        RANDOM.nextBytes(bytes);
        String nonce = Base64.getEncoder().encodeToString(bytes);
        request.setAttribute(NONCE_ATTRIBUTE, nonce);
        response.setHeader("Content-Security-Policy", policy(nonce));
        chain.doFilter(request, response);
    }

    static String policy(String nonce) {
        return "default-src 'self'; "
                + "script-src 'self'; "
                + "style-src 'self' 'nonce-" + nonce + "'; "
                + "img-src 'self'; "
                + "font-src 'self'; "
                + "connect-src 'self'; "
                + "object-src 'none'; "
                + "base-uri 'self'; "
                + "form-action 'self'; "
                + "frame-ancestors 'none'";
    }
}
