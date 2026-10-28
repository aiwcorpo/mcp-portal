package pl.aiwcorpo.mcp.portal.bff.upstream;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

class BrokerDataTest {

    @Test
    void aDefaultTypeOutsideTheSupportedTypesDropsTheSystem() {
        List<BrokerModel.SystemInfo> valid = BrokerData.validSystems(List.of(
                new BrokerModel.SystemInfo("jira", List.of("user-secret"), "user-secret", List.of()),
                new BrokerModel.SystemInfo("confluence", List.of("user-secret"), null, List.of()),
                new BrokerModel.SystemInfo("gitlab", List.of("user-oauth"), "something-new", List.of()),
                new BrokerModel.SystemInfo("opensearch", List.of("token-exchange"), "user-oauth", List.of())));

        assertThat(valid).extracting(BrokerModel.SystemInfo::system).containsExactly("jira");
    }

    @Test
    void unknownSupportedTypesAreFilteredBeforeTheDefaultIsChecked() {
        List<BrokerModel.SystemInfo> valid = BrokerData.validSystems(List.of(
                new BrokerModel.SystemInfo("jira", List.of("user-secret", "something-new"), "user-secret", List.of())));

        assertThat(valid).singleElement().satisfies(system ->
                assertThat(system.supportedTypes()).containsExactly("user-secret"));
    }
}
