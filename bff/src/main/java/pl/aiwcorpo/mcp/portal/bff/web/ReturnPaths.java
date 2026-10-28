package pl.aiwcorpo.mcp.portal.bff.web;

import java.util.Set;
import java.util.regex.Pattern;

/**
 * {@code ReturnPath} from C4/C12 (CC-032, CC-099): a portal path with an optional query, no percent sign, no
 * backslash and no semicolon, so no number of decoding passes turns it into {@code //host} and no matrix parameter
 * hides a prefix. The first segment may not be one the reverse proxy routes elsewhere ({@code api}, {@code s},
 * {@code v}, {@code .well-known}) and no segment of the path may be {@code .} or {@code ..}. Valid values are used
 * as is, never decoded.
 */
public final class ReturnPaths {

    public static final String DEFAULT = "/";

    private static final Pattern PATTERN = Pattern.compile("^/(?!/)[A-Za-z0-9._~!$&'()*+,=:@/?-]*$");
    private static final Set<String> RESERVED_FIRST_SEGMENTS = Set.of("api", "s", "v", ".well-known");
    private static final int MAX_LENGTH = 512;

    private ReturnPaths() {
    }

    public static boolean isValid(String value) {
        if (value == null || value.length() > MAX_LENGTH || !PATTERN.matcher(value).matches()) {
            return false;
        }
        int query = value.indexOf('?');
        String path = query < 0 ? value : value.substring(0, query);
        String[] segments = path.substring(1).split("/", -1);
        if (RESERVED_FIRST_SEGMENTS.contains(segments[0])) {
            return false;
        }
        for (String segment : segments) {
            if (segment.equals(".") || segment.equals("..")) {
                return false;
            }
        }
        return true;
    }
}
