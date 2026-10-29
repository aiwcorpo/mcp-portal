package pl.aiwcorpo.mcp.portal.bff.iga;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Port C13. The port receives the whole identity from the login and each adapter picks the identifier its IGA
 * product uses (decision of 2026-10-27; the contract sketch has only {@code sub}). An adapter that has no request
 * flow (a catalog of Keycloak groups only) answers {@link #request} with {@link NotRequestableException}.
 */
public interface AccessGovernance {

    /** Entitlements (C9 group names) of a system, as the IGA catalog lists them. */
    List<Entitlement> catalog(String system);

    /** Requests of the user, any status (CC-024); empty for an adapter without a request flow. */
    List<AccessRequest> requestsOf(Requester requester);

    /**
     * Creates a request or returns where the IGA wants the user to go.
     *
     * @throws NotRequestableException when the adapter has no request flow or does not know the entitlement
     */
    RequestResult request(Requester requester, String entitlement);

    /** @param description text of the IGA catalog; untrusted, the BFF neutralizes it before it reaches the browser */
    record Entitlement(String name, String description) {
    }

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
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record AccessRequest(String requestId, String entitlement, String status, String createdAt, String decidedAt,
                         String requestUrl) {

        public boolean pending() {
            return "pending".equals(status);
        }
    }

    /** Exactly one of the fields is set (C12 {@code AccessRequestResult}). */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record RequestResult(String requestUrl, String requestId) {
    }
}
