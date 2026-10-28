package pl.aiwcorpo.mcp.portal.bff.support;

import java.util.List;
import java.util.regex.Pattern;

import pl.aiwcorpo.mcp.portal.bff.web.ReturnPaths;

/**
 * What the contract allows in a redirect the BFF sends after OAuth or at the OAuth callback without a session
 * (README "Wektory testowe", test-vectors/connect-redirects): a portal path whose last query parameter is the
 * outcome, from a closed set optionally followed by the system (CC-111), and nothing else the provider or the broker said.
 */
public final class ConnectRedirectRules {

    private static final Pattern CONNECTED = Pattern.compile("^connected=(jira|confluence|gitlab|servicedesk|opensearch)$");
    private static final Pattern SYSTEM = Pattern.compile("^system=(jira|confluence|gitlab|servicedesk|opensearch)$");
    private static final List<String> ERRORS = List.of("identity_mismatch", "flow_invalid", "provider_error", "cancelled");

    private ConnectRedirectRules() {
    }

    public static boolean isValid(String location) {
        if (!ReturnPaths.isValid(location)) {
            return false;
        }
        int query = location.indexOf('?');
        if (query < 0) {
            return false;
        }
        String path = location.substring(0, query);
        String[] parameters = location.substring(query + 1).split("&");
        String last = parameters[parameters.length - 1];
        if (parameters.length >= 2 && SYSTEM.matcher(last).matches()) {
            String error = parameters[parameters.length - 2];
            return error.startsWith("connectError=") && ERRORS.contains(error.substring("connectError=".length()));
        }
        if (path.equals("/") && last.equals("loginError=session_expired")) {
            return true;
        }
        if (CONNECTED.matcher(last).matches()) {
            return true;
        }
        return last.startsWith("connectError=") && ERRORS.contains(last.substring("connectError=".length()));
    }
}
