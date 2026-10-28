package pl.aiwcorpo.mcp.portal.bff.web;

import java.security.SecureRandom;
import java.time.Clock;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/** UUIDv7 request ids (RFC 9562), the format C8 requires for {@code requestId}. */
public final class RequestIds {

    public static final String ATTRIBUTE = RequestIds.class.getName();
    public static final String HEADER = "X-Request-Id";

    private static final SecureRandom RANDOM = new SecureRandom();

    private RequestIds() {
    }

    public static String newId() {
        return uuidV7(Clock.systemUTC().millis()).toString();
    }

    static UUID uuidV7(long epochMillis) {
        long randA = RANDOM.nextInt(1 << 12);
        long msb = (epochMillis << 16) | 0x7000L | randA;
        long lsb = (RANDOM.nextLong() & 0x3FFFFFFFFFFFFFFFL) | 0x8000000000000000L;
        return new UUID(msb, lsb);
    }

    /** Id of the request being handled on this thread, or null outside a request. */
    public static String current() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            return of(attributes.getRequest());
        }
        return null;
    }

    /** Id of the current request; set by {@link RequestIdFilter}, generated here for code running outside it. */
    public static String of(HttpServletRequest request) {
        Object id = request.getAttribute(ATTRIBUTE);
        if (id instanceof String s) {
            return s;
        }
        String created = newId();
        request.setAttribute(ATTRIBUTE, created);
        return created;
    }
}
