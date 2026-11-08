package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

/**
 * Checks the registry views of C5 ({@code RegistryServer}, {@code PendingTool}) before they reach the administrator's
 * browser, and writes the hidden characters of every text out (CC-121). The tool definitions come from the pipeline of a
 * repository or, for {@code source: server}, from a running server, so a description can carry text meant to mislead
 * a reviewer; what the administrator reads is exactly what is in the definition, with invisible characters shown as
 * {@code <U+XXXX>}. The hashes are passed on unchanged: they belong to the original text, not to the neutralized one.
 * Anything that does not fit the closed schemas is a contract breach and the whole answer is refused (no partial views).
 */
public final class RegistryData {

    public static final Pattern TOOL_NAME = Pattern.compile("^[a-z][a-z0-9]*(_[a-z0-9]+)*$");
    public static final Pattern DEFINITION_HASH = Pattern.compile("^sha256:[0-9a-f]{64}$");
    private static final Pattern SEMVER = Pattern
            .compile("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$");
    private static final Set<String> SERVER_FIELDS = Set.of("serverId", "system", "version", "enabled", "tools",
            "policiesStatus", "policiesHash", "pendingPoliciesHash");
    private static final Set<String> TOOL_FIELDS = Set.of("name", "risk", "action", "resourceRefs", "definition",
            "definitionHash", "additionalGroup");
    private static final Set<String> REGISTRY_TOOL_FIELDS = Set.of("name", "risk", "action", "resourceRefs", "definition",
            "definitionHash", "status", "change", "source", "approvedInVersion", "riskLowered", "classifiedBy",
            "classifiedAt", "additionalGroup");
    /** {@code additionalGroup} of a tool entry (CC-242): a group of the server's own system, never read, write or destructive. */
    private static final Pattern ADDITIONAL_GROUP = Pattern.compile("^mcp-[a-z][a-z0-9]{1,30}-[a-z][a-z0-9-]{0,30}$");
    private static final Set<String> KILL_SWITCH_FIELDS = Set.of("scope", "serverId", "tool", "setBy", "setAt", "reason");
    private static final Set<String> PENDING_FIELDS = Set.of("approvedEntry", "pendingEntry", "pendingHash",
            "pendingVersion", "source", "approvedInVersion", "riskLowered");
    private static final Set<String> ACTIONS = Set.of("read", "update", "delete", "admin");
    private static final String ADAPTER = "adapter";
    private static final Set<String> SOURCES = Set.of("manifest", "server", ADAPTER);

    private RegistryData() {
    }

    /** The registry as the browser gets it, or null when it breaks the contract. */
    public static List<JsonNode> validRegistry(List<JsonNode> servers) {
        if (servers == null) {
            return null;
        }
        ArrayNode checked = JsonNodeFactory.instance.arrayNode();
        for (JsonNode server : servers) {
            if (!validServer(server)) {
                return null;
            }
            checked.add(neutralized(server));
        }
        return checked.valueStream().toList();
    }

    /** One {@code PendingTool} as the browser gets it, or null when it breaks the contract. */
    public static JsonNode validPending(JsonNode pending, String tool) {
        if (pending == null || !pending.isObject() || !onlyFields(pending, PENDING_FIELDS)
                || !pending.has("approvedEntry") || !pending.has("pendingEntry") || !pending.has("pendingHash")
                || !pending.has("pendingVersion") || !pending.has("source")) {
            return null;
        }
        JsonNode approved = pending.get("approvedEntry");
        JsonNode entry = pending.get("pendingEntry");
        JsonNode approvedIn = pending.get("approvedInVersion");
        // An adapter does not classify (CC-193): its pending entry has no risk and action, and no resourceRefs.
        boolean fromAdapter = ADAPTER.equals(text(pending.get("source")));
        boolean fits = (approved.isNull() || validTool(approved, TOOL_FIELDS, Kind.CLASSIFIED))
                && validTool(entry, TOOL_FIELDS, fromAdapter ? Kind.ADAPTER_ENTRY : Kind.CLASSIFIED)
                // The administrator approves the tool of the path, so the diff must be about that tool.
                && tool.equals(entry.get("name").asString())
                && (approved.isNull() || tool.equals(approved.get("name").asString()))
                && hash(pending.get("pendingHash"))
                && entry.get("definitionHash").equals(pending.get("pendingHash"))
                && semver(pending.get("pendingVersion"))
                && SOURCES.contains(text(pending.get("source")))
                && (approvedIn == null || approvedIn.isNull() || semver(approvedIn))
                && (!pending.has("riskLowered") || pending.get("riskLowered").isBoolean());
        return fits ? neutralized(pending) : null;
    }

