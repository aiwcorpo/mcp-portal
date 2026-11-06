package pl.aiwcorpo.mcp.portal.bff.admin;

import java.util.regex.Pattern;

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

import pl.aiwcorpo.mcp.portal.bff.admin.AdminOperations.AuditRef;
import pl.aiwcorpo.mcp.portal.bff.admin.AdminOperations.Op;
import pl.aiwcorpo.mcp.portal.bff.admin.AdminOperations.Upstream;
import pl.aiwcorpo.mcp.portal.bff.upstream.AdminPreconditions;
import pl.aiwcorpo.mcp.portal.bff.upstream.AdminViews;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import tools.jackson.databind.JsonNode;

/**
 * The scope mapping (which group grants which resource scopes) and the emergency overrides (C12 over C5, CC-234,
 * CC-237 A11): both are data of the administrator that servers read, so a change takes effect on every server within
 * seconds. The mapping, the removal of an override and the replacement of one need a fresh MFA (a weaker text widens
 * access); creating an override does not, because it can only forbid and an incident must not wait for a second factor.
 */
@RestController
class AdminPolicyController {

    private static final Pattern OVERRIDE_ID = Pattern.compile("^override-[a-z0-9][a-z0-9-]{0,54}$");

    private final AdminOperations operations;

    AdminPolicyController(AdminOperations operations) {
        this.operations = operations;
    }

    @GetMapping("/api/v1/admin/policy/scope-mapping")
    ResponseEntity<Object> scopeMapping(Authentication authentication, HttpServletRequest request,
                                        HttpServletResponse response) {
        return operations.read(authentication, request, response,
                () -> Op.read(Upstream.GATEWAY, "/admin/v1/policy/scope-mapping", AdminViews::scopeMapping));
    }

    @PutMapping("/api/v1/admin/policy/scope-mapping")
    ResponseEntity<Object> putScopeMapping(Authentication authentication, HttpServletRequest request,
                                           HttpServletResponse response) {
        return operations.write(null, authentication, request, response, () -> {
            JsonNode body = AdminInput.scopeMapping(AdminBody.read(request));
            if (body == null) {
                throw ApiException.badRequest();
            }
            return new Op(Upstream.GATEWAY, HttpMethod.PUT, "/admin/v1/policy/scope-mapping", new Object[0], body,
                    AdminOperations.ifMatchRequired(request), true, false, AdminViews::scopeMapping,
                    "scope_mapping_rejected", null);
        });
    }

    @GetMapping("/api/v1/admin/policy/overrides")
    ResponseEntity<Object> overrides(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        return operations.read(authentication, request, response,
                () -> Op.read(Upstream.GATEWAY, "/admin/v1/policy/overrides", AdminViews::overrides));
    }

    @GetMapping("/api/v1/admin/policy/overrides/{id}")
    ResponseEntity<Object> override(@PathVariable String id, Authentication authentication, HttpServletRequest request,
                                    HttpServletResponse response) {
        return operations.read(authentication, request, response, () -> {
            requireOverrideId(id);
            return Op.read(Upstream.GATEWAY, "/admin/v1/policy/overrides/{id}", AdminViews::override, id);
        });
    }

    @PutMapping("/api/v1/admin/policy/overrides/{id}")
    ResponseEntity<Object> putOverride(@PathVariable String id, Authentication authentication, HttpServletRequest request,
                                       HttpServletResponse response) {
        return operations.write(null, validOrNull(id), authentication, request, response, () -> {
            requireOverrideId(id);
            JsonNode body = AdminInput.override(AdminBody.read(request));
            if (body == null) {
                throw ApiException.badRequest();
            }
            AdminPreconditions preconditions = AdminOperations.createOrReplace(request);
            // A replace can weaken a text that forbids something, which widens access like a removal (CC-243); a create cannot.
            return new Op(Upstream.GATEWAY, HttpMethod.PUT, "/admin/v1/policy/overrides/{id}", new Object[] {id}, body,
                    preconditions, preconditions.ifMatch() != null, false, AdminViews::override, "override_rejected", null,
                    new AuditRef(id, body.get("target").asString(), sha256(body.get("text").asString())));
        });
    }

    @DeleteMapping("/api/v1/admin/policy/overrides/{id}")
    ResponseEntity<Object> deleteOverride(@PathVariable String id, Authentication authentication,
                                          HttpServletRequest request, HttpServletResponse response) {
        return operations.write(null, validOrNull(id), authentication, request, response, () -> {
            requireOverrideId(id);
            return new Op(Upstream.GATEWAY, HttpMethod.DELETE, "/admin/v1/policy/overrides/{id}", new Object[] {id}, null,
                    AdminOperations.ifMatchRequired(request), true, false, null, null, null);
        });
    }

    private static String validOrNull(String id) {
        return OVERRIDE_ID.matcher(id).matches() ? id : null;
    }

    /** {@code DefinitionHash} form of the SHA-256 of the text: the audit event names the text without carrying it. */
    private static String sha256(String text) {
        try {
            return "sha256:" + java.util.HexFormat.of().formatHex(
                    java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is part of every Java runtime", e);
        }
    }

    /** An id that does not fit the pattern is a malformed request, never a missing resource (CC-243). */
    private static void requireOverrideId(String id) {
        if (!OVERRIDE_ID.matcher(id).matches()) {
            throw ApiException.badRequest();
        }
    }
}
