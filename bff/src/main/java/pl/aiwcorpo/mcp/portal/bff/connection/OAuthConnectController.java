package pl.aiwcorpo.mcp.portal.bff.connection;

import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Set;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.audit.AuditLog;
import pl.aiwcorpo.mcp.portal.bff.config.DevMode;
import pl.aiwcorpo.mcp.portal.bff.security.LoginRedirects;
import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import pl.aiwcorpo.mcp.portal.bff.token.UserTokens;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerClient;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerData;
import pl.aiwcorpo.mcp.portal.bff.upstream.BrokerModel;
import pl.aiwcorpo.mcp.portal.bff.upstream.UpstreamException;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import pl.aiwcorpo.mcp.portal.bff.web.RequestIds;
import pl.aiwcorpo.mcp.portal.bff.web.ReturnPaths;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectReader;
import tools.jackson.databind.json.JsonMapper;

/**
 * Connecting an account through OAuth (C12 over C4). The browser only ever sees the provider's authorization URL
 * and, at the end, a redirect to a portal path with {@code connected} or a {@code connectError} code from the
 * closed list. The provider's {@code code} goes from the callback straight to the broker; nothing the provider or
 * the broker says is copied into the URL.
 */
@RestController
class OAuthConnectController {

    static final String CANCELLED = "cancelled";
    static final String PROVIDER_ERROR = "provider_error";
    static final String FLOW_INVALID = "flow_invalid";

    // identity_mismatch is deprecated since contracts 2.2.3 (no identity check, human decision 2026-10-28): the
    // broker no longer returns it and the BFF does not pass it on; a stray one ends as provider_error.
    private static final Set<String> BROKER_COMPLETE_ERRORS = Set.of(FLOW_INVALID);
    private static final int MAX_FLOW_ID = 128;
    private static final int MAX_STATE = 1024;
    private static final int MAX_CODE = 8192;

    private final UserTokens tokens;
    private final BrokerClient broker;
    private final OAuthFlows flows;
    private final LoginRedirects redirects;
    private final AuditLog audit;
    private final DevMode devMode;
    private final Clock clock;
    private final ObjectReader startReader = JsonMapper.builder().build()
            .readerFor(StartBody.class)
            .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    OAuthConnectController(UserTokens tokens, BrokerClient broker, OAuthFlows flows, LoginRedirects redirects,
                           AuditLog audit, DevMode devMode, Clock clock) {
        this.tokens = tokens;
        this.broker = broker;
        this.flows = flows;
        this.redirects = redirects;
        this.audit = audit;
        this.devMode = devMode;
        this.clock = clock;
    }

    @PostMapping("/api/v1/connections/{system}/oauth")
    ConnectOAuthResponse start(@PathVariable String system, @RequestBody(required = false) byte[] rawBody,
                               Authentication authentication, HttpServletRequest request,
                               HttpServletResponse response) {
        PortalUser.from(authentication);
        if (!BrokerData.SYSTEMS.contains(system)) {
            throw ApiException.badRequest();
        }
        String returnPath = returnPath(rawBody);
        BearerToken token = tokens.tokenFor(UserTokens.Audience.BROKER, authentication, request, response);
        BrokerModel.OAuthStartResponse started;
        try {
            started = broker.startOAuth(token, RequestIds.of(request), system, new BrokerModel.OAuthStartRequest(returnPath));
        } catch (UpstreamException e) {
            if (e.status() == 400) {
                throw ApiException.badRequest();
            }
            throw e;
        }
        String state = checkedState(started);
        flows.add(request.getSession(), state, started.flowId(), system, returnPath);
        return new ConnectOAuthResponse(started.authorizeUrl());
    }

    @GetMapping("/api/v1/oauth/callback")
    void callback(@RequestParam(required = false) String code, @RequestParam(required = false) String state,
                  @RequestParam(required = false) String error, Authentication authentication,
                  HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setHeader(HttpHeaders.CACHE_CONTROL, CacheControl.noStore().getHeaderValue());
        // code and state are in this URL; nothing the browser loads next may receive it as Referer.
        response.setHeader("Referrer-Policy", "no-referrer");
        if (authentication == null || !(authentication.getPrincipal() instanceof OidcUser)) {
            redirects.redirectToError(request, response, LoginRedirects.SESSION_EXPIRED);
            return;
        }
        PortalUser user = PortalUser.from(authentication);
        String requestId = RequestIds.of(request);
        long started = clock.millis();

        OAuthFlows.Flow flow = state == null || state.length() > MAX_STATE ? null
                : flows.take(request.getSession(false), state);
        if (flow == null) {
            audit.connectionChange(requestId, user, null, AuditLog.Outcome.rejected(FLOW_INVALID), clock.millis() - started);
            redirects.redirect(request, response, withParameter(ReturnPaths.DEFAULT, "connectError", FLOW_INVALID));
            return;
        }
        if (error != null) {
            // The user said no at the provider, or the provider failed; either way nothing was exchanged.
            String reason = "access_denied".equals(error) ? CANCELLED : PROVIDER_ERROR;
            audit.connectionChange(requestId, user, flow.system(), AuditLog.Outcome.rejected(reason),
                    clock.millis() - started);
            redirects.redirect(request, response, withParameter(flow.returnPath(), "connectError", reason));
            return;
        }
        if (code == null || code.isEmpty() || code.length() > MAX_CODE) {
            audit.connectionChange(requestId, user, flow.system(), AuditLog.Outcome.rejected(FLOW_INVALID),
                    clock.millis() - started);
            redirects.redirect(request, response, withParameter(flow.returnPath(), "connectError", FLOW_INVALID));
            return;
        }
        String failure = complete(flow, code, state, user, authentication, request, response, requestId, started);
        redirects.redirect(request, response, withParameter(flow.returnPath(),
                failure == null ? "connected" : "connectError", failure == null ? flow.system() : failure));
    }

