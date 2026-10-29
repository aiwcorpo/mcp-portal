package pl.aiwcorpo.mcp.portal.bff.iga;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.core.io.Resource;

import tools.jackson.dataformat.yaml.YAMLMapper;

/**
 * Entitlements per system from a YAML file: {@code entitlements: {jira: [mcp-jira-read, ...]}} and an optional
 * {@code descriptions: {mcp-jira-read: "text"}}. Used by the {@code mock} adapter and by {@code keycloak-groups}.
 */
record CatalogFile(Map<String, List<String>> entitlements, Map<String, String> descriptions) {

    Map<String, List<AccessGovernance.Entitlement>> catalog() {
        Map<String, List<AccessGovernance.Entitlement>> result = new HashMap<>();
        if (entitlements != null) {
            entitlements.forEach((system, names) -> result.put(system, names == null ? List.of() : names.stream()
                    .map(name -> new AccessGovernance.Entitlement(name, descriptions == null ? null : descriptions.get(name)))
                    .toList()));
        }
        return Map.copyOf(result);
    }

    static <T> T read(Resource file, Class<T> type) {
        try (InputStream in = file.getInputStream()) {
            return new YAMLMapper().readValue(in, type);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read IGA data file " + file.getDescription(), e);
        }
    }
}
