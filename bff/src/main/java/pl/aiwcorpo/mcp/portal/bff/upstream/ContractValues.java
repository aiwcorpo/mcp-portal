package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.time.format.DateTimeParseException;
import java.time.Instant;
import java.util.regex.Pattern;

/** Value rules of {@code common.schema.json} that more than one part of the BFF applies to data it passes on. */
public final class ContractValues {

    public static final Pattern CONFIRMATION_ID = Pattern.compile("^[A-Za-z0-9_-]{16,128}$");
    public static final Pattern ENROLLMENT_ID = Pattern.compile("^[A-Za-z0-9_-]{16,128}$");
    public static final Pattern CONFIRMATION_CODE = Pattern.compile("^[0-9]{6}$");
    public static final Pattern REQUEST_ID = Pattern
            .compile("^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
    /** {@code GroupName} of common.schema.json (C9). */
    public static final Pattern GROUP_NAME = Pattern.compile("^mcp-[A-Za-z0-9][A-Za-z0-9._-]*$");
    public static final int GROUP_NAME_MAX = 255;
    // Ids that name a platform component (mcp-gateway is the CN of the gateway certificate), so no system may take them (CC-237).
    private static final String RESERVED = "gateway|offboarding|portal|broker|prometheus|platform|admin|registry|adapter|internal|ci";
    /** {@code SystemId}: a row of the broker and the registry, not a list. */
    public static final Pattern SYSTEM_ID = Pattern.compile("^(?!(?:" + RESERVED + ")$)[a-z][a-z0-9]{1,30}$");
    /** {@code ServerId}: always {@code mcp-<system>}. */
    public static final Pattern SERVER_ID = Pattern.compile("^mcp-(?!(?:" + RESERVED + ")$)[a-z][a-z0-9]{1,30}$");
    /** {@code OverrideTarget}: the gateway, every server, or one server by the same pattern as {@code ServerId} (CC-244). */
    public static final Pattern OVERRIDE_TARGET = Pattern
            .compile("^(gateway|all-servers|mcp-(?!(?:" + RESERVED + ")$)[a-z][a-z0-9]{1,30})$");
    /** {@code SystemDisplayName} (CC-243): a short label without control, format or separator characters. */
    public static final Pattern SYSTEM_DISPLAY_NAME = Pattern
            .compile("^[^\\p{Cc}\\p{Cf}\\p{Cs}\\u2028\\u2029]{1,64}$");
    /** {@code QualifiedToolName}: {@code <system>__<tool>}. */
    public static final Pattern QUALIFIED_TOOL = Pattern.compile(
            "^(?!(?:" + RESERVED + ")__)[a-z][a-z0-9]{1,30}__[a-z][a-z0-9]*(_[a-z0-9]+)*$");
    /** {@code ResourceType}: {@code <Namespace>::<Name>}, declared by a server. */
    public static final Pattern RESOURCE_TYPE = Pattern.compile("^[A-Z][A-Za-z0-9]{0,30}::[A-Z][A-Za-z0-9]{0,30}$");
    /** {@code ResourceScopeId}: {@code <Type>/<local part>}, ASCII only. */
    public static final Pattern RESOURCE_SCOPE_ID = Pattern
            .compile("^[A-Z][A-Za-z0-9]{0,30}::[A-Z][A-Za-z0-9]{0,30}/[!-~]{1,1024}$");
    public static final java.util.Set<String> SYSTEM_ADAPTERS = java.util.Set.of("atlassian-dc", "gitlab", "opensearch",
            "generic-rest");
    public static final java.util.Set<String> SYSTEM_PRODUCTS = java.util.Set.of("jira", "confluence");
    /** {@code SystemTimeout}: ISO 8601, at most 10 minutes. */
    public static final Pattern SYSTEM_TIMEOUT = Pattern.compile("^PT(?:[1-9][0-9]{0,2}S|[1-9]M(?:[0-5]?[0-9]S)?|10M)$");
    /** {@code DefinitionHash} and {@code policiesHash}. */
    public static final Pattern HASH = Pattern.compile("^sha256:[0-9a-f]{64}$");

    private ContractValues() {
    }

    public static boolean isSystemId(String value) {
        return value != null && SYSTEM_ID.matcher(value).matches();
    }

    /** A display name the BFF accepts or passes on: the contract pattern, and no character that {@link TextHygiene} hides. */
    public static boolean isDisplayName(String value) {
        return value != null && SYSTEM_DISPLAY_NAME.matcher(value).matches() && TextHygiene.isClean(value, false);
    }

    public static boolean isServerId(String value) {
        return value != null && SERVER_ID.matcher(value).matches();
    }

    /** {@code Timestamp}: ISO 8601 date-time in UTC with the suffix {@code Z}. */
    public static boolean isTimestamp(String value) {
        if (value == null || !value.endsWith("Z")) {
            return false;
        }
        try {
            Instant.parse(value);
            return true;
        } catch (DateTimeParseException e) {
            return false;
        }
    }
}
