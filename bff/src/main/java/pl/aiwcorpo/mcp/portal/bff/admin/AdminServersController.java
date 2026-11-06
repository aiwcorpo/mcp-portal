package pl.aiwcorpo.mcp.portal.bff.admin;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.admin.AdminOperations.Op;
import pl.aiwcorpo.mcp.portal.bff.admin.AdminOperations.Upstream;
import pl.aiwcorpo.mcp.portal.bff.upstream.AdminPreconditions;
import pl.aiwcorpo.mcp.portal.bff.upstream.AdminViews;
import pl.aiwcorpo.mcp.portal.bff.upstream.ContractValues;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import tools.jackson.databind.JsonNode;

/**
 * Servers of the gateway registry and the approval of their policies (C12 over C5, CC-234, CC-237 A5, A11, CC-239):
 * adding a server, changing its connection, removing it, and approving the policies and resource type declarations
 * that its manifest brought. Everything that adds a server, moves traffic or widens access needs a fresh MFA, the
 * gateway checks the same on the token.
 */
@RestController
class AdminServersController {

    private final AdminOperations operations;

    AdminServersController(AdminOperations operations) {
        this.operations = operations;
    }

    @GetMapping("/api/v1/admin/servers")
    ResponseEntity<Object> list(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        return operations.read(authentication, request, response,
                () -> Op.read(Upstream.GATEWAY, "/admin/v1/servers", AdminViews::servers));
    }

    @GetMapping("/api/v1/admin/servers/{serverId}")
    ResponseEntity<Object> get(@PathVariable String serverId, Authentication authentication, HttpServletRequest request,
                               HttpServletResponse response) {
        return operations.read(authentication, request, response, () -> {
            requireServerId(serverId);
            return Op.read(Upstream.GATEWAY, "/admin/v1/servers/{serverId}", AdminViews::server, serverId);
        });
    }

    @PostMapping("/api/v1/admin/servers")
    ResponseEntity<Object> create(@RequestBody(required = false) byte[] rawBody, Authentication authentication,
                                  HttpServletRequest request, HttpServletResponse response) {
        return operations.write(null, authentication, request, response, () -> {
            JsonNode body = AdminInput.serverCreate(rawBody);
            if (body == null) {
                throw ApiException.badRequest();
            }
            return new Op(Upstream.GATEWAY, HttpMethod.POST, "/admin/v1/servers", new Object[0], body,
                    AdminPreconditions.NONE, true, false, AdminViews::server, "server_rejected", "server_exists");
        });
    }

    @PatchMapping("/api/v1/admin/servers/{serverId}")
    ResponseEntity<Object> update(@PathVariable String serverId, @RequestBody(required = false) byte[] rawBody,
                                  Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        return operations.write(validOrNull(serverId), authentication, request, response, () -> {
            requireServerId(serverId);
            JsonNode body = AdminInput.serverPatch(rawBody);
            if (body == null) {
                throw ApiException.badRequest();
            }
            // Taking a server out of service must never wait for a second factor; every other change does (CC-240).
            return new Op(Upstream.GATEWAY, HttpMethod.PATCH, "/admin/v1/servers/{serverId}", new Object[] {serverId}, body,
                    AdminOperations.ifMatchRequired(request), !AdminInput.onlyDisables(body), false, AdminViews::server,
                    "server_rejected", null);
        });
    }

    /**
     * The C12 description shows no fresh MFA for the removal, but the gateway answers {@code step_up_required} to a token
     * that is not fresh (CC-239), so the portal asks first and the administrator is not sent back after the click.
     */
    @DeleteMapping("/api/v1/admin/servers/{serverId}")
    ResponseEntity<Object> delete(@PathVariable String serverId, Authentication authentication, HttpServletRequest request,
                                  HttpServletResponse response) {
        return operations.write(validOrNull(serverId), authentication, request, response, () -> {
            requireServerId(serverId);
            return new Op(Upstream.GATEWAY, HttpMethod.DELETE, "/admin/v1/servers/{serverId}", new Object[] {serverId}, null,
                    AdminPreconditions.NONE, true, false, null, null, null);
        });
    }

    @GetMapping("/api/v1/admin/registry/servers/{serverId}/policies/pending")
    ResponseEntity<Object> pendingPolicies(@PathVariable String serverId, Authentication authentication,
                                           HttpServletRequest request, HttpServletResponse response) {
        return operations.read(authentication, request, response, () -> {
            requireServerId(serverId);
            return Op.read(Upstream.GATEWAY, "/admin/v1/registry/servers/{serverId}/policies/pending",
                    AdminViews::pendingPolicies, serverId);
        });
    }

    /**
     * Approval unblocks the tools of a server whose policies changed, for everyone, so it has to come from the portal page
     * itself, as the approval of a tool definition does.
     */
    @PostMapping("/api/v1/admin/registry/servers/{serverId}/policies/approve")
    ResponseEntity<Object> approvePolicies(@PathVariable String serverId, @RequestBody(required = false) byte[] rawBody,
                                           Authentication authentication, HttpServletRequest request,
                                           HttpServletResponse response) {
        return operations.write(validOrNull(serverId), authentication, request, response, () -> {
            requireServerId(serverId);
            String hash = AdminInput.policiesHash(rawBody);
            if (hash == null) {
                throw ApiException.badRequest();
            }
            return new Op(Upstream.GATEWAY, HttpMethod.POST, "/admin/v1/registry/servers/{serverId}/policies/approve",
                    new Object[] {serverId}, AdminInput.object(rawBody), AdminPreconditions.NONE, true, true,
                    AdminViews::approveResult, null, "hash_mismatch");
        });
    }

    /** A server that cannot exist is a resource that is not there (the contract has no 400 for the path). */
    private static void requireServerId(String serverId) {
        if (!ContractValues.isServerId(serverId)) {
            throw AdminTargets.notFound();
        }
    }

    private static String validOrNull(String serverId) {
        return ContractValues.isServerId(serverId) ? serverId : null;
    }
}
