package pl.aiwcorpo.mcp.portal.bff.iga;

import java.util.List;
import java.util.Map;

import org.springframework.core.io.Resource;

/**
 * Adapter {@code keycloak-groups} of C13: the entitlements are the Keycloak groups of the platform, there is no request
 * flow. The catalog is read from a file the deployment keeps next to the realm (the portal has no credential to list
 * groups through the Keycloak admin API), requests are always empty and {@link #request} always refuses.
 */
public class KeycloakGroupsAccessGovernance implements AccessGovernance {

    private final Map<String, List<Entitlement>> catalog;

    public KeycloakGroupsAccessGovernance(Resource catalogFile) {
        CatalogFile content = CatalogFile.read(catalogFile, CatalogFile.class);
        if (content.entitlements() == null || content.entitlements().isEmpty()) {
            throw new IllegalStateException("IGA catalog file " + catalogFile.getDescription() + " lists no entitlements");
        }
        this.catalog = content.catalog();
    }

    @Override
    public boolean supportsRequests() {
        return false;
    }

    @Override
    public java.util.Set<String> systems() {
        return catalog.keySet();
    }

    @Override
    public List<Entitlement> catalog(String system) {
        return catalog.getOrDefault(system, List.of());
    }

    @Override
    public List<AccessRequest> requestsOf(Requester requester) {
        return List.of();
    }

    @Override
    public RequestResult request(Requester requester, String entitlement) {
        throw new NotRequestableException();
    }
}
