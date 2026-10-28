package pl.aiwcorpo.mcp.portal.bff.virtualserver;

import java.time.Clock;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.audit.AuditLog;
import pl.aiwcorpo.mcp.portal.bff.config.PublicUrls;
import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import pl.aiwcorpo.mcp.portal.bff.token.UserTokens;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayAdminClient;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel;
import pl.aiwcorpo.mcp.portal.bff.upstream.UpstreamException;
import pl.aiwcorpo.mcp.portal.bff.web.ApiError;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import pl.aiwcorpo.mcp.portal.bff.web.RequestIds;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The user's virtual servers (links): a proxy to C5 plus {@code clientConfigs}. Owner checks and the "tool the user
 * may call" rule are the gateway's; the BFF never trusts the browser for either and builds every public URL from
 * its own configuration.
 */
@RestController
class VirtualServersController {

    static final String RESOURCE_DEFAULTS_UNSUPPORTED = "resource_defaults_unsupported";
    static final String SLUG_TAKEN = "slug_taken";

    private static final Pattern SLUG = Pattern.compile("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$");
    private static final Pattern TOOL = Pattern
            .compile("^(jira|confluence|gitlab|servicedesk|opensearch)__[a-z][a-z0-9]*(_[a-z0-9]+)*$");
    private static final Set<String> CREATE_FIELDS = Set.of("slug", "displayName", "tools", "resourceDefaults");
    private static final int DISPLAY_NAME_MAX = 100;
    private static final int TOOL_MAX = 80;

    private final UserTokens tokens;
    private final GatewayAdminClient gateway;
    private final PublicUrls publicUrls;
    private final AuditLog audit;
    private final Clock clock;
    private final JsonMapper json = JsonMapper.builder().build();

    VirtualServersController(UserTokens tokens, GatewayAdminClient gateway, PublicUrls publicUrls, AuditLog audit,
                             Clock clock) {
        this.tokens = tokens;
        this.gateway = gateway;
        this.publicUrls = publicUrls;
        this.audit = audit;
        this.clock = clock;
    }

    @GetMapping("/api/v1/virtual-servers")
    List<PortalVirtualServer> list(Authentication authentication, HttpServletRequest request,
                                   HttpServletResponse response) {
        PortalUser.from(authentication);
        BearerToken token = tokens.tokenFor(UserTokens.Audience.GATEWAY_ADMIN, authentication, request, response);
        List<GatewayModel.VirtualServer> upstream = gateway.virtualServers(token, RequestIds.of(request));
        List<PortalVirtualServer> result = new ArrayList<>();
        for (GatewayModel.VirtualServer server : upstream == null ? List.<GatewayModel.VirtualServer>of() : upstream) {
            if (server == null || !validSlug(server.slug()) || server.displayName() == null || server.tools() == null
                    || !server.tools().stream().allMatch(VirtualServersController::validTool)) {
                continue;
            }
            String url = publicUrls.virtualServer(server.slug());
            result.add(new PortalVirtualServer(server.slug(), server.displayName(), List.copyOf(server.tools()), url,
                    ClientConfigs.of(server.slug(), url)));
        }
        return result;
    }

