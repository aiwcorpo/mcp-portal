package pl.aiwcorpo.mcp.portal.bff.admin;

import java.util.ArrayList;
import java.util.List;

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
import pl.aiwcorpo.mcp.portal.bff.upstream.AdminPreconditions;
import pl.aiwcorpo.mcp.portal.bff.upstream.AdminViews;
import pl.aiwcorpo.mcp.portal.bff.upstream.ContractValues;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import tools.jackson.databind.JsonNode;

/**
 * The service account key of a system (C12 over C4, CC-251). It is write only: the value, or the login and password of
 * a Basic system, travel from the browser to the broker in the body of the write and are in no answer, no log and no
 * audit event of the portal. Setting and removing need a fresh MFA, because the key gives the platform access to the
 * system without a user; the broker checks it on the token as well. Last write wins, so there is no {@code If-Match}.
 */
@RestController
class AdminServiceAccountKeyController {

    private static final String KEY = "/v1/admin/systems/{system}/service-account-key";

    private final AdminOperations operations;

    AdminServiceAccountKeyController(AdminOperations operations) {
        this.operations = operations;
    }

    @GetMapping("/api/v1/admin/systems/{system}/service-account-key")
    ResponseEntity<Object> get(@PathVariable String system, Authentication authentication, HttpServletRequest request,
                               HttpServletResponse response) {
        return operations.read(authentication, request, response, () -> {
            requireSystemId(system);
            return Op.read(Upstream.BROKER, KEY, AdminViews::serviceAccountKeyStatus, system);
        });
    }

    @PutMapping("/api/v1/admin/systems/{system}/service-account-key")
    ResponseEntity<Object> put(@PathVariable String system, Authentication authentication, HttpServletRequest request,
                               HttpServletResponse response) {
        return operations.write(null, authentication, request, response, () -> {
            requireSystemId(system);
            JsonNode body = AdminInput.serviceAccountKeyRequest(AdminBody.read(request));
            if (body == null) {
                throw ApiException.badRequest();
            }
            return new Op(Upstream.BROKER, HttpMethod.PUT, KEY, new Object[] {system}, body, AdminPreconditions.NONE, true,
                    false, AdminViews::serviceAccountKeyStatus, "service_account_key_rejected", null, null, secretsOf(body));
        });
    }

    @DeleteMapping("/api/v1/admin/systems/{system}/service-account-key")
    ResponseEntity<Object> delete(@PathVariable String system, Authentication authentication, HttpServletRequest request,
                                  HttpServletResponse response) {
        return operations.write(null, authentication, request, response, () -> {
            requireSystemId(system);
            return new Op(Upstream.BROKER, HttpMethod.DELETE, KEY, new Object[] {system}, null, AdminPreconditions.NONE,
                    true, false, null, null, null);
        });
    }

    private static List<String> secretsOf(JsonNode body) {
        List<String> secrets = new ArrayList<>();
        for (String field : List.of("value", "username", "password")) {
            if (body.has(field)) {
                secrets.add(body.get(field).asString());
            }
        }
        return secrets;
    }

    /** An id that does not fit the pattern is a malformed request, never a missing resource (CC-243). */
    private static void requireSystemId(String system) {
        if (!ContractValues.isSystemId(system)) {
            throw ApiException.badRequest();
        }
    }
}
