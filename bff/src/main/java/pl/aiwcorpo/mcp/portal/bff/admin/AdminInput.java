package pl.aiwcorpo.mcp.portal.bff.admin;

import java.util.Set;
import java.util.regex.Pattern;

import pl.aiwcorpo.mcp.portal.bff.upstream.AdminViews;
import pl.aiwcorpo.mcp.portal.bff.upstream.ContractValues;
import pl.aiwcorpo.mcp.portal.bff.upstream.TextHygiene;
import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Request bodies of the administration mirrors, checked against the C12 schemas by hand: a closed set of fields, the
 * JSON type each one names, the patterns and limits. A body that does not fit is {@code null} (the controller answers
 * the plain 400). Only fields the schema knows are copied, so nothing else can reach the upstream. Cross-field rules
 * that depend on registry state (a serverId that matches its system, a default type among the supported ones) stay
 * with the upstream, which answers 422 with a reason.
 */
final class AdminInput {

    static final int MAX_BODY = 64 * 1024;
    static final Pattern IF_MATCH = Pattern.compile("^\"[A-Za-z0-9_-]{8,128}\"$");

    private static final Set<String> CREDENTIAL_TYPES = Set.of("user-oauth", "user-secret", "token-exchange", "service-account");
    private static final Set<String> CREDENTIAL_SCHEMES = Set.of("Bearer", "Basic", "Token", "ApiKey");
    private static final Set<String> USER_SECRET_SCHEMES = Set.of("Bearer", "Basic");
    private static final Set<String> TLS_MODES = Set.of("ca", "pinned", "plain");
    private static final Pattern SERVER_URL = Pattern.compile("^https?://[!-~]+$");
    private static final Pattern INTERNAL_URL = Pattern.compile("^https://[!-~]{1,247}$");
    private static final Pattern SCOPE_CHARS = Pattern.compile("^[!#-\\[\\]-~]{1,128}$");
    private static final JsonMapper MAPPER = JsonMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .build();

    private AdminInput() {
    }

    /** The body as a JSON object, or null when it is missing, too large, not JSON, not an object or has a repeated key. */
    static ObjectNode object(byte[] raw) {
        if (raw == null || raw.length == 0 || raw.length > MAX_BODY) {
            return null;
        }
        try {
            return MAPPER.readTree(raw) instanceof ObjectNode node ? node : null;
        } catch (JacksonException e) {
            return null;
        }
    }

    static boolean wellFormedEtag(String value) {
        return value != null && IF_MATCH.matcher(value).matches();
    }

    /** {@code ServerAddRequest}: the address, and optionally the plain-http flag and the credential declaration. */
    static JsonNode serverAdd(byte[] raw) {
        ObjectNode in = object(raw);
        if (in == null || !only(in, "internalUrl", "allowPlainHttp", "credential") || !in.has("internalUrl")
                || !SERVER_URL.matcher(string(in, "internalUrl")).matches() || string(in, "internalUrl").length() > 255
                || in.has("allowPlainHttp") && !in.get("allowPlainHttp").isBoolean()
                || in.has("credential") && !credential(in.get("credential"))) {
            return null;
        }
        return in;
    }

    /**
     * {@code ServerConfigPatch}: at least one of the settings. The address and the plain-http flag are fixed when the
     * server is added (CC-249), and {@code adapter} comes from the manifest, so none of them is accepted.
     */
    static JsonNode serverPatch(byte[] raw) {
        ObjectNode in = object(raw);
        if (in == null || in.isEmpty() || !only(in, "credential", "enabled")
                || in.has("enabled") && !in.get("enabled").isBoolean()
                || in.has("credential") && !credential(in.get("credential"))) {
            return null;
        }
        return in;
    }

    /** {@code ConnectionApproveRequest}: the mode chosen and the fingerprint the administrator saw ({@code null} for plain). */
    static JsonNode connectionApprove(byte[] raw) {
        ObjectNode in = object(raw);
        if (in == null || !only(in, "tlsMode", "fingerprint") || !in.has("tlsMode") || !in.has("fingerprint")
                || !TLS_MODES.contains(string(in, "tlsMode"))) {
            return null;
        }
        JsonNode fingerprint = in.get("fingerprint");
        return fingerprint.isNull() || ContractValues.HASH.matcher(string(in, "fingerprint")).matches() ? in : null;
    }

    private static boolean credential(JsonNode node) {
        if (!(node instanceof ObjectNode in) || !only(in, "required", "acceptedTypes", "type")
                || !in.has("required") || !in.get("required").isBoolean() || !in.has("type")
                || !CREDENTIAL_TYPES.contains(string(in, "type"))) {
            return false;
        }
        return typeList(in.get("acceptedTypes"));
    }

    private static boolean typeList(JsonNode node) {
        if (node == null || !node.isArray() || node.isEmpty() || node.size() > CREDENTIAL_TYPES.size()) {
            return false;
        }
        return node.valueStream().allMatch(v -> v.isString() && CREDENTIAL_TYPES.contains(v.asString()))
                && node.valueStream().map(JsonNode::asString).distinct().count() == node.size();
    }

    /** True for the one body that needs no fresh MFA: it only takes the server out of service (CC-240). */
    static boolean onlyDisables(JsonNode patch) {
        return patch.size() == 1 && patch.has("enabled") && patch.get("enabled").isBoolean()
                && !patch.get("enabled").asBoolean();
    }

