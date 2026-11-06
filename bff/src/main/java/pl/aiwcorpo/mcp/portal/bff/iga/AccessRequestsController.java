package pl.aiwcorpo.mcp.portal.bff.iga;

import java.util.List;
import java.util.Set;

import com.fasterxml.jackson.annotation.JsonInclude;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.config.DevMode;
import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.upstream.ContractValues;
import pl.aiwcorpo.mcp.portal.bff.web.ApiError;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import pl.aiwcorpo.mcp.portal.bff.web.StrictJson;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectReader;

/**
 * Access requests through the C13 port (CC-096, CC-154). The requester is the logged-in user, never a value from the
 * browser. A request is accepted only for an entitlement that the IGA catalog lists and the user does not hold yet
 * (so the portal cannot be used to ask for {@code mcp-platform-admin}); one already pending for it is returned instead
 * of a second one.
 */
@RestController
class AccessRequestsController {

    private static final String NOT_REQUESTABLE = "not_requestable";

    private final AccessGovernance iga;
    private final boolean allowPlainHttp;
    private final ObjectReader createReader = StrictJson.builder().build()
            .readerFor(CreateBody.class)
            .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    AccessRequestsController(AccessGovernance iga, DevMode devMode) {
        this.iga = iga;
        this.allowPlainHttp = devMode.enabled();
    }

    @GetMapping("/api/v1/access-requests")
    List<AccessGovernance.AccessRequest> list(Authentication authentication) {
        PortalUser user = PortalUser.from(authentication);
        return IgaData.validRequests(iga.requestsOf(requester(user)), allowPlainHttp);
    }

    @GetMapping("/api/v1/access-requests/entitlements")
    List<RequestableEntitlement> requestable(Authentication authentication, HttpServletRequest request) {
        PortalUser user = PortalUser.from(authentication);
        String[] systems = request.getParameterValues("system");
        if (systems == null || systems.length != 1 || !ContractValues.isSystemId(systems[0])) {
            throw ApiException.badRequest();
        }
        if (!iga.supportsRequests()) {
            throw notRequestable();
        }
        try {
            return IgaData.requestable(systems[0], iga.catalog(systems[0]), user.groups()).stream()
                    .map(e -> new RequestableEntitlement(e.name(), e.description())).toList();
        } catch (NotRequestableException e) {
            throw notRequestable();
        }
    }

    /** The body is parsed here, not bound by Spring, so that a parse error is the plain 400 of the contract. */
    @PostMapping("/api/v1/access-requests")
    ResponseEntity<Object> create(@RequestBody(required = false) byte[] rawBody, Authentication authentication) {
        PortalUser user = PortalUser.from(authentication);
        String entitlement = parse(rawBody);
        AccessGovernance.Requester requester = requester(user);
        for (AccessGovernance.AccessRequest existing : IgaData.validRequests(iga.requestsOf(requester), allowPlainHttp)) {
            if (existing.pending() && existing.entitlement().equals(entitlement)) {
                return ResponseEntity.ok(new AccessGovernance.RequestResult(null, existing.requestId()));
            }
        }
        if (!listed(entitlement, user.groups())) {
            throw notRequestable();
        }
        AccessGovernance.RequestResult result;
        try {
            result = IgaData.validResult(iga.request(requester, entitlement), allowPlainHttp);
        } catch (NotRequestableException e) {
            throw notRequestable();
        }
        if (result == null) {
            throw new IgaUnavailableException("IGA answered a request with something outside C12 AccessRequestResult");
        }
        return ResponseEntity.ok(result);
    }

    private boolean listed(String entitlement, Set<String> held) {
        if (held.contains(entitlement) || !iga.supportsRequests()) {
            return false;
        }
        for (String system : iga.systems()) {
            for (AccessGovernance.Entitlement listed : iga.catalog(system)) {
                if (listed != null && IgaData.belongsTo(system, entitlement) && entitlement.equals(listed.name())) {
                    return true;
                }
            }
        }
        return false;
    }

    private String parse(byte[] rawBody) {
        if (rawBody == null || rawBody.length == 0) {
            throw ApiException.badRequest();
        }
        try {
            CreateBody body = createReader.readValue(rawBody);
            if (body == null || !IgaData.validEntitlement(body.entitlement())) {
                throw ApiException.badRequest();
            }
            return body.entitlement();
        } catch (JacksonException e) {
            throw ApiException.badRequest();
        }
    }

    private static AccessGovernance.Requester requester(PortalUser user) {
        return new AccessGovernance.Requester(user.sub(), user.username(), user.email(), user.claims());
    }

    private static ApiException notRequestable() {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiError.of(NOT_REQUESTABLE));
    }

    record CreateBody(String entitlement) {
    }

    /** C12 {@code RequestableEntitlement}. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record RequestableEntitlement(String entitlement, String description) {
    }
}
