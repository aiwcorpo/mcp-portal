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
    public static final Pattern VIRTUAL_SERVER_SLUG = Pattern.compile("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$");
    public static final Pattern QUALIFIED_TOOL = Pattern
            .compile("^(jira|confluence|gitlab|servicedesk|opensearch)__[a-z][a-z0-9]*(_[a-z0-9]+)*$");

    private ContractValues() {
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
