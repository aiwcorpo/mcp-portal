package pl.aiwcorpo.mcp.portal.bff.iga;

import java.util.List;

/**
 * Port C13. The contract sketches {@code requestsOf(String sub)}; the BFF passes the whole identity because IGA
 * products key requests by login or e-mail as often as by IdP {@code sub}.
 */
public interface AccessGovernance {

    /** Entitlements (C9 group names) that can be requested for a system. */
    List<String> catalog(String system);

    /** Requests of the user, any status (CC-024). */
    List<AccessRequest> requestsOf(Requester requester);

    /** Creates a request or returns where the IGA wants the user to go. */
    RequestResult request(Requester requester, String entitlement);

    record Requester(String sub, String username) {
    }

    /** C12 {@code AccessRequest}; status is one of pending, approved, rejected, cancelled. */
    record AccessRequest(String requestId, String entitlement, String status, String createdAt, String requestUrl) {

        public boolean pending() {
            return "pending".equals(status);
        }
    }

    /** Exactly one of the fields is set (C12 {@code AccessRequestResult}). */
    record RequestResult(String requestUrl, String requestId) {
    }
}
