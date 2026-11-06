package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.util.Set;
import java.util.regex.Pattern;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;

/**
 * Checks what the administration operations of C5 and C4 return (servers, scope mapping, overrides, pending policies,
 * systems) against the closed schemas of the contract before it reaches the administrator's browser, and writes the
 * hidden characters of every text out (CC-121), as {@link RegistryData} does for tool definitions. Policy text, patterns
 * and override text are written by people or pipelines the administrator has not met. A view that does not fit is
 * null: the caller treats it as a contract breach, never as a partial answer. A client secret has no field in any view,
 * so one that the broker returned by mistake fails the closed schema and never gets to the browser.
 */
public final class AdminViews {

    private static final Set<String> SERVER_FIELDS = Set.of("serverId", "system", "internalUrl", "credential", "enabled",
            "adapter");
    private static final Set<String> CREDENTIAL_FIELDS = Set.of("required", "acceptedTypes", "type");
    private static final Set<String> OVERRIDE_FIELDS = Set.of("id", "target", "text", "setBy", "setAt");
    private static final Set<String> PENDING_POLICIES_FIELDS = Set.of("approvedHash", "approvedPolicies",
            "approvedResourceTypes", "pendingHash", "pendingPolicies", "pendingResourceTypes", "pendingVersion", "source");
    private static final Set<String> POLICIES_FIELDS = Set.of("namespace", "schema", "files");
    private static final Set<String> RESOURCE_TYPE_FIELDS = Set.of("type", "attributes", "parent", "parentAttribute",
            "idPattern", "scopePattern", "earlyScopeCheck", "classification");
    private static final Set<String> SYSTEM_FIELDS = Set.of("system", "baseUrl", "adapter", "product", "revokeUrl",
            "timeout", "exchangeAudience", "userSecretScheme", "supportedTypes", "defaultType", "secretScheme", "oauth");
    private static final Set<String> OAUTH_VIEW_FIELDS = Set.of("clientId", "authorizeUrl", "tokenUrl", "scopes",
            "clientSecretSet");
    private static final Set<String> USER_SECRET_SCHEMES = Set.of("Bearer", "Basic");
    private static final Set<String> CREDENTIAL_SCHEMES = Set.of("Bearer", "Basic", "Token", "ApiKey");
    private static final Pattern HTTPS = Pattern.compile("^https://\\S{1,247}$");
    private static final Pattern OVERRIDE_ID = Pattern.compile("^override-[a-z0-9][a-z0-9-]{0,54}$");
    private static final Pattern OVERRIDE_TARGET = Pattern.compile("^(gateway|all-servers|mcp-[a-z][a-z0-9]{1,30})$");
    private static final Pattern NAMESPACE = Pattern.compile("^[A-Z][A-Za-z0-9]{0,30}$");
    private static final Pattern FILE_NAME = Pattern.compile("^[a-z0-9][a-z0-9._-]{0,63}\\.cedar$");
    private static final Pattern ATTRIBUTE = Pattern.compile("^[a-z][A-Za-z0-9]*$");
    private static final Pattern REASON = Pattern.compile("^[a-z][a-z0-9_]*$");
    private static final int MAX_MAPPING_ENTRIES = 5000;
    private static final int MAX_SCOPES = 1000;

    private AdminViews() {
    }

    public static JsonNode servers(JsonNode list) {
        return list(list, AdminViews::server);
    }

    public static JsonNode server(JsonNode node) {
        boolean fits = node != null && node.isObject() && RegistryData.onlyFields(node, SERVER_FIELDS)
                && SERVER_FIELDS.stream().allMatch(node::has)
                && ContractValues.isServerId(RegistryData.text(node.get("serverId")))
                && ContractValues.isSystemId(RegistryData.text(node.get("system")))
                && HTTPS.matcher(RegistryData.text(node.get("internalUrl"))).matches()
                && node.get("enabled").isBoolean() && node.get("adapter").isBoolean()
                && serverCredential(node.get("credential"));
        return fits ? RegistryData.neutralized(node) : null;
    }

    private static boolean serverCredential(JsonNode node) {
        return node != null && node.isObject() && RegistryData.onlyFields(node, CREDENTIAL_FIELDS)
                && CREDENTIAL_FIELDS.stream().allMatch(node::has) && node.get("required").isBoolean()
                && credentialTypes(node.get("acceptedTypes"))
                && BrokerData.CREDENTIAL_TYPES.contains(RegistryData.text(node.get("type")));
    }

    private static boolean credentialTypes(JsonNode node) {
        if (node == null || !node.isArray() || node.isEmpty()) {
            return false;
        }
        long distinct = node.valueStream().map(RegistryData::text).distinct().count();
        return distinct == node.size()
                && node.valueStream().allMatch(v -> BrokerData.CREDENTIAL_TYPES.contains(RegistryData.text(v)));
    }

