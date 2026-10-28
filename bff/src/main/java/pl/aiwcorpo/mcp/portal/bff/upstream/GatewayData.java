package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Checks the confirmation preview and the activity rows of C5 against the contract before they reach the browser,
 * which shows them in a trusted page. A preview that does not fit is not shown; a bad activity row is dropped.
 */
public final class GatewayData {

    private static final Logger log = LoggerFactory.getLogger(GatewayData.class);

    private static final Set<String> RESOURCE_TYPES = Set.of("Jira::Project", "Jira::Issue", "Confluence::Space",
            "Confluence::Page", "GitLab::Group", "GitLab::Project", "OpenSearch::Index", "ServiceDesk::Queue",
            "ServiceDesk::Ticket");
    private static final Set<String> ERROR_CODES = Set.of("unauthenticated", "access_denied", "tool_disabled",
            "confirmation_required", "confirmation_failed", "confirmation_superseded", "confirmation_cancelled",
            "confirmation_blocked", "credential_required", "not_found_or_denied", "invalid_argument", "rate_limited",
            "step_up_required", "upstream_unavailable", "internal_error");
    private static final String NO_CONTROLS = "[^\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]";
    private static final Pattern RESOURCE_ID = Pattern.compile("^" + NO_CONTROLS + "{1,512}$");
    private static final Pattern RESOURCE_PARENT = Pattern.compile("^[A-Za-z]+::[A-Za-z]+::" + NO_CONTROLS + "+$");
    private static final Pattern RESULT = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final int MAX_PARENT = 600;
    private static final int MAX_CLIENT = 255;
    private static final int MAX_TOOL = 80;

    private GatewayData() {
    }

    /** The preview of {@code expectedId}, or null when the gateway's answer is not that call or breaks the schema. */
    public static GatewayModel.ConfirmationView validConfirmation(GatewayModel.ConfirmationView view, String expectedId) {
        if (view == null || !expectedId.equals(view.confirmationId()) || !validTool(view.tool())
                || !BrokerData.SYSTEMS.contains(view.system()) || !ContractValues.isTimestamp(view.expiresAt())
                || view.arguments() == null || !(view.resource() == null || validResource(view.resource()))) {
            return null;
        }
        for (GatewayModel.ConfirmationArgument argument : view.arguments()) {
            if (argument == null || argument.name() == null || argument.value() == null || argument.truncated() == null) {
                return null;
            }
        }
        return view;
    }

    /** Rows that fit {@code ActivityCall}; the others are left out with a warning that carries no value. */
    public static List<GatewayModel.ActivityCall> validActivityCalls(List<GatewayModel.ActivityCall> calls) {
        List<GatewayModel.ActivityCall> result = new ArrayList<>();
        for (GatewayModel.ActivityCall call : calls == null ? List.<GatewayModel.ActivityCall>of() : calls) {
            if (validActivityCall(call)) {
                result.add(call);
            } else {
                log.warn("Dropping a C5 activity row outside the contract");
            }
        }
        return result;
    }

    private static boolean validActivityCall(GatewayModel.ActivityCall call) {
        return call != null
                && call.requestId() != null && ContractValues.REQUEST_ID.matcher(call.requestId()).matches()
                && ContractValues.isTimestamp(call.ts())
                && validTool(call.tool())
                && call.result() != null && RESULT.matcher(call.result()).matches()
                && (call.client() == null || call.client().length() <= MAX_CLIENT)
                && (call.virtualServer() == null || ContractValues.VIRTUAL_SERVER_SLUG.matcher(call.virtualServer()).matches())
                && (call.risk() == null || BrokerData.RISKS.contains(call.risk()))
                && (call.resource() == null || validResource(call.resource()))
                && (call.wrongCodeCount() == null || call.wrongCodeCount() >= 0 && call.wrongCodeCount() <= 3)
                && (call.errorCode() == null || ERROR_CODES.contains(call.errorCode()));
    }

    private static boolean validTool(String tool) {
        return tool != null && tool.length() <= MAX_TOOL && ContractValues.QUALIFIED_TOOL.matcher(tool).matches();
    }

    private static boolean validResource(GatewayModel.Resource resource) {
        return RESOURCE_TYPES.contains(resource.type())
                && resource.id() != null && RESOURCE_ID.matcher(resource.id()).matches()
                && (resource.parent() == null
                        || resource.parent().length() <= MAX_PARENT && RESOURCE_PARENT.matcher(resource.parent()).matches());
    }
}
