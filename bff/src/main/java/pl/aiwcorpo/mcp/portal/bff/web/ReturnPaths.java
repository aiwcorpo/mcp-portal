package pl.aiwcorpo.mcp.portal.bff.web;

import java.util.regex.Pattern;

/**
 * {@code ReturnPath} from C4/C12 (CC-032): a portal path with an optional query, no percent sign and no backslash,
 * so no number of decoding passes turns it into {@code //host}. Valid values are used as is, never decoded.
 */
public final class ReturnPaths {

    public static final String DEFAULT = "/";

    private static final Pattern PATTERN = Pattern.compile("^/(?!/)[A-Za-z0-9._~!$&'()*+,;=:@/?-]*$");
    private static final int MAX_LENGTH = 512;

    private ReturnPaths() {
    }

    public static boolean isValid(String value) {
        return value != null && value.length() <= MAX_LENGTH && PATTERN.matcher(value).matches();
    }
}
