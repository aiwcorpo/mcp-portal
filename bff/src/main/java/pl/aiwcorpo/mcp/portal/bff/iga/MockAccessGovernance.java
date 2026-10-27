package pl.aiwcorpo.mcp.portal.bff.iga;

import java.io.IOException;
import java.io.InputStream;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.core.io.Resource;

import tools.jackson.dataformat.yaml.YAMLMapper;

/**
 * Adapter {@code mock} of C13 for mcp-platform-dev only: entitlements and requests from a YAML file outside the jar,
 * new requests kept in memory until restart. A request belongs to the user whose identity claim
 * {@code requesterIdClaim} equals the entry's {@code user}; a login without that claim is an adapter error.
 */
public class MockAccessGovernance implements AccessGovernance {

    private final Map<String, List<String>> entitlements;
    private final List<MockRequest> requests;
    private final String requesterIdClaim;
    private final Clock clock;
    private final AtomicInteger sequence = new AtomicInteger(9000);

    public MockAccessGovernance(Resource file, String requesterIdClaim, Clock clock) {
        MockFile content = load(file);
        this.entitlements = content.entitlements() == null ? Map.of() : Map.copyOf(content.entitlements());
        this.requests = new CopyOnWriteArrayList<>(content.requests() == null ? List.of() : content.requests());
        this.requesterIdClaim = requesterIdClaim;
        this.clock = clock;
    }

    private static MockFile load(Resource file) {
        try (InputStream in = file.getInputStream()) {
            return new YAMLMapper().readValue(in, MockFile.class);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read IGA mock file " + file.getDescription(), e);
        }
    }

    @Override
    public List<String> catalog(String system) {
        return entitlements.getOrDefault(system, List.of());
    }

    @Override
    public List<AccessRequest> requestsOf(Requester requester) {
        String id = requesterId(requester);
        List<AccessRequest> result = new ArrayList<>();
        for (MockRequest request : requests) {
            if (id.equals(request.user())) {
                result.add(new AccessRequest(request.requestId(), request.entitlement(), request.status(),
                        request.createdAt(), request.requestUrl()));
            }
        }
        return result;
    }

    @Override
    public RequestResult request(Requester requester, String entitlement) {
        String id = "REQ-MOCK-" + sequence.incrementAndGet();
        requests.add(new MockRequest(requesterId(requester), id, entitlement, "pending",
                clock.instant().truncatedTo(ChronoUnit.SECONDS).toString(), null));
        return new RequestResult(null, id);
    }

    private String requesterId(Requester requester) {
        Object value = requester.claims() == null ? null : requester.claims().get(requesterIdClaim);
        if (!(value instanceof String id) || id.isBlank()) {
            throw new IgaUnavailableException("login has no claim " + requesterIdClaim + " to identify the IGA requester");
        }
        return id;
    }

    record MockFile(Map<String, List<String>> entitlements, List<MockRequest> requests) {
    }

    /** @param user value of the configured requester claim (preferred_username by default) */
    record MockRequest(String user, String requestId, String entitlement, String status, String createdAt,
                       String requestUrl) {
    }
}
