package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import pl.aiwcorpo.mcp.portal.bff.web.StrictJson;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

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
    private static final Pattern ARGUMENT_NAME = Pattern.compile("^[A-Za-z_$][A-Za-z0-9_$.-]{0,127}$");
    private static final Pattern CLIENT = Pattern.compile("^[A-Za-z0-9._:-]{1,255}$");
    private static final int MAX_PARENT = 600;
    private static final int MAX_ARGUMENTS = 64;
    // Characters shown per argument value after hidden ones were written out; longer values are cut and marked.
    static final int MAX_SHOWN_VALUE = 8192;
    // Closed objects: a field the schema does not know is a contract breach, not something to drop quietly.
    private static final JsonMapper CLOSED = StrictJson.builder()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build();
    private static final int MAX_TOOL = 80;

    private GatewayData() {
    }

    /** The answer as {@code ConfirmationView}, or null when it has a field or a type the closed schema does not. */
    public static GatewayModel.ConfirmationView closedConfirmation(JsonNode node) {
        return closed(node, GatewayModel.ConfirmationView.class);
    }

    private static <T> T closed(JsonNode node, Class<T> type) {
        try {
            return node == null ? null : CLOSED.treeToValue(node, type);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** The preview of {@code expectedId}, or null when the gateway's answer is not that call or breaks the schema. */
    public static GatewayModel.ConfirmationView validConfirmation(GatewayModel.ConfirmationView view, String expectedId) {
        if (view == null || !expectedId.equals(view.confirmationId()) || !validTool(view.tool())
                || !BrokerData.SYSTEMS.contains(view.system()) || !ContractValues.isTimestamp(view.expiresAt())
                || view.arguments() == null || view.arguments().size() > MAX_ARGUMENTS || !(view.resource() == null || validResource(view.resource()))) {
            return null;
        }
        List<GatewayModel.ConfirmationArgument> arguments = new ArrayList<>();
        for (GatewayModel.ConfirmationArgument argument : view.arguments()) {
            if (argument == null || argument.name() == null || !ARGUMENT_NAME.matcher(argument.name()).matches()
                    || argument.value() == null || argument.truncated() == null) {
                return null;
            }
            String shown = TextHygiene.neutralize(argument.value());
            boolean cut = shown.length() > MAX_SHOWN_VALUE;
            arguments.add(new GatewayModel.ConfirmationArgument(argument.name(),
                    cut ? TextHygiene.cutAtNotation(shown, MAX_SHOWN_VALUE) : shown, cut || argument.truncated()));
        }
        return new GatewayModel.ConfirmationView(view.confirmationId(), view.tool(), view.system(), view.resource(),
                arguments, view.expiresAt());
    }

    /**
     * Argument values come from an untrusted agent and are shown in the trusted preview. Hidden characters
     * ({@link TextHygiene}: bidi and zero-width characters, controls other than newline and tab, separators, lone
     * surrogates, tag characters and the like) would let a value pose as something else, so each becomes its visible
     * code point notation, {@code <U+202E>}. C12 has no flag for this (the
     * argument schema is closed); the notation itself is what the reader sees.
     */
    static String neutralize(String value) {
        return TextHygiene.neutralize(value);
    }

    /** Rows that fit {@code ActivityCall}; the others are left out with a warning that carries no value. */
    public static List<GatewayModel.ActivityCall> validActivityCalls(List<JsonNode> rows) {
        List<GatewayModel.ActivityCall> result = new ArrayList<>();
        for (JsonNode row : rows == null ? List.<JsonNode>of() : rows) {
            GatewayModel.ActivityCall call = closed(row, GatewayModel.ActivityCall.class);
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
                && (call.client() == null || CLIENT.matcher(call.client()).matches())
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
                && TextHygiene.isClean(resource.id(), false)
                && (resource.parent() == null
                        || resource.parent().length() <= MAX_PARENT && RESOURCE_PARENT.matcher(resource.parent()).matches()
                                && TextHygiene.isClean(resource.parent(), false));
    }
}
