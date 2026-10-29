package pl.aiwcorpo.mcp.portal.bff.iga;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;

class MockAccessGovernanceTest {

    private static final ByteArrayResource FILE = new ByteArrayResource("""
            entitlements:
              jira: [mcp-jira-read, mcp-jira-destructive]
            requests:
              - user: alice
                requestId: REQ-1
                entitlement: mcp-jira-write
                status: pending
                createdAt: "2026-10-25T09:00:00Z"
              - user: alice@corp.test
                requestId: REQ-2
                entitlement: mcp-gitlab-read
                status: pending
                createdAt: "2026-10-25T09:00:00Z"
            """.getBytes(StandardCharsets.UTF_8));

    private static final AccessGovernance.Requester ALICE = new AccessGovernance.Requester("sub-a", "alice",
            "alice@corp.test", Map.of("sub", "sub-a", "preferred_username", "alice", "email", "alice@corp.test"));

    @Test
    void identifiesTheRequesterByTheConfiguredClaim() {
        assertThat(new MockAccessGovernance(FILE, "preferred_username", Clock.systemUTC()).requestsOf(ALICE))
                .extracting(AccessGovernance.AccessRequest::requestId).containsExactly("REQ-1");
        assertThat(new MockAccessGovernance(FILE, "email", Clock.systemUTC()).requestsOf(ALICE))
                .extracting(AccessGovernance.AccessRequest::requestId).containsExactly("REQ-2");
    }

    @Test
    void missingClaimIsAnAdapterError() {
        MockAccessGovernance iga = new MockAccessGovernance(FILE, "employee_id", Clock.systemUTC());
        assertThatThrownBy(() -> iga.requestsOf(ALICE)).isInstanceOf(IgaUnavailableException.class);
    }

    @Test
    void onlyAnEntitlementOfTheCatalogCanBeRequested() {
        MockAccessGovernance iga = new MockAccessGovernance(FILE, "preferred_username", Clock.systemUTC());
        assertThatThrownBy(() -> iga.request(ALICE, "mcp-platform-admin")).isInstanceOf(NotRequestableException.class);
    }

    @Test
    void newRequestsAreKeptForTheRequester() {
        MockAccessGovernance iga = new MockAccessGovernance(FILE, "preferred_username", Clock.systemUTC());
        AccessGovernance.RequestResult result = iga.request(ALICE, "mcp-jira-destructive");
        assertThat(result.requestId()).startsWith("REQ-MOCK-");
        assertThat(iga.requestsOf(ALICE)).extracting(AccessGovernance.AccessRequest::entitlement)
                .contains("mcp-jira-destructive");
    }
}
