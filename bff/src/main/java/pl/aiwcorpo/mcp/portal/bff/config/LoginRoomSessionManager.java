package pl.aiwcorpo.mcp.portal.bff.config;

import java.util.Arrays;
import java.util.Comparator;

import org.apache.catalina.Session;
import org.apache.catalina.session.StandardManager;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;

/**
 * Keeps at most {@code bound} sessions. At the bound the oldest session that holds no signed-in user (a login start
 * that has not come back) is expired to make room, so login starts, which anyone can send, cannot use up the room that
 * a new login needs. Only when every session is signed in is a new one refused.
 */
final class LoginRoomSessionManager extends StandardManager {

    LoginRoomSessionManager(int bound) {
        setMaxActiveSessions(bound);
    }

    @Override
    public synchronized Session createSession(String sessionId) {
        if (getActiveSessions() >= getMaxActiveSessions()) {
            Arrays.stream(findSessions())
                    .filter(session -> session.isValid() && session.getSession()
                            .getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY) == null)
                    .min(Comparator.comparingLong(Session::getCreationTimeInternal))
                    .ifPresent(Session::expire);
        }
        return super.createSession(sessionId);
    }
}
