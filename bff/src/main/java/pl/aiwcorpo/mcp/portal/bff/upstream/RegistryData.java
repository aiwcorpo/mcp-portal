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

    private static final Set<String> SERVER_IDS = Set.of("mcp-jira", "mcp-confluence", "mcp-gitlab", "mcp-servicedesk",
            "mcp-opensearch");
    public static final Pattern TOOL_NAME = Pattern.compile("^[a-z][a-z0-9]*(_[a-z0-9]+)*$");
    public static final Pattern DEFINITION_HASH = Pattern.compile("^sha256:[0-9a-f]{64}$");
    private static final Pattern SEMVER = Pattern
            .compile("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$");
    private static final Set<String> SERVER_FIELDS = Set.of("serverId", "system", "version", "enabled", "tools");
    private static final Set<String> TOOL_FIELDS = Set.of("name", "risk", "action", "resourceRefs", "definition",
            "definitionHash");
    private static final Set<String> REGISTRY_TOOL_FIELDS = Set.of("name", "risk", "action", "resourceRefs", "definition",
            "definitionHash", "status", "change", "source", "approvedInVersion");
    private static final Set<String> PENDING_FIELDS = Set.of("approvedEntry", "pendingEntry", "pendingHash",
            "pendingVersion", "source", "approvedInVersion");
    private static final Set<String> ACTIONS = Set.of("read", "update", "delete", "admin");
    private static final Set<String> SOURCES = Set.of("ci", "server");

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
    public static JsonNode validPending(JsonNode pending) {
        if (pending == null || !pending.isObject() || !onlyFields(pending, PENDING_FIELDS)
                || !pending.has("approvedEntry") || !pending.has("pendingEntry") || !pending.has("pendingHash")
                || !pending.has("pendingVersion") || !pending.has("source")) {
            return null;
        }
        JsonNode approved = pending.get("approvedEntry");
        JsonNode entry = pending.get("pendingEntry");
        JsonNode approvedIn = pending.get("approvedInVersion");
        boolean fits = (approved.isNull() || validTool(approved, TOOL_FIELDS, false))
                && validTool(entry, TOOL_FIELDS, false)
                && hash(pending.get("pendingHash"))
                && entry.get("definitionHash").equals(pending.get("pendingHash"))
                && semver(pending.get("pendingVersion"))
                && SOURCES.contains(text(pending.get("source")))
                && (approvedIn == null || approvedIn.isNull() && approved.isNull() || semver(approvedIn));
        return fits ? neutralized(pending) : null;
    }

    private static boolean validServer(JsonNode server) {
        if (server == null || !server.isObject() || !onlyFields(server, SERVER_FIELDS)
                || !SERVER_IDS.contains(text(server.get("serverId")))
                || !BrokerData.SYSTEMS.contains(text(server.get("system")))
                || !("mcp-" + server.get("system").asString()).equals(server.get("serverId").asString())
                || !semver(server.get("version"))
                || server.has("enabled") && !server.get("enabled").isBoolean()
                || server.get("tools") == null || !server.get("tools").isArray()) {
            return false;
        }
        for (JsonNode tool : server.get("tools")) {
            if (!validTool(tool, REGISTRY_TOOL_FIELDS, true)) {
                return false;
            }
        }
        return true;
    }

    private static boolean validTool(JsonNode tool, Set<String> fields, boolean registry) {
        if (tool == null || !tool.isObject() || !onlyFields(tool, fields)
                || !TOOL_NAME.matcher(text(tool.get("name"))).matches() || text(tool.get("name")).length() > 64
                || !BrokerData.RISKS.contains(text(tool.get("risk")))
                || !ACTIONS.contains(text(tool.get("action")))
                || tool.get("resourceRefs") == null || !tool.get("resourceRefs").isArray()
                || tool.get("definition") == null || !tool.get("definition").isObject()
                || !hash(tool.get("definitionHash"))) {
            return false;
        }
        if (!registry) {
            return true;
        }
        String status = text(tool.get("status"));
        boolean pending = "pending_approval".equals(status);
        if (!pending && !"approved".equals(status)) {
            return false;
        }
        // change and source are there exactly when the entry is pending (CC-097, CC-162).
        if (pending != tool.has("change") || pending != tool.has("source")) {
            return false;
        }
        if (pending && (!Set.of("new", "changed").contains(text(tool.get("change"))) || !SOURCES.contains(text(tool.get("source"))))) {
            return false;
        }
        JsonNode approvedIn = tool.get("approvedInVersion");
        return approvedIn == null || approvedIn.isNull() || semver(approvedIn);
    }

    private static boolean onlyFields(JsonNode node, Set<String> allowed) {
        return node.propertyNames().stream().allMatch(allowed::contains);
    }

    /** The text of a string node, or the empty string, which no pattern above accepts. */
    private static String text(JsonNode node) {
        return node != null && node.isString() ? node.asString() : "";
    }

    private static boolean hash(JsonNode node) {
        return DEFINITION_HASH.matcher(text(node)).matches();
    }

    private static boolean semver(JsonNode node) {
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
