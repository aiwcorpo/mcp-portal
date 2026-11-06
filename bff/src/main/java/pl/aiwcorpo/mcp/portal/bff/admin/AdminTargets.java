package pl.aiwcorpo.mcp.portal.bff.admin;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;

import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.upstream.ContractValues;
import pl.aiwcorpo.mcp.portal.bff.upstream.RegistryData;
import pl.aiwcorpo.mcp.portal.bff.web.ApiError;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;

/** What the registry and kill switch controllers agree on: who is an admin, which server ids and tool names can exist (by pattern: the registry itself is the gateway's), which answers a miss gets. */
final class AdminTargets {

    private AdminTargets() {
    }

    static void requireAdmin(Authentication authentication) {
        if (!PortalUser.from(authentication).isAdmin()) {
            throw forbidden();
        }
    }

    /** A server or tool that cannot exist is a resource that is not there (the contract has no 400 for these paths). */
    static void requireTarget(String serverId, String tool) {
        if (!ContractValues.isServerId(serverId) || validTool(tool).isEmpty()) {
            throw notFound();
        }
    }

    /** The tool name when it is a {@code ToolName}, otherwise the empty string (an audit event leaves the field out). */
    static String validTool(String tool) {
        return tool != null && tool.length() <= 64 && RegistryData.TOOL_NAME.matcher(tool).matches() ? tool : "";
    }

    static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, ApiError.of(ApiError.NOT_FOUND_OR_DENIED));
    }

    static ApiException forbidden() {
        return new ApiException(HttpStatus.FORBIDDEN, ApiError.of(ApiError.ACCESS_DENIED));
    }
}