    private static boolean validServer(JsonNode server) {
        if (server == null || !server.isObject() || !onlyFields(server, SERVER_FIELDS)
                || !ContractValues.isServerId(text(server.get("serverId")))
                || !ContractValues.isSystemId(text(server.get("system")))
                || !("mcp-" + server.get("system").asString()).equals(server.get("serverId").asString())
                || !semver(server.get("version"))
                || server.has("enabled") && !server.get("enabled").isBoolean()
                || !validPolicyState(server)
                || server.get("tools") == null || !server.get("tools").isArray()) {
            return false;
        }
        for (JsonNode tool : server.get("tools")) {
            if (!validRegistryTool(tool)) {
                return false;
            }
        }
        return true;
    }

    /**
     * {@code policiesStatus} is absent for an adapter; {@code pendingPoliciesHash} is there exactly with
     * {@code pending_approval} and {@code policiesHash} (the approved one) only when something was approved.
     */
    private static boolean validPolicyState(JsonNode server) {
        boolean status = server.has("policiesStatus");
        if (!status) {
            return !server.has("pendingPoliciesHash");
        }
        String value = text(server.get("policiesStatus"));
        return ("approved".equals(value) || "pending_approval".equals(value))
                && (!server.has("policiesHash") || hash(server.get("policiesHash")))
                && "pending_approval".equals(value) == server.has("pendingPoliciesHash")
                && (!server.has("pendingPoliciesHash") || hash(server.get("pendingPoliciesHash")));
    }

    /** How the entry is classified: {@code ToolEntry} has risk and action, {@code AdapterToolEntry} must not have them. */
    private enum Kind { CLASSIFIED, ADAPTER_ENTRY, ANY }

    private static boolean validTool(JsonNode tool, Set<String> fields, Kind kind) {
        if (tool == null || !tool.isObject() || !onlyFields(tool, fields)
                || !TOOL_NAME.matcher(text(tool.get("name"))).matches() || text(tool.get("name")).length() > 64
                || tool.get("resourceRefs") == null || !tool.get("resourceRefs").isArray()
                || tool.get("definition") == null || !tool.get("definition").isObject()
                || !hash(tool.get("definitionHash"))) {
            return false;
        }
        // A group that only narrows access is part of what the administrator approves; an adapter has none (CC-242).
        if (tool.has("additionalGroup") && (kind == Kind.ADAPTER_ENTRY
                || !ADDITIONAL_GROUP.matcher(text(tool.get("additionalGroup"))).matches()
                || text(tool.get("additionalGroup")).length() > 70)) {
            return false;
        }
        boolean hasRisk = tool.has("risk");
        boolean hasAction = tool.has("action");
        return switch (kind) {
            case CLASSIFIED -> classification(tool);
            case ADAPTER_ENTRY -> !hasRisk && !hasAction && tool.get("resourceRefs").isEmpty();
            // A registry entry of an adapter may wait without its classification; a half of it is never valid.
            case ANY -> hasRisk == hasAction && (!hasRisk || classification(tool));
        };
    }

    private static boolean classification(JsonNode tool) {
        return BrokerData.RISKS.contains(text(tool.get("risk"))) && ACTIONS.contains(text(tool.get("action")));
    }

