package pl.aiwcorpo.mcp.portal.bff.confirmation;

import java.util.Locale;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import pl.aiwcorpo.mcp.portal.bff.token.UserTokens;
import pl.aiwcorpo.mcp.portal.bff.upstream.ContractValues;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayAdminClient;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayData;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel;
import pl.aiwcorpo.mcp.portal.bff.upstream.UpstreamException;
import pl.aiwcorpo.mcp.portal.bff.web.ApiError;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import pl.aiwcorpo.mcp.portal.bff.web.RequestIds;

/**
 * Pending confirmations of the current user (C12 over C5). A confirmation is the TOTP code typed in the MCP client,
 * so there is no decision endpoint here: the preview is read-only, {@code viewed} only records that it is open and
 * {@code cancel} withdraws the operation. Which confirmations belong to the user is the gateway's call (it takes the
 * {@code sub} from the exchanged token); an unknown, expired, superseded or foreign id is the same
 * {@code 404 not_found_or_denied} (invariant 8).
 */
@RestController
class ConfirmationsController {

    private final UserTokens tokens;
    private final GatewayAdminClient gateway;

    ConfirmationsController(UserTokens tokens, GatewayAdminClient gateway) {
        this.tokens = tokens;
        this.gateway = gateway;
    }

    /** Read-only (CC-098): nothing here may change state at the gateway, so a prefetch of the page is harmless. */
    @GetMapping("/api/v1/confirmations/{id}")
    ResponseEntity<GatewayModel.ConfirmationView> preview(@PathVariable String id, Authentication authentication,
                                                          HttpServletRequest request, HttpServletResponse response) {
        PortalUser.from(authentication);
        requireKnownShape(id);
        GatewayModel.ConfirmationView view;
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.GATEWAY_ADMIN, authentication, request, response);
            view = gateway.confirmation(token, RequestIds.of(request), id);
        } catch (UpstreamException e) {
            throw notFoundOr(e);
        }
        GatewayModel.ConfirmationView checked = GatewayData.validConfirmation(view, id);
        if (checked == null) {
            throw new UpstreamException("gateway admin", 502, null);
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header(HttpHeaders.PRAGMA, "no-cache")
                .body(checked);
    }

    /**
     * Records that the preview is open and visible (CC-127). It blocks other DESTRUCTIVE operations of the user, so
     * it must come from the page itself: the CSRF header is checked by the security chain, here the browser has to
     * say the request is same-origin, and a prefetch or prerender is acknowledged without being forwarded.
     */
    @PostMapping("/api/v1/confirmations/{id}/viewed")
    ResponseEntity<Void> viewed(@PathVariable String id, Authentication authentication, HttpServletRequest request,
                                HttpServletResponse response) {
        PortalUser.from(authentication);
        if (!"same-origin".equals(request.getHeader("Sec-Fetch-Site"))) {
            throw new ApiException(HttpStatus.FORBIDDEN, ApiError.of(ApiError.CSRF_INVALID));
        }
        if (isSpeculative(request)) {
            return ResponseEntity.noContent().build();
        }
        requireKnownShape(id);
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.GATEWAY_ADMIN, authentication, request, response);
            gateway.markConfirmationViewed(token, RequestIds.of(request), id);
        } catch (UpstreamException e) {
            throw notFoundOr(e);
        }
        return ResponseEntity.noContent().build();
    }

    /** No fresh MFA: the call approves nothing. A broker failure at the gateway is a 503 and nothing is cancelled. */
    @PostMapping("/api/v1/confirmations/{id}/cancel")
    ResponseEntity<Void> cancel(@PathVariable String id, Authentication authentication, HttpServletRequest request,
                                HttpServletResponse response) {
        PortalUser.from(authentication);
        requireKnownShape(id);
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.GATEWAY_ADMIN, authentication, request, response);
            gateway.cancelConfirmation(token, RequestIds.of(request), id);
        } catch (UpstreamException e) {
            throw notFoundOr(e);
        }
        return ResponseEntity.noContent().build();
    }

    private static boolean isSpeculative(HttpServletRequest request) {
        for (String header : new String[] {"Sec-Purpose", "Purpose"}) {
            String value = request.getHeader(header);
            if (value != null && value.toLowerCase(Locale.ROOT).contains("prefetch")) {
                return true;
            }
        }
        return false;
    }

    // An id that cannot be one is answered like an unknown one, without asking the gateway.
    private static void requireKnownShape(String id) {
        if (!ContractValues.CONFIRMATION_ID.matcher(id).matches()) {
            throw notFound();
        }
    }

    private static RuntimeException notFoundOr(UpstreamException e) {
        return e.status() == 404 ? notFound() : e;
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, ApiError.of(ApiError.NOT_FOUND_OR_DENIED));
    }
}
