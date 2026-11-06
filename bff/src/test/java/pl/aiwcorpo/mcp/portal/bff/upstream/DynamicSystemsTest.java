package pl.aiwcorpo.mcp.portal.bff.upstream;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import pl.aiwcorpo.mcp.portal.bff.catalog.CatalogAssembler;
import pl.aiwcorpo.mcp.portal.bff.catalog.PortalCatalog;
import pl.aiwcorpo.mcp.portal.bff.config.DevMode;
import pl.aiwcorpo.mcp.portal.bff.config.PublicUrls;

/** No list of systems, servers or resource types in the BFF: the shapes of 7.0.0 decide, the runtime data fills them. */
class DynamicSystemsTest {

    @ParameterizedTest
    @ValueSource(strings = {"notes", "jira", "a1", "abcdefghijklmnopqrstuvwxyz01234"})
    void anyWellFormedSystemIdIsAccepted(String system) {
        assertThat(ContractValues.isSystemId(system)).isTrue();
        assertThat(ContractValues.isServerId("mcp-" + system)).isTrue();
        assertThat(ContractValues.QUALIFIED_TOOL.matcher(system + "__list_items").matches()).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "a", "Notes", "1notes", "no_tes", "no-tes", "gateway", "offboarding", "portal", "broker",
            "prometheus", "platform", "admin", "registry", "adapter", "internal", "ci", "abcdefghijklmnopqrstuvwxyz012345"})
    void aMalformedOrReservedSystemIdIsRefused(String system) {
        assertThat(ContractValues.isSystemId(system)).isFalse();
        assertThat(ContractValues.isServerId("mcp-" + system)).isFalse();
        assertThat(ContractValues.QUALIFIED_TOOL.matcher(system + "__list_items").matches()).isFalse();
    }

    @Test
    void aServerIdNeedsThePrefixAndAToolNeedsTwoUnderscores() {
        assertThat(ContractValues.isServerId("notes")).isFalse();
        assertThat(ContractValues.isServerId(null)).isFalse();
        assertThat(ContractValues.QUALIFIED_TOOL.matcher("notes_list").matches()).isFalse();
        assertThat(ContractValues.QUALIFIED_TOOL.matcher("notes__List").matches()).isFalse();
        assertThat(ContractValues.QUALIFIED_TOOL.matcher("notes__a_b2").matches()).isTrue();
    }

    @Test
    void resourceTypesAndScopesFollowTheShapeNotAList() {
        assertThat(ContractValues.RESOURCE_TYPE.matcher("Notes::Folder").matches()).isTrue();
        assertThat(ContractValues.RESOURCE_TYPE.matcher("notes::Folder").matches()).isFalse();
        assertThat(ContractValues.RESOURCE_TYPE.matcher("Notes::Folder::Deep").matches()).isFalse();
        assertThat(ContractValues.RESOURCE_SCOPE_ID.matcher("Notes::Folder/team-a").matches()).isTrue();
        assertThat(ContractValues.RESOURCE_SCOPE_ID.matcher("Notes::Folder/team a").matches()).isFalse();
    }

    @Test
    void aSystemOfTheBrokerAndItsToolsAreKeptWithoutBeingListedInTheCode() {
        List<BrokerModel.SystemInfo> systems = BrokerData.validSystems(List.of(
                new BrokerModel.SystemInfo("notes", List.of("user-oauth"), "user-oauth", List.of("notes.read"))));
        GatewayModel.Catalog catalog = BrokerData.validCatalog(new GatewayModel.Catalog(List.of(
                new GatewayModel.CatalogServer("mcp-notes", "notes", "1.0.0", List.of(
                        new GatewayModel.CatalogTool("notes__list_items", "x", "READ_ONLY", "read", "granted", List.of(), null,
                                null, null, null))),
                new GatewayModel.CatalogServer("mcp-other", "notes", "1.0.0", List.of()))));

        assertThat(systems).extracting(BrokerModel.SystemInfo::system).containsExactly("notes");
        assertThat(catalog.servers()).singleElement().satisfies(server ->
                assertThat(server.tools()).extracting(GatewayModel.CatalogTool::name).containsExactly("notes__list_items"));
    }

    @Test
    void aConnectionThatTheBrokerInvalidatedStaysNeedsReconnectAndTheCatalogAsksToConnectAgain() {
        List<BrokerModel.Connection> connections = BrokerData.validConnections(List.of(
                new BrokerModel.Connection("notes", "user-oauth", "needs_reconnect", "alice", null,
                        "2026-10-01T08:00:00Z", null)));
        assertThat(connections).singleElement().satisfies(c -> assertThat(c.status()).isEqualTo("needs_reconnect"));

        CatalogAssembler assembler = new CatalogAssembler(
                new PublicUrls(java.net.URI.create("https://mcp.aiwcorpo.pl/"), new DevMode(false)));
        PortalCatalog catalog = assembler.assemble(
                new GatewayModel.Catalog(List.of(new GatewayModel.CatalogServer("mcp-notes", "notes", "1.0.0", List.of(
                        new GatewayModel.CatalogTool("notes__list_items", "x", "READ_ONLY", "read", "granted", List.of(), null,
                                null, null, null))))),
                connections,
                List.of(new BrokerModel.SystemInfo("notes", List.of("user-oauth"), "user-oauth", List.of())),
                List.of());

        assertThat(catalog.servers()).singleElement().satisfies(server -> {
            assertThat(server.status()).isEqualTo("reconnect_required");
            assertThat(server.actions()).contains("reconnect", "disconnect");
        });
    }

    @Test
    void aResourceTypeOfAnyServerIsAcceptedInAConfirmationPreview() {
        GatewayModel.ConfirmationView view = new GatewayModel.ConfirmationView("c".repeat(20), "notes__delete_item", "notes",
                new GatewayModel.Resource("Notes::Folder", "team-a", null), List.of(), "2026-11-06T10:00:00Z");

        assertThat(GatewayData.validConfirmation(view, "c".repeat(20))).isNotNull();
    }

    private static final String HASH = "sha256:12573bd466924c3e35d2a79ca0c6257f4c7663c9d188510593b08dd3867220f8";

    private static tools.jackson.databind.JsonNode registryServer(String extra) {
        return tools.jackson.databind.json.JsonMapper.builder().build().readTree(
                "{\"serverId\":\"mcp-notes\",\"system\":\"notes\",\"version\":\"1.0.0\",\"tools\":[]" + extra + "}");
    }

    @Test
    void theRegistryShowsTheStateOfThePoliciesOfAnyServer() {
        assertThat(RegistryData.validRegistry(List.of(registryServer("")))).hasSize(1);
        assertThat(RegistryData.validRegistry(List.of(registryServer(",\"policiesStatus\":\"approved\",\"policiesHash\":\""
                + HASH + "\"")))).hasSize(1);
        assertThat(RegistryData.validRegistry(List.of(registryServer(",\"policiesStatus\":\"pending_approval\","
                + "\"pendingPoliciesHash\":\"" + HASH + "\"")))).hasSize(1);
        for (String broken : List.of(",\"policiesStatus\":\"pending_approval\"",
                ",\"policiesStatus\":\"approved\",\"pendingPoliciesHash\":\"" + HASH + "\"",
                ",\"policiesStatus\":\"unknown\"", ",\"pendingPoliciesHash\":\"" + HASH + "\"",
                ",\"policiesStatus\":\"approved\",\"policiesHash\":\"sha256:abc\"")) {
            assertThat(RegistryData.validRegistry(List.of(registryServer(broken)))).as(broken).isNull();
        }
    }

    private static tools.jackson.databind.JsonNode serverWithTool(String toolExtra) {
        return tools.jackson.databind.json.JsonMapper.builder().build().readTree(
                "{\"serverId\":\"mcp-notes\",\"system\":\"notes\",\"version\":\"1.0.0\",\"tools\":[{\"name\":\"list_notes\","
                        + "\"risk\":\"READ_ONLY\",\"action\":\"read\",\"resourceRefs\":[],"
                        + "\"definition\":{\"name\":\"list_notes\"},\"definitionHash\":\"" + HASH + "\",\"status\":\"approved\""
                        + toolExtra + "}]}");
    }

    @Test
    void aToolMayNameTheAdditionalGroupOfItsSystemAndNothingElse() {
        assertThat(RegistryData.validRegistry(List.of(serverWithTool("")))).hasSize(1);
        assertThat(RegistryData.validRegistry(List.of(serverWithTool(",\"additionalGroup\":\"mcp-notes-ops\"")))).hasSize(1);
        for (String broken : List.of(",\"additionalGroup\":\"ops\"", ",\"additionalGroup\":\"mcp-notes-\"",
                ",\"additionalGroup\":7", ",\"additionalGroup\":\"mcp-notes-" + "x".repeat(70) + "\"")) {
            assertThat(RegistryData.validRegistry(List.of(serverWithTool(broken)))).as(broken).isNull();
        }
    }
}
