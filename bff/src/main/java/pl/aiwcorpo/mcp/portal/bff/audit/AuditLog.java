package pl.aiwcorpo.mcp.portal.bff.audit;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

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

    // C8 requires escaping control characters and U+2028/U+2029; escaping all non-ASCII covers both.
    private final JsonMapper mapper = JsonMapper.builder().enable(JsonWriteFeature.ESCAPE_NON_ASCII).build();
    private final String componentId;

    public AuditLog(PortalProperties properties) {
        this.componentId = properties.componentId();
    }

    /** {@code connection_change} of the current user for one system. */
    public void connectionChange(String requestId, PortalUser user, String system, Outcome outcome, long latencyMs) {
        write(new AuditEvent(
                Instant.now().truncatedTo(ChronoUnit.MILLIS).toString(),
                requestId,
                "portal",
                componentId,
                "connection_change",
                user.sub(),
                user.username(),
                "mcp-" + system,
                outcome.decision(),
                outcome.reason(),
                null,
                outcome.outcome(),
                outcome.errorCode(),
                latencyMs));
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

        public static Outcome rejected(String reason) {
            return new Outcome("allow", reason, "error", "invalid_argument");
        }

        public static Outcome upstreamUnavailable() {
            return new Outcome("allow", "upstream_unavailable", "error", "upstream_unavailable");
        }
    }
}