    /** The whole mapping document; the entries are the contract's {@code ScopeMappingEntry}. */
    public static JsonNode scopeMapping(JsonNode node) {
        if (node == null || !node.isObject() || !RegistryData.onlyFields(node, Set.of("scopeMapping"))
                || node.get("scopeMapping") == null || !node.get("scopeMapping").isArray()
                || node.get("scopeMapping").size() > MAX_MAPPING_ENTRIES) {
            return null;
        }
        for (JsonNode entry : node.get("scopeMapping")) {
            if (!validMappingEntry(entry)) {
                return null;
            }
        }
        return RegistryData.neutralized(node);
    }

    private static boolean validMappingEntry(JsonNode entry) {
        if (entry == null || !entry.isObject() || !RegistryData.onlyFields(entry, Set.of("group", "scopes"))
                || !validGroup(RegistryData.text(entry.get("group")))
                || entry.get("scopes") == null || !entry.get("scopes").isArray() || entry.get("scopes").size() > MAX_SCOPES) {
            return false;
        }
        long distinct = entry.get("scopes").valueStream().map(RegistryData::text).distinct().count();
        return distinct == entry.get("scopes").size()
                && entry.get("scopes").valueStream().allMatch(s -> validScope(RegistryData.text(s)));
    }

    /** {@code GroupName} with its length limit. */
    public static boolean validGroup(String group) {
        return group.length() <= ContractValues.GROUP_NAME_MAX && ContractValues.GROUP_NAME.matcher(group).matches();
    }

    public static boolean validScope(String scope) {
        return scope.length() <= 1100 && ContractValues.RESOURCE_SCOPE_ID.matcher(scope).matches();
    }

    public static JsonNode overrides(JsonNode list) {
        return list(list, AdminViews::override);
    }

    public static JsonNode override(JsonNode node) {
        boolean fits = node != null && node.isObject() && RegistryData.onlyFields(node, OVERRIDE_FIELDS)
                && OVERRIDE_FIELDS.stream().allMatch(node::has)
                && OVERRIDE_ID.matcher(RegistryData.text(node.get("id"))).matches()
                && OVERRIDE_TARGET.matcher(RegistryData.text(node.get("target"))).matches()
                && boundedText(node.get("text"), 8000) && boundedText(node.get("setBy"), 255)
                && ContractValues.isTimestamp(RegistryData.text(node.get("setAt")));
        return fits ? RegistryData.neutralized(node) : null;
    }

    private static boolean boundedText(JsonNode node, int max) {
        String text = RegistryData.text(node);
        return !text.isEmpty() && text.length() <= max;
    }

    /** {@code PendingPolicies}: policies and the declarations of the resource types, approved next to pending (A5). */
    public static JsonNode pendingPolicies(JsonNode node) {
        if (node == null || !node.isObject() || !RegistryData.onlyFields(node, PENDING_POLICIES_FIELDS)
                || !PENDING_POLICIES_FIELDS.stream().allMatch(node::has)) {
            return null;
        }
        JsonNode approvedHash = node.get("approvedHash");
        boolean fits = (approvedHash.isNull() || RegistryData.hash(approvedHash))
                && (node.get("approvedPolicies").isNull() || policies(node.get("approvedPolicies")))
                && (node.get("approvedResourceTypes").isNull() || resourceTypes(node.get("approvedResourceTypes")))
                && RegistryData.hash(node.get("pendingHash"))
                && policies(node.get("pendingPolicies"))
                && resourceTypes(node.get("pendingResourceTypes"))
                && RegistryData.semver(node.get("pendingVersion"))
                && Set.of("ci", "server").contains(RegistryData.text(node.get("source")));
        return fits ? RegistryData.neutralized(node) : null;
    }

    private static boolean policies(JsonNode node) {
        if (node == null || !node.isObject() || !RegistryData.onlyFields(node, POLICIES_FIELDS)
                || !POLICIES_FIELDS.stream().allMatch(node::has)
                || !NAMESPACE.matcher(RegistryData.text(node.get("namespace"))).matches()
                || RegistryData.text(node.get("schema")).isEmpty()
                || !node.get("files").isArray() || node.get("files").size() > 100) {
            return false;
        }
        for (JsonNode file : node.get("files")) {
            if (file == null || !file.isObject() || !RegistryData.onlyFields(file, Set.of("name", "text"))
                    || !FILE_NAME.matcher(RegistryData.text(file.get("name"))).matches()
                    || file.get("text") == null || !file.get("text").isString()) {
                return false;
            }
        }
        return true;
    }