    @PostMapping("/api/v1/virtual-servers")
    ResponseEntity<Object> create(@RequestBody(required = false) byte[] rawBody, Authentication authentication,
                                  HttpServletRequest request, HttpServletResponse response) {
        PortalUser user = PortalUser.from(authentication);
        String requestId = RequestIds.of(request);
        long started = clock.millis();
        Checked checked = check(rawBody);
        if (checked.error() != null) {
            audit.virtualServerChange(requestId, user, checked.slug(), AuditLog.Outcome.rejected(checked.error()),
                    clock.millis() - started);
            return ResponseEntity.badRequest().body(ApiError.of(checked.error()).withRequestId(requestId));
        }
        GatewayModel.VirtualServerCreate body = checked.body();
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.GATEWAY_ADMIN, authentication, request, response);
            gateway.createVirtualServer(token, requestId, body);
        } catch (UpstreamException e) {
            return upstreamFailure(e, body.slug(), user, requestId, started);
        } catch (RuntimeException e) {
            audit.virtualServerChange(requestId, user, body.slug(), AuditLog.Outcome.upstreamUnavailable(),
                    clock.millis() - started);
            throw e;
        }
        audit.virtualServerChange(requestId, user, body.slug(), AuditLog.Outcome.ok(), clock.millis() - started);
        String url = publicUrls.virtualServer(body.slug());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new PortalVirtualServerCreated(body.slug(), url, ClientConfigs.of(body.slug(), url)));
    }

    @DeleteMapping("/api/v1/virtual-servers/{slug}")
    ResponseEntity<Void> delete(@PathVariable String slug, Authentication authentication, HttpServletRequest request,
                                HttpServletResponse response) {
        PortalUser user = PortalUser.from(authentication);
        String requestId = RequestIds.of(request);
        long started = clock.millis();
        if (!validSlug(slug)) {
            audit.virtualServerChange(requestId, user, null, AuditLog.Outcome.rejected(ApiError.NOT_FOUND_OR_DENIED),
                    clock.millis() - started);
            throw notFound();
        }
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.GATEWAY_ADMIN, authentication, request, response);
            gateway.deleteVirtualServer(token, requestId, slug);
        } catch (UpstreamException e) {
            // Someone else's link and a missing one look the same to the browser.
            if (e.status() == 404 || e.status() == 403) {
                audit.virtualServerChange(requestId, user, slug, AuditLog.Outcome.accessDenied(), clock.millis() - started);
                throw notFound();
            }
            audit.virtualServerChange(requestId, user, slug, AuditLog.Outcome.upstreamUnavailable(),
                    clock.millis() - started);
            throw e;
        } catch (RuntimeException e) {
            audit.virtualServerChange(requestId, user, slug, AuditLog.Outcome.upstreamUnavailable(),
                    clock.millis() - started);
            throw e;
        }
        audit.virtualServerChange(requestId, user, slug, AuditLog.Outcome.ok(), clock.millis() - started);
        return ResponseEntity.noContent().build();
    }

    private ResponseEntity<Object> upstreamFailure(UpstreamException e, String slug, PortalUser user, String requestId,
                                                   long started) {
        long latency = clock.millis() - started;
        if (e.status() == 409 && SLUG_TAKEN.equals(e.error())) {
            audit.virtualServerChange(requestId, user, slug, AuditLog.Outcome.rejected(SLUG_TAKEN), latency);
            return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of(SLUG_TAKEN).withRequestId(requestId));
        }
        if (e.status() == 403 && ApiError.ACCESS_DENIED.equals(e.error())) {
            audit.virtualServerChange(requestId, user, slug, AuditLog.Outcome.accessDenied(), latency);
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiError.of(ApiError.ACCESS_DENIED).withRequestId(requestId));
        }
        if (e.status() == 400 && (ApiError.INVALID_REQUEST.equals(e.error())
                || RESOURCE_DEFAULTS_UNSUPPORTED.equals(e.error()))) {
            audit.virtualServerChange(requestId, user, slug, AuditLog.Outcome.rejected(e.error()), latency);
            return ResponseEntity.badRequest().body(ApiError.of(e.error()).withRequestId(requestId));
        }
        audit.virtualServerChange(requestId, user, slug, AuditLog.Outcome.upstreamUnavailable(), latency);
        throw e;
    }

    /**
     * Strict check of {@code VirtualServerCreate}, in the order the contract fixes (CC-085): a non-empty
     * {@code resourceDefaults} object is refused before anything else, a {@code resourceDefaults} that is no object
     * at all is {@code invalid_request}; only then the other fields. An empty object counts as absent and is not
     * forwarded.
     */
    private Checked check(byte[] rawBody) {
        JsonNode root;
        try {
            root = rawBody == null || rawBody.length == 0 ? null : json.readTree(rawBody);
        } catch (JacksonException e) {
            return Checked.invalid(ApiError.INVALID_REQUEST, null);
        }
        if (root == null || !root.isObject()) {
            return Checked.invalid(ApiError.INVALID_REQUEST, null);
        }
        JsonNode defaults = root.get("resourceDefaults");
        if (defaults != null) {
            if (!defaults.isObject()) {
                return Checked.invalid(ApiError.INVALID_REQUEST, null);
            }
            if (!defaults.isEmpty()) {
                return Checked.invalid(RESOURCE_DEFAULTS_UNSUPPORTED, null);
            }
        }
        for (String name : root.propertyNames()) {
            if (!CREATE_FIELDS.contains(name)) {
                return Checked.invalid(ApiError.INVALID_REQUEST, null);
            }
        }
        JsonNode slug = root.get("slug");
        JsonNode displayName = root.get("displayName");
        JsonNode tools = root.get("tools");
        if (slug == null || !slug.isString() || !validSlug(slug.asString())) {
            return Checked.invalid(ApiError.INVALID_REQUEST, null);
        }
        String slugValue = slug.asString();
        if (displayName == null || !displayName.isString() || displayName.asString().isEmpty()
                || displayName.asString().codePointCount(0, displayName.asString().length()) > DISPLAY_NAME_MAX
                || tools == null || !tools.isArray() || tools.isEmpty()) {
            return Checked.invalid(ApiError.INVALID_REQUEST, slugValue);
        }
        List<String> toolNames = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (JsonNode tool : tools) {
            if (!tool.isString() || !validTool(tool.asString()) || !seen.add(tool.asString())) {
                return Checked.invalid(ApiError.INVALID_REQUEST, slugValue);
            }
            toolNames.add(tool.asString());
        }
        return new Checked(new GatewayModel.VirtualServerCreate(slugValue, displayName.asString(), toolNames), null,
                slugValue);
    }

    private static boolean validSlug(String slug) {
        return slug != null && SLUG.matcher(slug).matches();
    }

    private static boolean validTool(String tool) {
        return tool != null && tool.length() <= TOOL_MAX && TOOL.matcher(tool).matches();
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, ApiError.of(ApiError.NOT_FOUND_OR_DENIED));
    }

    private record Checked(GatewayModel.VirtualServerCreate body, String error, String slug) {

        static Checked invalid(String error, String slug) {
            return new Checked(null, error, slug);
        }
    }

    record PortalVirtualServer(String slug, String displayName, List<String> tools, String url,
                               ClientConfigs clientConfigs) {
    }

    record PortalVirtualServerCreated(String slug, String url, ClientConfigs clientConfigs) {
    }
}
