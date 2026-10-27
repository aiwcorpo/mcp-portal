package pl.aiwcorpo.mcp.portal.bff.iga;

import java.util.List;
import java.util.Map;

/**
 * Port C13. The port receives the whole identity from the login and each adapter picks the identifier its IGA
 * product uses (decision of 2026-10-27; the contract sketch has only {@code sub}).
 */
public interface AccessGovernance {

    /** Entitlements (C9 group names) that can be requested for a system. */
    List<String> catalog(String system);

    /** Requests of the user, any status (CC-024). */
    List<AccessRequest> requestsOf(Requester requester);

    /** Creates a request or returns where the IGA wants the user to go. */
    RequestResult request(Requester requester, String entitlement);

    /**
     * Identity of the requester, all from the OIDC login of the session.
     *
     * @param claims identity claims of the login (ID token and userinfo)
     */
    record Requester(String sub, String username, String email, Map<String, Object> claims) {

        @Override
        public String toString() {
            return "Requester[sub=" + sub + "]";
        }
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
