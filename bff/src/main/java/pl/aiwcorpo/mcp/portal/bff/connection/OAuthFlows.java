package pl.aiwcorpo.mcp.portal.bff.connection;

import java.io.Serializable;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.concurrent.ConcurrentHashMap;

import jakarta.servlet.http.HttpSession;

import org.springframework.stereotype.Component;

/**
 * OAuth flows started from one browser session, keyed by the provider {@code state}. The callback may use only a
 * flow of its own session, so a link carrying another user's {@code state} finds nothing here. Entries are removed
 * on first use; they hold no token, secret or authorization code.
 */
@Component
class OAuthFlows {

    static final String ATTRIBUTE = "portal.oauth.flows";
    static final int MAX_PENDING = 8;
    static final Duration MAX_AGE = Duration.ofMinutes(15);

    private final Clock clock;

    OAuthFlows(Clock clock) {
        this.clock = clock;
    }

    void add(HttpSession session, String state, String flowId, String system, String returnPath) {
        Pending pending = pending(session);
        Instant now = clock.instant();
        pending.flows.values().removeIf(flow -> flow.expired(now));
        while (pending.flows.size() >= MAX_PENDING) {
            pending.flows.entrySet().stream()
                    .min(Comparator.comparing(entry -> entry.getValue().startedAt))
                    .ifPresent(oldest -> pending.flows.remove(oldest.getKey()));
        }
        pending.flows.put(state, new Flow(flowId, system, returnPath, now));
    }

    /** The flow for this {@code state} of this session, removed from it; null when unknown, used or expired. */
    Flow take(HttpSession session, String state) {
        if (session == null || state == null || !(session.getAttribute(ATTRIBUTE) instanceof Pending pending)) {
            return null;
        }
        Flow flow = pending.flows.remove(state);
        return flow == null || flow.expired(clock.instant()) ? null : flow;
    }

    private static Pending pending(HttpSession session) {
        if (session.getAttribute(ATTRIBUTE) instanceof Pending existing) {
            return existing;
        }
        Pending created = new Pending();
        session.setAttribute(ATTRIBUTE, created);
        return created;
    }

    record Flow(String flowId, String system, String returnPath, Instant startedAt) implements Serializable {

        boolean expired(Instant now) {
            return startedAt.plus(MAX_AGE).isBefore(now);
        }

        @Override
        public String toString() {
            return "Flow[system=" + system + "]";
        }
    }

    static final class Pending implements Serializable {
        private final ConcurrentHashMap<String, Flow> flows = new ConcurrentHashMap<>();

        @Override
        public String toString() {
            return "Pending[" + flows.size() + "]";
        }
    }
}