    private static boolean validRegistryTool(JsonNode tool) {
        String status = text(tool == null ? null : tool.get("status"));
        boolean pending = "pending_approval".equals(status);
        if (!pending && !"approved".equals(status)) {
            return false;
        }
        // risk and action are missing only from a pending entry whose source is adapter (CC-193).
        boolean pendingAdapter = pending && ADAPTER.equals(text(tool.get("source")));
        if (!validTool(tool, REGISTRY_TOOL_FIELDS, pendingAdapter ? Kind.ANY : Kind.CLASSIFIED)) {
            return false;
        }
        // change and source are there exactly when the entry is pending (CC-097, CC-162).
        if (pending != tool.has("change") || pending != tool.has("source")) {
            return false;
        }
        if (pending && (!Set.of("new", "changed").contains(text(tool.get("change"))) || !SOURCES.contains(text(tool.get("source"))))) {
            return false;
        }
        // The administrator who classified a tool of an adapter and when (CC-193), both or neither.
        boolean classifiedBy = tool.has("classifiedBy");
        if (classifiedBy != tool.has("classifiedAt")
                || classifiedBy && (text(tool.get("classifiedBy")).isEmpty() || text(tool.get("classifiedBy")).length() > 255
                        || !ContractValues.isTimestamp(text(tool.get("classifiedAt"))))) {
            return false;
        }
        JsonNode approvedIn = tool.get("approvedInVersion");
        // riskLowered (CC-167) can only be true for an entry that waits for a decision.
        JsonNode lowered = tool.get("riskLowered");
        return (approvedIn == null || approvedIn.isNull() || semver(approvedIn))
                && (lowered == null || lowered.isBoolean() && (pending || !lowered.asBoolean()));
    }

    /** Both absent (the entry is not from an adapter) or a pair of known values; whether they fit is the gateway's to say. */
    public static boolean validClassification(String risk, String action) {
        return risk == null && action == null || risk != null && action != null && BrokerData.RISKS.contains(risk)
                && ACTIONS.contains(action);
    }

    /** The active switches as {@code KillSwitchList}, or null when the answer breaks the closed schema; reasons are neutralized. */
    public static JsonNode validKillSwitches(JsonNode list) {
        if (list == null || !list.isObject() || !onlyFields(list, Set.of("switches")) || list.get("switches") == null
                || !list.get("switches").isArray()) {
            return null;
        }
        for (JsonNode entry : list.get("switches")) {
            if (!validKillSwitch(entry)) {
                return null;
            }
        }
        return neutralized(list);
    }

    private static boolean validKillSwitch(JsonNode entry) {
        if (entry == null || !entry.isObject() || !onlyFields(entry, KILL_SWITCH_FIELDS)
                || !ContractValues.isServerId(text(entry.get("serverId")))
                || text(entry.get("setBy")).isEmpty() || text(entry.get("setBy")).length() > 255
                || !ContractValues.isTimestamp(text(entry.get("setAt")))
                || text(entry.get("reason")).isEmpty() || text(entry.get("reason")).length() > 200) {
            return false;
        }
        // tool is there exactly when the scope is tool.
        return switch (text(entry.get("scope"))) {
            case "server" -> !entry.has("tool");
            case "tool" -> TOOL_NAME.matcher(text(entry.get("tool"))).matches() && text(entry.get("tool")).length() <= 64;
            default -> false;
        };
    }

    static boolean onlyFields(JsonNode node, Set<String> allowed) {
        return node.propertyNames().stream().allMatch(allowed::contains);
    }

    /** The text of a string node, or the empty string, which no pattern above accepts. */
    static String text(JsonNode node) {
        return node != null && node.isString() ? node.asString() : "";
    }

    static boolean hash(JsonNode node) {
        return DEFINITION_HASH.matcher(text(node)).matches();
    }

    static boolean semver(JsonNode node) {
        return SEMVER.matcher(text(node)).matches();
    }

    /** A copy in which every string value and every property name has its hidden characters written out. */
    static JsonNode neutralized(JsonNode node) {
        if (node.isString()) {
            return JsonNodeFactory.instance.stringNode(TextHygiene.neutralize(node.asString()));
        }
        if (node.isArray()) {
            ArrayNode copy = JsonNodeFactory.instance.arrayNode();
            node.forEach(element -> copy.add(neutralized(element)));
            return copy;
        }
        if (node.isObject()) {
            ObjectNode copy = JsonNodeFactory.instance.objectNode();
            node.properties().forEach(entry -> copy.set(TextHygiene.neutralize(entry.getKey()), neutralized(entry.getValue())));
            return copy;
        }
        return node;
    }
}
