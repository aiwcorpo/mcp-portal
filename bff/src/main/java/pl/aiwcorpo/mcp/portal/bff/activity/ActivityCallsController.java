package pl.aiwcorpo.mcp.portal.bff.activity;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import pl.aiwcorpo.mcp.portal.bff.security.PortalUser;
import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import pl.aiwcorpo.mcp.portal.bff.token.UserTokens;
import pl.aiwcorpo.mcp.portal.bff.upstream.ContractValues;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayAdminClient;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayData;
import pl.aiwcorpo.mcp.portal.bff.upstream.GatewayModel;
import pl.aiwcorpo.mcp.portal.bff.upstream.UpstreamException;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;
import pl.aiwcorpo.mcp.portal.bff.web.RequestIds;

/**
 * {@code GET /api/v1/activity/calls} (CC-095): the user's tool calls, one row per call, computed by the gateway
 * from its audit. The BFF checks the filters, forwards them and the cursor unchanged, and never decides whose rows
 * these are: the gateway takes the {@code sub} from the exchanged token.
 */
@RestController
class ActivityCallsController {

    private static final Set<String> RESULT_GROUPS = Set.of("ok", "denied", "error", "confirmation");
    private static final Pattern CURSOR = Pattern.compile("^[\\x21-\\x7e]{1,256}$");
    private static final Pattern NO_CONTROLS = Pattern.compile("^[^\\u0000-\\u001f\\u007f-\\u009f]{1,64}$");

    private final UserTokens tokens;
    private final GatewayAdminClient gateway;

    ActivityCallsController(UserTokens tokens, GatewayAdminClient gateway) {
        this.tokens = tokens;
        this.gateway = gateway;
    }

    @GetMapping("/api/v1/activity/calls")
    ResponseEntity<List<GatewayModel.ActivityCall>> calls(Authentication authentication, HttpServletRequest request,
                                                          HttpServletResponse response) {
        PortalUser.from(authentication);
        Map<String, String> query = filters(request.getParameterMap());
        GatewayModel.ActivityCallsPage page;
        try {
            BearerToken token = tokens.tokenFor(UserTokens.Audience.GATEWAY_ADMIN, authentication, request, response);
            page = gateway.activityCalls(token, RequestIds.of(request), query);
        } catch (UpstreamException e) {
            // A cursor the gateway does not accept (changed, from another user) is the caller's mistake.
            throw e.status() == 400 && query.containsKey("cursor") ? ApiException.badRequest() : e;
        }
        if (page.nextCursor() != null && !CURSOR.matcher(page.nextCursor()).matches()) {
            throw new UpstreamException("gateway admin", 502, null);
        }
        ResponseEntity.BodyBuilder answer = ResponseEntity.ok();
        if (page.nextCursor() != null) {
            answer.header("X-Next-Cursor", page.nextCursor());
        }
        return answer.body(GatewayData.validActivityCalls(page.calls()));
    }

    /** Known parameters only, each once and within its limits; anything else the browser sent is not forwarded. */
    private static Map<String, String> filters(Map<String, String[]> parameters) {
        Map<String, String> query = new LinkedHashMap<>();
        for (String name : List.of("limit", "from", "to", "result", "q", "cursor")) {
            String[] values = parameters.get(name);
            if (values == null) {
                continue;
            }
            if (values.length != 1 || !valid(name, values[0])) {
                throw ApiException.badRequest();
            }
            query.put(name, values[0]);
        }
        return query;
    }

    private static boolean valid(String name, String value) {
        return switch (name) {
            case "limit" -> value.matches("[0-9]{1,3}") && Integer.parseInt(value) >= 1 && Integer.parseInt(value) <= 200;
            case "from", "to" -> ContractValues.isTimestamp(value);
            case "result" -> RESULT_GROUPS.contains(value);
            case "q" -> NO_CONTROLS.matcher(value).matches();
            default -> CURSOR.matcher(value).matches();
        };
    }
}
