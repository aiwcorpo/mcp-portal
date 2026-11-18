package pl.aiwcorpo.mcp.portal.bff.limits;

import java.time.Clock;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;
import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;

/**
 * Limits for the writes that reach the broker with something the user typed: a token (each attempt is a check of it at
 * the target system) and the operations of the authenticator (CC-156). The sliding window of request times is kept per
 * {@code sub}, not in the session: a new login or a second session must not start a fresh window, since the broker has
 * no limit of its own for a token write. A window is dropped once all its requests have left it.
 */
@Component
public class SessionRateLimiter {

    /** Kinds of limited operations; each has its own window. */
    public enum Kind {
        SECRET_WRITE,
        AUTHENTICATOR
    }

    private final PortalProperties.Limits limits;
    private final Clock clock;
    private final Map<Key, Window> windows = new ConcurrentHashMap<>();

    SessionRateLimiter(PortalProperties properties, Clock clock) {
        this.limits = properties.limits();
        this.clock = clock;
    }

    /**
     * Counts one request of the user.
     *
     * @throws ApiException {@code 429 rate_limited} with {@code Retry-After} when the window is full; the refused
     *                      request is not counted, so waiting out the answer is enough
     */
    public void acquire(PortalUser user, Kind kind) {
        PortalProperties.SessionLimit limit = limitOf(kind);
        long now = clock.millis();
        long windowMillis = limit.window().toMillis();
        long[] retryAfterMillis = new long[1];
        // Counting inside compute keeps a concurrent removal of an idle window from losing the request.
        windows.compute(new Key(user.sub(), kind), (key, window) -> {
            Window counted = window == null ? new Window() : window;
            retryAfterMillis[0] = counted.tryAcquire(now, limit.max(), windowMillis);
            return counted;
        });
        windows.forEach((key, window) -> windows.computeIfPresent(key,
                (k, w) -> w.idle(now, limitOf(k.kind()).window().toMillis()) ? null : w));
        if (retryAfterMillis[0] > 0) {
            throw ApiException.rateLimited((retryAfterMillis[0] + 999) / 1000);
        }
    }

    private PortalProperties.SessionLimit limitOf(Kind kind) {
        return kind == Kind.SECRET_WRITE ? limits.secretWrite() : limits.authenticator();
    }

    private record Key(String sub, Kind kind) {
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

        synchronized boolean idle(long now, long windowMillis) {
            return times.isEmpty() || now - times.peekLast() >= windowMillis;
        }
    }
}
