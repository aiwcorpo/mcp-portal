package pl.aiwcorpo.mcp.portal.bff.audit;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Audit event C8 ({@code audit-event.schema.json}). Only fields the portal can fill; the schema forbids anything
 * else, so secrets and argument values have nowhere to go.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AuditEvent(
        String ts,
        String requestId,
        String component,
        String componentId,
        String event,
        String sub,
        String username,
        String server,
        String virtualServer,
        String decision,
        String reason,
        String credentialType,
        String backendUser,
        String outcome,
        String errorCode,
        Long latencyMs) {
}
