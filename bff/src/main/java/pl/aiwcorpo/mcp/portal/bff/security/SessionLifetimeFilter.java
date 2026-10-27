package pl.aiwcorpo.mcp.portal.bff.security;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;

import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Absolute session lifetime counted from creation. The idle limit is the container's session timeout; this
 * one ends even a session that is used all day.
 */
class SessionLifetimeFilter extends OncePerRequestFilter {

    private final Duration absoluteTimeout;
    private final Clock clock;

    SessionLifetimeFilter(Duration absoluteTimeout, Clock clock) {
        this.absoluteTimeout = absoluteTimeout;
        this.clock = clock;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        HttpSession session = request.getSession(false);
        if (session != null && clock.millis() - session.getCreationTime() > absoluteTimeout.toMillis()) {
            session.invalidate();
        }
        chain.doFilter(request, response);
    }
}
