package pl.aiwcorpo.mcp.portal.bff.iga;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;

class KeycloakGroupsAccessGovernanceTest {

    private final KeycloakGroupsAccessGovernance iga = new KeycloakGroupsAccessGovernance(new ByteArrayResource("""
            entitlements:
              jira: [mcp-jira-read, mcp-jira-write]
            descriptions:
              mcp-jira-read: Read access to Jira
            """.getBytes(StandardCharsets.UTF_8)));

    private static final AccessGovernance.Requester ALICE =
            new AccessGovernance.Requester("sub-a", "alice", null, Map.of("preferred_username", "alice"));

    @Test
    void theCatalogIsTheConfiguredGroupsAndThereAreNoRequests() {
        assertThat(iga.catalog("jira")).extracting(AccessGovernance.Entitlement::name)
                .containsExactly("mcp-jira-read", "mcp-jira-write");
        assertThat(iga.catalog("jira").getFirst().description()).isEqualTo("Read access to Jira");
        assertThat(iga.catalog("gitlab")).isEmpty();
        assertThat(iga.requestsOf(ALICE)).isEmpty();
    }

    @Test
    void aRequestIsNeverPossible() {
        assertThatThrownBy(() -> iga.request(ALICE, "mcp-jira-read")).isInstanceOf(NotRequestableException.class);
    }

    @Test
    void thisAdapterHasNoRequestFlow() {
        assertThat(iga.supportsRequests()).isFalse();
    }

    @Test
    void aMisspelledKeyOrAnEmptyCatalogStopsTheStart() {
        assertThatThrownBy(() -> new KeycloakGroupsAccessGovernance(new ByteArrayResource(
                "entitlement:\n  jira: [mcp-jira-read]\n".getBytes(StandardCharsets.UTF_8))))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new KeycloakGroupsAccessGovernance(new ByteArrayResource(
                "descriptions: {}\n".getBytes(StandardCharsets.UTF_8)))).isInstanceOf(IllegalStateException.class);
    }
}