    /** {@code ScopeMappingDocument}. A group listed twice or a scope the registry does not know is the gateway's 422. */
    static JsonNode scopeMapping(byte[] raw) {
        ObjectNode in = object(raw);
        if (in == null || !only(in, "scopeMapping") || !(in.get("scopeMapping") instanceof tools.jackson.databind.node.ArrayNode entries)
                || entries.size() > 5000) {
            return null;
        }
        for (JsonNode entry : entries) {
            if (!(entry instanceof ObjectNode e) || !only(e, "group", "scopes") || !e.has("group") || !e.get("group").isString()
                    || !AdminViews.validGroup(e.get("group").asString())
                    || !(e.get("scopes") instanceof tools.jackson.databind.node.ArrayNode scopes) || scopes.size() > 1000
                    || !scopes.valueStream().allMatch(s -> s.isString() && AdminViews.validScope(s.asString()))
                    || scopes.valueStream().map(JsonNode::asString).distinct().count() != scopes.size()) {
                return null;
            }
        }
        return in;
    }

    /** {@code OverrideRequest}: the text is one Cedar policy, shown to administrators, so no hidden characters. */
    static JsonNode override(byte[] raw) {
        ObjectNode in = object(raw);
        if (in == null || !only(in, "target", "text") || !ContractValues.OVERRIDE_TARGET.matcher(string(in, "target")).matches()) {
            return null;
        }
        String text = string(in, "text");
        return !text.isEmpty() && text.length() <= 8000 && TextHygiene.isClean(text, true) ? in : null;
    }

    /** {@code ApprovePoliciesRequest}. */
    static String policiesHash(byte[] raw) {
        ObjectNode in = object(raw);
        if (in == null || !only(in, "policiesHash") || !ContractValues.HASH.matcher(string(in, "policiesHash")).matches()) {
            return null;
        }
        return in.get("policiesHash").asString();
    }

    /**
     * {@code SystemAdminRequest}. The client secret stays in the tree that goes to the broker and is read nowhere else.
     * The rules that tie fields together in the schema (product for atlassian-dc only, exchangeAudience for token-exchange
     * only) are applied here; the rest (oauth required, secret required again after an address change) is the broker's.
     */
    static JsonNode systemRequest(byte[] raw) {
        ObjectNode in = object(raw);
        if (in == null || !only(in, "displayName", "baseUrl", "adapter", "product", "revokeUrl", "timeout", "exchangeAudience",
                "userSecretScheme", "supportedTypes", "defaultType", "secretScheme", "oauth", "whoami")
                || !in.has("baseUrl") || !in.has("adapter") || !in.has("supportedTypes") || !in.has("defaultType")
                || !in.has("secretScheme")) {
            return null;
        }
        if (in.has("displayName") && !ContractValues.isDisplayName(string(in, "displayName"))) {
            return null;
        }
        String adapter = string(in, "adapter");
        if (!isUrl(string(in, "baseUrl")) || !ContractValues.SYSTEM_ADAPTERS.contains(adapter)
                || !typeList(in.get("supportedTypes")) || !CREDENTIAL_TYPES.contains(string(in, "defaultType"))
                || !CREDENTIAL_SCHEMES.contains(string(in, "secretScheme"))) {
            return null;
        }
        if (in.has("whoami") && (!"generic-rest".equals(adapter) || !ContractValues.isWhoami(in.get("whoami")))) {
            return null;
        }
        boolean atlassian = "atlassian-dc".equals(adapter);
        boolean tokenExchange = in.get("supportedTypes").valueStream().anyMatch(v -> "token-exchange".equals(v.asString()));
        if (atlassian != in.has("product") || atlassian && !ContractValues.SYSTEM_PRODUCTS.contains(string(in, "product"))
                || tokenExchange != in.has("exchangeAudience")
                || in.has("exchangeAudience") && !bounded(string(in, "exchangeAudience"), 255)
                || in.has("revokeUrl") && !isUrl(string(in, "revokeUrl"))
                || in.has("timeout") && !ContractValues.SYSTEM_TIMEOUT.matcher(string(in, "timeout")).matches()
                || in.has("userSecretScheme") && !USER_SECRET_SCHEMES.contains(string(in, "userSecretScheme"))) {
            return null;
        }
        return !in.has("oauth") || oauth(in.get("oauth")) ? in : null;
    }

    private static boolean oauth(JsonNode node) {
        if (!(node instanceof ObjectNode in) || !only(in, "clientId", "clientSecret", "authorizeUrl", "tokenUrl", "scopes")
                || !bounded(string(in, "clientId"), 255)
                || in.has("clientSecret") && !bounded(string(in, "clientSecret"), 1024)
                || in.has("authorizeUrl") && !isUrl(string(in, "authorizeUrl"))
                || in.has("tokenUrl") && !isUrl(string(in, "tokenUrl"))) {
            return false;
        }
        if (!in.has("scopes")) {
            return true;
        }
        JsonNode scopes = in.get("scopes");
        return scopes.isArray() && scopes.size() <= 100
                && scopes.valueStream().allMatch(s -> s.isString() && SCOPE_CHARS.matcher(s.asString()).matches())
                && scopes.valueStream().map(JsonNode::asString).distinct().count() == scopes.size();
    }

    private static boolean isUrl(String value) {
        return value.length() <= 255 && INTERNAL_URL.matcher(value).matches();
    }

    private static boolean bounded(String value, int max) {
        return !value.isEmpty() && value.length() <= max;
    }

    private static boolean only(ObjectNode node, String... allowed) {
        Set<String> names = Set.of(allowed);
        return node.propertyNames().stream().allMatch(names::contains);
    }

    /** The text of a string field, or the empty string for anything else (no pattern here accepts it). */
    private static String string(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.isString() ? value.asString() : "";
    }
}
