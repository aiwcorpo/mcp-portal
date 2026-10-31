package pl.aiwcorpo.mcp.portal.bff.web;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

import jakarta.servlet.http.HttpServletRequest;

import pl.aiwcorpo.mcp.portal.bff.config.PublicUrls;

/**
 * {@code ReturnPath} from C4/C12 (CC-032, CC-099): a portal path with an optional query, no percent sign, no
 * backslash and no semicolon, so no number of decoding passes turns it into {@code //host} and no matrix parameter
 * hides a prefix. The first segment may not be one the reverse proxy routes elsewhere ({@code api}, {@code mcp},
 * {@code s}, {@code v}, {@code .well-known}) and no segment of the path may be {@code .} or {@code ..}. Valid values are used
 * as is, never decoded.
 */
public final class ReturnPaths {

    public static final String DEFAULT = "/";

    private static final Pattern PATTERN = Pattern.compile("^/(?!/)[A-Za-z0-9._~!$&'()*+,=:@/?-]*$");
    private static final Set<String> RESERVED_FIRST_SEGMENTS = Set.of("api", "mcp", "s", "v", ".well-known");
    private static final int MAX_LENGTH = 512;

    private ReturnPaths() {
    }

    /**
     * U12: where a step-up started from a page should come back to, so that the page can finish what the user had begun
     * without a second click. That is the page that sent the request (same-origin {@code Referer}, path and query, never the
     * fragment), when it is a valid return path; otherwise {@code fallback}. The origin is compared with the configured
     * public one, never with {@code Host}, so a foreign page cannot choose the destination.
     */
    public static String pageOf(HttpServletRequest request, PublicUrls publicUrls, String fallback) {
        String referer = request.getHeader("Referer");
        if (referer == null || referer.length() > MAX_LENGTH * 2) {
            return fallback;
        }
        try {
            URI page = new URI(referer);
            if (page.getRawFragment() != null || page.getRawUserInfo() != null || page.getRawPath() == null
                    || page.getScheme() == null || !originOf(page).toLowerCase(Locale.ROOT).equals(publicUrls.base().toLowerCase(Locale.ROOT))) {
                return fallback;
            }
            String candidate = page.getRawPath() + (page.getRawQuery() == null ? "" : "?" + page.getRawQuery());
            return isValid(candidate) ? candidate : fallback;
        } catch (URISyntaxException e) {
            return fallback;
        }
    }

    private static String originOf(URI uri) {
        return uri.getScheme() + "://" + uri.getRawAuthority();
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