    private static boolean resourceTypes(JsonNode node) {
        if (node == null || !node.isArray()) {
            return false;
        }
        for (JsonNode type : node) {
            if (type == null || !type.isObject() || !RegistryData.onlyFields(type, RESOURCE_TYPE_FIELDS)
                    || !ContractValues.RESOURCE_TYPE.matcher(RegistryData.text(type.get("type"))).matches()
                    || type.get("attributes") == null || !type.get("attributes").isArray()
                    || !type.get("attributes").valueStream().allMatch(a -> ATTRIBUTE.matcher(RegistryData.text(a)).matches())
                    || type.get("idPattern") == null || !type.get("idPattern").isString()
                    || type.has("parent") != type.has("parentAttribute")
                    || type.has("parent")
                            && !ContractValues.RESOURCE_TYPE.matcher(RegistryData.text(type.get("parent"))).matches()
                    || type.has("scopePattern") && !type.get("scopePattern").isString()
                    || type.has("earlyScopeCheck") && !type.get("earlyScopeCheck").isBoolean()
                    || type.has("classification") && !type.get("classification").isObject()) {
                return false;
            }
        }
        return true;
    }

    /** {@code ApprovePoliciesResult}: the mapping entries that the approval makes invalid. */
    public static JsonNode approveResult(JsonNode node) {
        if (node == null || !node.isObject() || !RegistryData.onlyFields(node, Set.of("ignoredMappingEntries"))
                || node.get("ignoredMappingEntries") == null || !node.get("ignoredMappingEntries").isArray()) {
            return null;
        }
        for (JsonNode entry : node.get("ignoredMappingEntries")) {
            if (entry == null || !entry.isObject() || !RegistryData.onlyFields(entry, Set.of("group", "scope", "reason"))
                    || entry.get("group") == null || !entry.get("group").isString()
                    || entry.get("scope") == null || !entry.get("scope").isString()
                    || !REASON.matcher(RegistryData.text(entry.get("reason"))).matches()) {
                return null;
            }
        }
        return RegistryData.neutralized(node);
    }

    public static JsonNode systems(JsonNode list) {
        return list(list, AdminViews::system);
    }

    /** {@code SystemAdminView}; {@code oauth.clientSecretSet} says whether a secret exists, never what it is. */
    public static JsonNode system(JsonNode node) {
        boolean fits = node != null && node.isObject() && RegistryData.onlyFields(node, SYSTEM_FIELDS)
                && ContractValues.isSystemId(RegistryData.text(node.get("system")))
                && urlOrAbsent(node, "baseUrl", true)
                && ContractValues.SYSTEM_ADAPTERS.contains(RegistryData.text(node.get("adapter")))
                && (!node.has("product") || ContractValues.SYSTEM_PRODUCTS.contains(RegistryData.text(node.get("product"))))
                && urlOrAbsent(node, "revokeUrl", false)
                && (!node.has("timeout")
                        || ContractValues.SYSTEM_TIMEOUT.matcher(RegistryData.text(node.get("timeout"))).matches())
                && (!node.has("exchangeAudience") || boundedText(node.get("exchangeAudience"), 255))
                && (!node.has("userSecretScheme")
                        || USER_SECRET_SCHEMES.contains(RegistryData.text(node.get("userSecretScheme"))))
                && credentialTypes(node.get("supportedTypes"))
                && BrokerData.CREDENTIAL_TYPES.contains(RegistryData.text(node.get("defaultType")))
                && CREDENTIAL_SCHEMES.contains(RegistryData.text(node.get("secretScheme")))
                && (!node.has("oauth") || oauthView(node.get("oauth")));
        return fits ? RegistryData.neutralized(node) : null;
    }

    private static boolean urlOrAbsent(JsonNode node, String field, boolean required) {
        if (!node.has(field)) {
            return !required;
        }
        String value = RegistryData.text(node.get(field));
        // A broker in its dev profile may keep an http address, so only the shape of a URL is checked on the way out.
        return value.length() <= 255 && value.matches("^https?://\\S+$");
    }

    private static boolean oauthView(JsonNode oauth) {
        return oauth.isObject() && RegistryData.onlyFields(oauth, OAUTH_VIEW_FIELDS)
                && boundedText(oauth.get("clientId"), 255)
                && oauth.has("clientSecretSet") && oauth.get("clientSecretSet").isBoolean()
                && (!oauth.has("authorizeUrl") || oauth.get("authorizeUrl").isString())
                && (!oauth.has("tokenUrl") || oauth.get("tokenUrl").isString())
                && (!oauth.has("scopes") || oauth.get("scopes").isArray()
                        && oauth.get("scopes").valueStream().allMatch(JsonNode::isString));
    }

    private interface View {
        JsonNode check(JsonNode node);
    }

    private static JsonNode list(JsonNode list, View view) {
        if (list == null || !list.isArray()) {
            return null;
        }
        ArrayNode checked = JsonNodeFactory.instance.arrayNode();
        for (JsonNode element : list) {
            JsonNode shown = view.check(element);
            if (shown == null) {
                return null;
            }
            checked.add(shown);
        }
        return checked;
    }
}
