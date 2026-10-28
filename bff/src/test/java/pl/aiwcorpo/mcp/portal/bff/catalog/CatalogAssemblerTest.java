package pl.aiwcorpo.mcp.portal.bff.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import pl.aiwcorpo.mcp.portal.bff.config.DevMode;
import pl.aiwcorpo.mcp.portal.bff.config.PublicUrls;

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
    private static final CatalogAssembler ASSEMBLER = new CatalogAssembler(
            new PublicUrls(java.net.URI.create("https://mcp.aiwcorpo.pl/"), new DevMode(false)));

    private static final List<SystemInfo> SYSTEMS = List.of(
            new SystemInfo("jira", List.of("user-secret", "user-oauth"), "user-secret", List.of()),
            new SystemInfo("confluence", List.of("user-oauth", "user-secret"), "user-secret", List.of()),
            new SystemInfo("gitlab", List.of("user-oauth", "user-secret"), "user-oauth", List.of("read_api", "api")),
            new SystemInfo("servicedesk", List.of("service-account"), "service-account", List.of()),
            new SystemInfo("opensearch", List.of("token-exchange"), "token-exchange", List.of()));

    private static CatalogTool tool(String name, String access, String... entitlements) {
        return new CatalogTool(name, "Description of " + name, "READ_ONLY", "read", access, List.of(entitlements),
                null, null, null);
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
                                List.of("mcp-jira-read"), "Pobranie zgłoszenia", null, null),
                        new CatalogTool("jira__delete_issue", "Deletes an issue permanently.", "DESTRUCTIVE", "delete", "denied",
                                List.of("mcp-jira-destructive"), null, null, true))),
                new CatalogServer("mcp-gitlab", "gitlab", "1.0.0", List.of(
                        new CatalogTool("gitlab__get_project", "Returns one GitLab project by path.", "READ_ONLY", "read",
                                "granted", List.of("mcp-gitlab-read"), null, null, null))),
                new CatalogServer("mcp-confluence", "confluence", "1.0.0", List.of(
                        new CatalogTool("confluence__get_page", "Returns one Confluence page.", "READ_ONLY", "read", "denied",
                                List.of("mcp-confluence-read"), null, null, null)))));

        PortalCatalog result = ASSEMBLER.assemble(c5, List.of(new Connection("jira", "user-secret", "connected",
                        "jkowalski", "2027-01-31T00:00:00Z", "2026-10-01T08:00:00Z", "2026-10-26T19:58:00Z")), SYSTEMS,
                List.of(pending("mcp-confluence-read")));

        ContractSchemas c12 = ContractSchemas.openApi(ContractSchemas.PORTAL_BFF);
        JsonNode expected = c12.responseExample("GET", "/api/v1/catalog", 200, "mixed");
        assertThat(expected.isMissingNode()).isFalse();
        JsonNode actual = JSON.valueToTree(result);
        assertThat(actual).isEqualTo(expected);
    }

    @Test
    void reproducesTheStatesExampleOfTheContract() {
        // Every piece of the example (tools, connection, credential) goes in; the example must come out unchanged.
        ContractSchemas c12 = ContractSchemas.openApi(ContractSchemas.PORTAL_BFF);
        JsonNode expected = c12.responseExample("GET", "/api/v1/catalog", 200, "states");
        List<CatalogServer> servers = new ArrayList<>();
        List<Connection> connections = new ArrayList<>();
        List<SystemInfo> systems = new ArrayList<>();
        List<AccessRequest> requests = new ArrayList<>();
        for (JsonNode server : expected.get("servers")) {
            List<CatalogTool> tools = new ArrayList<>();
            for (JsonNode tool : server.get("tools")) {
                tools.add(JSON.treeToValue(tool, CatalogTool.class));
            }
            servers.add(new CatalogServer(server.get("serverId").asString(), server.get("system").asString(),
                    server.get("version").asString(), tools));
            if (server.hasNonNull("connection")) {
                connections.add(JSON.treeToValue(server.get("connection"), Connection.class));
            }
            JsonNode credential = server.get("credential");
            systems.add(new SystemInfo(server.get("system").asString(),
                    List.of(JSON.treeToValue(credential.get("supportedTypes"), String[].class)),
                    credential.get("defaultType").asString(), List.of()));
        }

        PortalCatalog result = ASSEMBLER.assemble(new Catalog(servers), connections, systems, requests);

        JsonNode actual = JSON.valueToTree(result);
        assertThat(actual).isEqualTo(expected);
    }

    static Stream<Arguments> actionVectors() throws IOException {
        Resource[] files = new PathMatchingResourcePatternResolver()
                .getResources("classpath*:mcp-contracts/test-vectors/catalog-actions/*.json");
        assertThat(files).hasSizeGreaterThanOrEqualTo(12);
        List<Arguments> result = new ArrayList<>();
        for (Resource file : files) {
            try (InputStream in = file.getInputStream()) {
                result.add(Arguments.of(file.getFilename(), JSON.readTree(in)));
            }
        }
        return result.stream();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("actionVectors")
    void matchesTheActionTableVectors(String name, JsonNode vector) {
        JsonNode in = vector.get("input");
        String status = in.get("status").asString();
        List<String> supported = new ArrayList<>();
        in.get("supportedTypes").forEach(type -> supported.add(type.asString()));
        String defaultType = supported.getFirst();
        SystemInfo system = new SystemInfo("jira", supported, defaultType, List.of());

        // Tools and requests that lead to the status of the vector.
        boolean noneGranted = status.equals("request_pending") || status.equals("no_access");
        List<CatalogTool> tools = new ArrayList<>();
        tools.add(tool("jira__get_issue", noneGranted ? "denied" : "granted", "mcp-jira-read"));
        if (in.get("someToolDenied").asBoolean()) {
            tools.add(tool("jira__update_issue", "denied", "mcp-jira-write"));
        }
        List<AccessRequest> requests = status.equals("request_pending") ? List.of(pending("mcp-jira-read")) : List.of();

        List<Connection> connections = List.of();
        if (in.get("hasConnection").asBoolean()) {
            String connectionStatus = switch (status) {
                case "expiring" -> "expiring";
                case "reconnect_required" -> "revoked";
                default -> "connected";
            };
            connections = List.of(new Connection("jira", in.get("connectionType").asString(), connectionStatus,
                    "alice", null, "2026-10-01T08:00:00Z", null));
        }

        PortalCatalog.Server server = only(ASSEMBLER.assemble(
                new Catalog(List.of(new CatalogServer("mcp-jira", "jira", "1.0.0", tools))), connections,
                List.of(system), requests));

        assertThat(server.status()).isEqualTo(status);
        List<String> expected = new ArrayList<>();
        vector.get("expected").get("actions").forEach(action -> expected.add(action.asString()));
        assertThat(server.actions()).containsExactlyInAnyOrderElementsOf(expected);
        assertThat(server.connection() != null).isEqualTo(in.get("hasConnection").asBoolean());
    }

    @Test
    void connectionStatusesMapToCatalogStatuses() {
        Catalog c5 = new Catalog(List.of(server("jira", tool("jira__get_issue", "granted", "mcp-jira-read"))));
        assertThat(only(ASSEMBLER.assemble(c5, List.of(connection("jira", "expiring")), SYSTEMS, List.of())))
                .satisfies(s -> {
                    assertThat(s.status()).isEqualTo("expiring");
                    assertThat(s.actions()).containsExactly("copy_link", "add_secret", "disconnect");
                });
        for (String broken : List.of("expired", "revoked", "error", "something-new")) {
            assertThat(only(ASSEMBLER.assemble(c5, List.of(connection("jira", broken)), SYSTEMS, List.of())))
                    .satisfies(s -> {
                        assertThat(s.status()).as(broken).isEqualTo("reconnect_required");
                        assertThat(s.actions()).containsExactly("add_secret", "disconnect");
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
        assertThat(only(none).actions()).containsExactly("request_access");

        PortalCatalog pendingOne = ASSEMBLER.assemble(c5, List.of(), SYSTEMS, List.of(pending("mcp-jira-read")));
        assertThat(only(pendingOne).status()).isEqualTo("request_pending");
        assertThat(only(pendingOne).actions()).containsExactly("view_request");

        PortalCatalog pendingBoth = ASSEMBLER.assemble(c5, List.of(), SYSTEMS,
                List.of(pending("mcp-jira-read"), pending("mcp-jira-write")));
        assertThat(only(pendingBoth).actions()).containsExactly("view_request");
        assertThat(only(pendingBoth).connection()).isNull();

        PortalCatalog rejected = ASSEMBLER.assemble(c5, List.of(), SYSTEMS,
                List.of(new AccessRequest("REQ-2", "mcp-jira-read", "rejected", "2026-10-25T09:00:00Z", null)));
        assertThat(only(rejected).status()).isEqualTo("no_access");
    }

    @Test
    void noAccessOffersTheRequestEvenWithoutNamedEntitlements() {
        // The table of CC-083 has no condition on requiredEntitlements; the IGA adapter decides what a request means.
        Catalog c5 = new Catalog(List.of(server("jira", tool("jira__get_issue", "denied"))));
        PortalCatalog result = ASSEMBLER.assemble(c5, List.of(), SYSTEMS, List.of());
        assertThat(only(result).status()).isEqualTo("no_access");
        assertThat(only(result).actions()).containsExactly("request_access");
    }

    @Test
    void systemUnknownToTheBrokerOffersNoConnectAction() {
        Catalog c5 = new Catalog(List.of(server("jira", tool("jira__get_issue", "granted", "mcp-jira-read"))));
        PortalCatalog result = ASSEMBLER.assemble(c5, List.of(), List.of(), List.of());
        assertThat(only(result).status()).isEqualTo("not_connected");
        assertThat(only(result).actions()).isEmpty();
        assertThat(only(result).credential()).isNull();
        assertThat(only(result).url()).isEqualTo("https://mcp.aiwcorpo.pl/s/mcp-jira/mcp");
    }
}
