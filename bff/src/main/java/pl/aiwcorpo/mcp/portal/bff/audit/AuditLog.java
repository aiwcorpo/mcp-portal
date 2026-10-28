package pl.aiwcorpo.mcp.portal.bff.audit;

import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;
import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import tools.jackson.core.json.JsonWriteFeature;
import tools.jackson.databind.json.JsonMapper;

/** Writes C8 events, one JSON object per line, to the dedicated logger {@value #LOGGER}. */
@Component
public class AuditLog {

    public static final String LOGGER = "pl.aiwcorpo.mcp.audit";

    private static final Logger log = LoggerFactory.getLogger(LOGGER);
    // Not the audit logger: that one carries C8 events only.
    private static final Logger diagnostics = LoggerFactory.getLogger(AuditLog.class);

    // C8 requires escaping control characters and U+2028/U+2029; escaping all non-ASCII covers both.
    private final JsonMapper mapper = JsonMapper.builder().enable(JsonWriteFeature.ESCAPE_NON_ASCII).build();
    private final String componentId;

    private final Clock clock;

    public AuditLog(PortalProperties properties, Clock clock) {
        this.componentId = properties.componentId();
        this.clock = clock;
    }

    /** {@code connection_change} of the current user; {@code system} is null when the request named no valid one. */
    public void connectionChange(String requestId, PortalUser user, String system, Outcome outcome, long latencyMs) {
        connectionChange(requestId, user, system, null, outcome, latencyMs);
    }

    /** As above; {@code backendUser} is the account that was linked (CC-117), the only trace of who linked what. */
    public void connectionChange(String requestId, PortalUser user, String system, String backendUser, Outcome outcome,
                                 long latencyMs) {
        write(new AuditEvent(
                clock.instant().truncatedTo(ChronoUnit.MILLIS).toString(),
                requestId,
                "portal",
                componentId,
                "connection_change",
                user.sub(),
                user.username(),
                system == null ? null : "mcp-" + system,
                null,
                outcome.decision(),
                outcome.reason(),
                null,
                auditableBackendUser(backendUser),
                outcome.outcome(),
                outcome.errorCode(),
                latencyMs));
    }

    /** {@code admin_change} for creating or deleting a virtual server; {@code slug} is null when none was valid. */
    public void virtualServerChange(String requestId, PortalUser user, String slug, Outcome outcome, long latencyMs) {
        write(new AuditEvent(
                clock.instant().truncatedTo(ChronoUnit.MILLIS).toString(),
                requestId,
                "portal",
                componentId,
                "admin_change",
                user.sub(),
                user.username(),
                null,
                slug,
                outcome.decision(),
                outcome.reason(),
                null,
                null,
                outcome.outcome(),
                outcome.errorCode(),
                latencyMs));
    }

    /**
     * Same pattern as {@code backendUser} in audit-event.schema.json (C0/C1, DEL, U+2028/2029 and the bidi controls are
     * excluded, 1..255 code points), plus lone surrogates, which a JSON consumer cannot decode. A name that fails is
     * dropped rather than failing the event, and the loss is logged without the value.
     */
    private static final Pattern BACKEND_USER = Pattern
            .compile("^[^\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]{1,255}$");

    static String auditableBackendUser(String backendUser) {
        if (backendUser == null) {
            return null;
        }
        if (BACKEND_USER.matcher(backendUser).matches() && !hasLoneSurrogate(backendUser)) {
            return backendUser;
        }
        diagnostics.warn("backendUser left out of the audit event: it does not fit the C8 schema");
        return null;
    }

    private static boolean hasLoneSurrogate(String text) {
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (Character.isHighSurrogate(c) && i + 1 < text.length() && Character.isLowSurrogate(text.charAt(i + 1))) {
                i++;
            } else if (Character.isSurrogate(c)) {
                return true;
            }
        }
        return false;
    }

    private void write(AuditEvent event) {
        log.info(mapper.writeValueAsString(event));
    }

    /**
     * @param errorCode C10 code or null; {@code reason} carries finer causes such as {@code secret_invalid}
     */
    public record Outcome(String decision, String reason, String outcome, String errorCode) {

        public static Outcome ok() {
            return new Outcome("allow", null, "ok", null);
        }

        public static Outcome stepUpRequired() {
            return new Outcome("deny", "step_up_required", "denied", "step_up_required");
        }

        /** The change was refused (invalid input, or the broker rejected the secret). */
        public static Outcome rejected(String reason) {
            return new Outcome("deny", reason, "error", "invalid_argument");
        }

        /** The gateway refused the change for this user. */
        public static Outcome accessDenied() {
            return new Outcome("deny", "access_denied", "denied", "access_denied");
        }

        public static Outcome upstreamUnavailable() {
            return new Outcome("allow", "upstream_unavailable", "error", "upstream_unavailable");
        }
    }
}
