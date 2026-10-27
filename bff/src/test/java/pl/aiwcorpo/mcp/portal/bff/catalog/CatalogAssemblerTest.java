package pl.aiwcorpo.mcp.portal.bff.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.util.List;

import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.iga.AccessGovernance.AccessRequest;
import pl.aiwcorpo.mcp.portal.bff.support.ContractSchemas;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerModel.Connection;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerModel.SystemInfo;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel.Catalog;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel.CatalogServer;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel.CatalogTool;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class CatalogAssemblerTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final CatalogAssembler ASSEMBLER = new CatalogAssembler(URI.create("https://mcp-gateway.internal/"));

    private static final List<SystemInfo> SYSTEMS = List.of(
            new SystemInfo("jira", List.of("user-oauth", "user-secret"), "user-secret", List.of()),
            new SystemInfo("confluence", List.of("user-oauth", "user-secret"), "user-secret", List.of()),
            new SystemInfo("gitlab", List.of("user-oauth", "user-secret"), "user-oauth", List.of("read_api", "api")),
            new SystemInfo("servicedesk", List.of("service-account"), "service-account", List.of()),
            new SystemInfo("opensearch", List.of("token-exchange"), "token-exchange", List.of()));

    private static CatalogTool tool(String name, String access, String... entitlements) {
        return new CatalogTool(name, "Description of " + name, "READ_ONLY", "read", access, List.of(entitlements));
    }

    private static CatalogServer server(String system, CatalogTool... tools) {
        return new CatalogServer("mcp-" + system, system, "1.0.0", List.of(tools));
    }

    private static Connection connection(String system, String status) {
        return new Connection(system, "user-secret", status, "alice", null, "2026-10-01T08:00:00Z", null);
    }

    private static AccessRequest pending(String entitlement) {
        return new AccessRequest("REQ-1", entitlement, "pending", "2026-10-25T09:00:00Z", null);
    }

    private static PortalCatalog.Server only(PortalCatalog catalog) {
        assertThat(catalog.servers()).hasSize(1);
        return catalog.servers().getFirst();
    }

    @Test
    void reproducesTheMixedExampleOfTheContract() {
        Catalog c5 = new Catalog(List.of(
                new CatalogServer("mcp-jira", "jira", "1.4.0", List.of(
                        new CatalogTool("jira__get_issue", "Returns one Jira issue by key.", "READ_ONLY", "read", "granted",
                                List.of("mcp-jira-read")),
                        new CatalogTool("jira__delete_issue", "Deletes an issue permanently.", "DESTRUCTIVE", "delete", "denied",
                                List.of("mcp-jira-destructive")))),
                new CatalogServer("mcp-gitlab", "gitlab", "1.0.0", List.of(
                        new CatalogTool("gitlab__get_project", "Returns one GitLab project by path.", "READ_ONLY", "read",
                                "granted", List.of("mcp-gitlab-read")))),
                new CatalogServer("mcp-confluence", "confluence", "1.0.0", List.of(
                        new CatalogTool("confluence__get_page", "Returns one Confluence page.", "READ_ONLY", "read", "denied",
                                List.of("mcp-confluence-read"))))));

        PortalCatalog result = ASSEMBLER.assemble(c5, List.of(connection("jira", "connected")), SYSTEMS,
                List.of(pending("mcp-confluence-read")));

        ContractSchemas c12 = ContractSchemas.openApi(ContractSchemas.PORTAL_BFF);
        JsonNode expected = c12.responseExample("GET", "/api/v1/catalog", 200, "mixed");
        assertThat(expected.isMissingNode()).isFalse();
        JsonNode actual = JSON.valueToTree(result);
        assertThat(actual).isEqualTo(expected);
    }

    @Test
    void connectionStatusesMapToCatalogStatuses() {
        Catalog c5 = new Catalog(List.of(server("jira", tool("jira__get_issue", "granted", "mcp-jira-read"))));
        assertThat(only(ASSEMBLER.assemble(c5, List.of(connection("jira", "expiring")), SYSTEMS, List.of())))
                .satisfies(s -> {
                    assertThat(s.status()).isEqualTo("expiring");
                    assertThat(s.actions()).containsExactly("copy_link", "reconnect", "disconnect");
                });
        for (String broken : List.of("expired", "revoked", "error", "something-new")) {
            assertThat(only(ASSEMBLER.assemble(c5, List.of(connection("jira", broken)), SYSTEMS, List.of())))
                    .satisfies(s -> {
                        assertThat(s.status()).as(broken).isEqualTo("reconnect_required");
                        assertThat(s.actions()).containsExactly("reconnect", "disconnect");
                    });
        }
        assertThat(only(ASSEMBLER.assemble(c5, List.of(), SYSTEMS, List.of())))
                .satisfies(s -> {
                    assertThat(s.status()).isEqualTo("not_connected");
                    assertThat(s.actions()).containsExactly("connect_oauth", "add_secret");
                });
    }

    @Test
    void systemsWithoutUserCredentialsAreConnected() {
        Catalog c5 = new Catalog(List.of(
                server("servicedesk", tool("servicedesk__get_ticket", "granted", "mcp-servicedesk-read")),
                server("opensearch", tool("opensearch__search", "granted", "mcp-opensearch-read"))));
        PortalCatalog result = ASSEMBLER.assemble(c5, List.of(), SYSTEMS, List.of());
        assertThat(result.servers()).allSatisfy(s -> {
            assertThat(s.status()).isEqualTo("connected");
            assertThat(s.actions()).containsExactly("copy_link");
        });
    }

    @Test
    void accessRulesComeBeforeConnectionRules() {
        Catalog c5 = new Catalog(List.of(server("jira",
                tool("jira__get_issue", "denied", "mcp-jira-read"),
                tool("jira__update_issue", "denied", "mcp-jira-write"))));

        PortalCatalog none = ASSEMBLER.assemble(c5, List.of(connection("jira", "connected")), SYSTEMS, List.of());
        assertThat(only(none).status()).isEqualTo("no_access");
        assertThat(only(none).actions()).containsExactly("request_access", "disconnect");

        PortalCatalog pendingOne = ASSEMBLER.assemble(c5, List.of(), SYSTEMS, List.of(pending("mcp-jira-read")));
        assertThat(only(pendingOne).status()).isEqualTo("request_pending");
        assertThat(only(pendingOne).actions()).containsExactly("request_access", "view_request");

        PortalCatalog pendingBoth = ASSEMBLER.assemble(c5, List.of(), SYSTEMS,
                List.of(pending("mcp-jira-read"), pending("mcp-jira-write")));
        assertThat(only(pendingBoth).actions()).containsExactly("view_request");

        PortalCatalog rejected = ASSEMBLER.assemble(c5, List.of(), SYSTEMS,
                List.of(new AccessRequest("REQ-2", "mcp-jira-read", "rejected", "2026-10-25T09:00:00Z", null)));
        assertThat(only(rejected).status()).isEqualTo("no_access");
    }

    @Test
    void deniedToolWithoutEntitlementsOffersNoRequest() {
        Catalog c5 = new Catalog(List.of(server("jira", tool("jira__get_issue", "denied"))));
        PortalCatalog result = ASSEMBLER.assemble(c5, List.of(), SYSTEMS, List.of());
        assertThat(only(result).status()).isEqualTo("no_access");
        assertThat(only(result).actions()).isEmpty();
    }

    @Test
    void systemUnknownToTheBrokerOffersNoConnectAction() {
        Catalog c5 = new Catalog(List.of(server("jira", tool("jira__get_issue", "granted", "mcp-jira-read"))));
        PortalCatalog result = ASSEMBLER.assemble(c5, List.of(), List.of(), List.of());
        assertThat(only(result).status()).isEqualTo("not_connected");
        assertThat(only(result).actions()).isEmpty();
        assertThat(only(result).url()).isEqualTo("https://mcp-gateway.internal/s/mcp-jira/mcp");
    }
}
