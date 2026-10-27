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
 * Adapter {@code mock} of C13: entitlements and requests from a YAML file, new requests kept in memory until
 * restart. Requests match the user by {@code sub} or by login, because dev realms get new {@code sub} values on
 * every import.
 */
public class MockAccessGovernance implements AccessGovernance {

    private final Map<String, List<String>> entitlements;
    private final List<MockRequest> requests;
    private final Clock clock;
    private final AtomicInteger sequence = new AtomicInteger(9000);

    public MockAccessGovernance(Resource file, Clock clock) {
        MockFile content = load(file);
        this.entitlements = content.entitlements() == null ? Map.of() : Map.copyOf(content.entitlements());
        this.requests = new CopyOnWriteArrayList<>(content.requests() == null ? List.of() : content.requests());
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
        List<AccessRequest> result = new ArrayList<>();
        for (MockRequest request : requests) {
            if (request.user() != null && (request.user().equals(requester.sub()) || request.user().equals(requester.username()))) {
                result.add(new AccessRequest(request.requestId(), request.entitlement(), request.status(),
                        request.createdAt(), request.requestUrl()));
            }
        }
        return result;
    }

    @Override
    public RequestResult request(Requester requester, String entitlement) {
        String id = "REQ-MOCK-" + sequence.incrementAndGet();
        requests.add(new MockRequest(requester.sub(), id, entitlement, "pending",
                clock.instant().truncatedTo(ChronoUnit.SECONDS).toString(), null));
        return new RequestResult(null, id);
    }

    record MockFile(Map<String, List<String>> entitlements, List<MockRequest> requests) {
    }

    /** @param user login or {@code sub} of the requester */
    record MockRequest(String user, String requestId, String entitlement, String status, String createdAt,
                       String requestUrl) {
    }
}
