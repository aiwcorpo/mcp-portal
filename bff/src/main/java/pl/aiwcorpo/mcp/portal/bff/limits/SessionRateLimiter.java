package pl.aiwcorpo.mcp.portal.bff.limits;

import java.time.Clock;
import java.util.ArrayDeque;
import java.util.Deque;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;

import org.springframework.stereotype.Component;

import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;

/**
 * Limits per session for the writes that reach the broker with something the user typed: a token (each attempt is a
 * check of it at the target system) and the operations of the authenticator (CC-156). A sliding window of request times
 * is kept in the session itself, so it goes away with the session and needs no cleanup. The limit is per session, as
 * the contract says; a fresh login starts a fresh window, which is why the broker and the gateway keep their own
 * limits per user.
 */
@Component
public class SessionRateLimiter {

    /** Kinds of limited operations; each has its own window. */
    public enum Kind {
        SECRET_WRITE("portal.limit.secretWrite"),
        AUTHENTICATOR("portal.limit.authenticator");

        private final String attribute;

        Kind(String attribute) {
            this.attribute = attribute;
        }
    }

    // Two first requests of one session at the same moment must end up with the same window.
    private static final Object CREATE = new Object();

    private final PortalProperties.Limits limits;
    private final Clock clock;

    SessionRateLimiter(PortalProperties properties, Clock clock) {
        this.limits = properties.limits();
        this.clock = clock;
    }

    /**
     * Counts one request of the session.
     *
     * @throws ApiException {@code 429 rate_limited} with {@code Retry-After} when the window is full; the refused
     *                      request is not counted, so waiting out the answer is enough
     */
    public void acquire(HttpServletRequest request, Kind kind) {
        PortalProperties.SessionLimit limit = kind == Kind.SECRET_WRITE ? limits.secretWrite() : limits.authenticator();
        HttpSession session = request.getSession();
        Window window;
        synchronized (CREATE) {
            if (session.getAttribute(kind.attribute) instanceof Window existing) {
                window = existing;
            } else {
                window = new Window();
                session.setAttribute(kind.attribute, window);
            }
        }
        long retryAfterMillis = window.tryAcquire(clock.millis(), limit.max(), limit.window().toMillis());
        if (retryAfterMillis > 0) {
            throw ApiException.rateLimited((retryAfterMillis + 999) / 1000);
        }
    }

    /** Times of the requests inside the window, oldest first. Only a number of longs: no user data. */
    private static final class Window {

        private final Deque<Long> times = new ArrayDeque<>();

        /** 0 when the request is counted, otherwise the milliseconds until the oldest one leaves the window. */
        synchronized long tryAcquire(long now, int max, long windowMillis) {
            while (!times.isEmpty() && now - times.peekFirst() >= windowMillis) {
                times.removeFirst();
            }
            if (times.size() >= max) {
                return Math.max(1, times.peekFirst() + windowMillis - now);
            }
            times.addLast(now);
            return 0;
        }
    }
}