    /** Returns null on success, otherwise a code of {@code ConnectErrorCode}. */
    private String complete(OAuthFlows.Flow flow, String code, String state, PortalUser user,
                            Authentication authentication, HttpServletRequest request, HttpServletResponse response,
                            String requestId, long started) {
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.BROKER, authentication, request, response);
            broker.completeOAuth(token, requestId, flow.system(),
                    new BrokerModel.OAuthCompleteRequest(flow.flowId(), code, state));
            audit.connectionChange(requestId, user, flow.system(), AuditLog.Outcome.ok(), clock.millis() - started);
            return null;
        } catch (UpstreamException e) {
            if (e.status() == 422 && BROKER_COMPLETE_ERRORS.contains(e.error())) {
                audit.connectionChange(requestId, user, flow.system(), AuditLog.Outcome.rejected(e.error()),
                        clock.millis() - started);
                return e.error();
            }
            audit.connectionChange(requestId, user, flow.system(), AuditLog.Outcome.upstreamUnavailable(),
                    clock.millis() - started);
            return PROVIDER_ERROR;
        } catch (RuntimeException e) {
            audit.connectionChange(requestId, user, flow.system(), AuditLog.Outcome.upstreamUnavailable(),
                    clock.millis() - started);
            return PROVIDER_ERROR;
        }
    }

    /** {@code ?} when the return path has no query yet, {@code &} otherwise (test-vectors/connect-redirects). */
    private static String withParameter(String returnPath, String name, String value) {
        return returnPath + (returnPath.indexOf('?') >= 0 ? "&" : "?") + name + "=" + value;
    }

    private String returnPath(byte[] rawBody) {
        if (rawBody == null || rawBody.length == 0) {
            return ReturnPaths.DEFAULT;
        }
        StartBody body;
        try {
            body = startReader.readValue(rawBody);
        } catch (JacksonException e) {
            throw ApiException.badRequest();
        }
        if (body == null) {
            throw ApiException.badRequest();
        }
        if (body.returnPath() == null) {
            return ReturnPaths.DEFAULT;
        }
        if (!ReturnPaths.isValid(body.returnPath())) {
            throw ApiException.badRequest();
        }
        return body.returnPath();
    }

    /**
     * The URL goes to the browser, so it must be an http(s) URL without credentials (http only in the dev profile),
     * and the provider {@code state} in it must be there to find the flow again. Anything else is a broker fault.
     */
    private String checkedState(BrokerModel.OAuthStartResponse started) {
        if (started == null || started.flowId() == null || started.flowId().isEmpty()
                || started.flowId().length() > MAX_FLOW_ID || started.authorizeUrl() == null) {
            throw new UpstreamException("credential broker", 502, null);
        }
        URI url;
        try {
            url = URI.create(started.authorizeUrl());
        } catch (IllegalArgumentException e) {
            throw new UpstreamException("credential broker", 502, null);
        }
        boolean https = "https".equalsIgnoreCase(url.getScheme());
        boolean http = "http".equalsIgnoreCase(url.getScheme());
        if (!(https || (http && devMode.enabled())) || url.getHost() == null || url.getRawUserInfo() != null) {
            throw new UpstreamException("credential broker", 502, null);
        }
        String query = url.getRawQuery() == null ? "" : url.getRawQuery();
        for (String pair : query.split("&")) {
            if (pair.startsWith("state=")) {
                String state = URLDecoder.decode(pair.substring("state=".length()), StandardCharsets.UTF_8);
                if (!state.isEmpty() && state.length() <= MAX_STATE) {
                    return state;
                }
            }
        }
        throw new UpstreamException("credential broker", 502, null);
    }

    record StartBody(String returnPath) {
    }

    record ConnectOAuthResponse(String authorizeUrl) {
    }
}
