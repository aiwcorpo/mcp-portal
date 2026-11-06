package pl.aiwcorpo.mcp.portal.bff.admin;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.admin.AdminOperations.Op;
import pl.aiwcorpo.mcp.portal.bff.admin.AdminOperations.Upstream;
import pl.aiwcorpo.mcp.portal.bff.upstream.AdminViews;
import pl.aiwcorpo.mcp.portal.bff.upstream.ContractValues;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import tools.jackson.databind.JsonNode;

/**
 * Systems of the credential broker (C12 over C4, CC-235, CC-238): where a system points, how users connect to it, and the
 * OAuth client of the broker. The client secret travels from the browser to the broker in the body of the write and
 * is in no answer, no log and no audit event. Writing and removing need a fresh MFA; the broker checks it on the token.
 * A change of an address invalidates the connections of every user of the system, which the broker reports as
 * {@code needs_reconnect} and the catalog as {@code reconnect_required}.
 */
@RestController
class AdminSystemsController {

    private final AdminOperations operations;

    AdminSystemsController(AdminOperations operations) {
        this.operations = operations;
    }

    @GetMapping("/api/v1/admin/systems")
    ResponseEntity<Object> list(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        return operations.read(authentication, request, response,
                () -> Op.read(Upstream.BROKER, "/v1/admin/systems", AdminViews::systems));
    }

    @GetMapping("/api/v1/admin/systems/{system}")
    ResponseEntity<Object> get(@PathVariable String system, Authentication authentication, HttpServletRequest request,
                               HttpServletResponse response) {
        return operations.read(authentication, request, response, () -> {
            requireSystemId(system);
            return Op.read(Upstream.BROKER, "/v1/admin/systems/{system}", AdminViews::system, system);
        });
    }

    @PutMapping("/api/v1/admin/systems/{system}")
    ResponseEntity<Object> put(@PathVariable String system, Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        return operations.write(null, authentication, request, response, () -> {
            requireSystemId(system);
            JsonNode body = AdminInput.systemRequest(AdminBody.read(request));
            if (body == null) {
                throw ApiException.badRequest();
            }
            return new Op(Upstream.BROKER, HttpMethod.PUT, "/v1/admin/systems/{system}", new Object[] {system}, body,
                    AdminOperations.createOrReplace(request), true, false, AdminViews::system, "system_rejected", null);
        });
    }

    @DeleteMapping("/api/v1/admin/systems/{system}")
    ResponseEntity<Object> delete(@PathVariable String system, Authentication authentication, HttpServletRequest request,
                                  HttpServletResponse response) {
        return operations.write(null, authentication, request, response, () -> {
            requireSystemId(system);
            return new Op(Upstream.BROKER, HttpMethod.DELETE, "/v1/admin/systems/{system}", new Object[] {system}, null,
                    AdminOperations.ifMatchRequired(request), true, false, null, null, null);
        });
    }

    /** An id that does not fit the pattern is a malformed request, never a missing resource (CC-243). */
    private static void requireSystemId(String system) {
        if (!ContractValues.isSystemId(system)) {
            throw ApiException.badRequest();
        }
    }
}
