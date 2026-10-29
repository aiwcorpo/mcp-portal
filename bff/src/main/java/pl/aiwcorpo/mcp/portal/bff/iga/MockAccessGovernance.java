package pl.aiwcorpo.mcp.portal.bff.iga;

import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.core.io.Resource;

/**
 * Adapter {@code mock} of C13 for mcp-platform-dev only: entitlements and requests from a YAML file outside the jar,
 * new requests kept in memory until restart. A request belongs to the user whose identity claim
 * {@code requesterIdClaim} equals the entry's {@code user}; a login without that claim is an adapter error. Only an
 * entitlement of the catalog can be requested.
 */
public class MockAccessGovernance implements AccessGovernance {

    private final Map<String, List<Entitlement>> catalog;
    private final List<MockRequest> requests;
    private final String requesterIdClaim;
    private final Clock clock;
    private final AtomicInteger sequence = new AtomicInteger(9000);

    public MockAccessGovernance(Resource file, String requesterIdClaim, Clock clock) {
        MockFile content = CatalogFile.read(file, MockFile.class);
        this.catalog = new CatalogFile(content.entitlements(), content.descriptions()).catalog();
        this.requests = new CopyOnWriteArrayList<>(content.requests() == null ? List.of() : content.requests());
        this.requesterIdClaim = requesterIdClaim;
        this.clock = clock;
    }

    @Override
    public List<Entitlement> catalog(String system) {
        return catalog.getOrDefault(system, List.of());
    }

    @Override
    public List<AccessRequest> requestsOf(Requester requester) {
        String id = requesterId(requester);
        List<AccessRequest> result = new ArrayList<>();
        for (MockRequest request : requests) {
            if (id.equals(request.user())) {
                result.add(new AccessRequest(request.requestId(), request.entitlement(), request.status(),
                        request.createdAt(), request.decidedAt(), request.requestUrl()));
            }
        }
        return result;
    }

    @Override
    public RequestResult request(Requester requester, String entitlement) {
        String id = requesterId(requester);
        boolean known = catalog.values().stream()
                .anyMatch(entitlements -> entitlements.stream().anyMatch(e -> e.name().equals(entitlement)));
        if (!known) {
            throw new NotRequestableException();
        }
        String requestId = "REQ-MOCK-" + sequence.incrementAndGet();
        requests.add(new MockRequest(id, requestId, entitlement, "pending",
                clock.instant().truncatedTo(ChronoUnit.SECONDS).toString(), null, null));
        return new RequestResult(null, requestId);
    }

    private String requesterId(Requester requester) {
        Object value = requester.claims() == null ? null : requester.claims().get(requesterIdClaim);
        if (!(value instanceof String id) || id.isBlank()) {
            throw new IgaUnavailableException("login has no claim " + requesterIdClaim + " to identify the IGA requester");
        }
        return id;
    }

    record MockFile(Map<String, List<String>> entitlements, Map<String, String> descriptions,
                    List<MockRequest> requests) {
    }

    /** @param user value of the configured requester claim (preferred_username by default) */
    record MockRequest(String user, String requestId, String entitlement, String status, String createdAt,
                       String decidedAt, String requestUrl) {
    }
}
