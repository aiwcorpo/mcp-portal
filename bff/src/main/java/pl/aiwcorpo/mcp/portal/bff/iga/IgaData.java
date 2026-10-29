package pl.aiwcorpo.mcp.portal.bff.iga;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import pl.aiwcorpo.mcp.portal.bff.upstream.ContractValues;
import pl.aiwcorpo.mcp.portal.bff.upstream.TextHygiene;

/**
 * What the IGA adapter returns is checked against C12 before it reaches the browser. A catalog text is untrusted: it
 * is shown as text, and hidden characters in it are written out like in any other text from outside (CC-121). An item
 * that does not fit is dropped with a warning that carries no value.
 */
public final class IgaData {

    private static final Logger log = LoggerFactory.getLogger(IgaData.class);

    static final int MAX_DESCRIPTION = 500;
    private static final int MAX_REQUEST_ID = 128;
    private static final int MAX_URL = 2048;
    private static final Set<String> STATUSES = Set.of("pending", "approved", "rejected", "cancelled");
    private static final Pattern URL_CHARS = Pattern.compile("^[\\x21-\\x7e]+$");

    private IgaData() {
    }

    public static List<AccessGovernance.AccessRequest> validRequests(List<AccessGovernance.AccessRequest> requests,
                                                                     boolean allowPlainHttp) {
        List<AccessGovernance.AccessRequest> result = new ArrayList<>();
        for (AccessGovernance.AccessRequest request : requests == null ? List.<AccessGovernance.AccessRequest>of() : requests) {
            AccessGovernance.AccessRequest checked = validRequest(request, allowPlainHttp);
            if (checked == null) {
                log.warn("Dropping an IGA request outside the contract");
            } else {
                result.add(checked);
            }
        }
        return result;
    }

    private static AccessGovernance.AccessRequest validRequest(AccessGovernance.AccessRequest request,
                                                               boolean allowPlainHttp) {
        if (request == null || request.requestId() == null || request.requestId().isEmpty()
                || request.requestId().length() > MAX_REQUEST_ID || !TextHygiene.isClean(request.requestId(), false)
                || !validEntitlement(request.entitlement()) || !STATUSES.contains(request.status())
                || !ContractValues.isTimestamp(request.createdAt())
                || request.decidedAt() != null && !ContractValues.isTimestamp(request.decidedAt())
                || request.requestUrl() != null && !isSafeUrl(request.requestUrl(), allowPlainHttp)) {
            return null;
        }
        // The contract says decidedAt is absent while the request is pending.
        String decidedAt = request.pending() ? null : request.decidedAt();
        return new AccessGovernance.AccessRequest(request.requestId(), request.entitlement(), request.status(),
                request.createdAt(), decidedAt, request.requestUrl());
    }

    /** Entitlements the user can order: valid names only, text neutralized and cut, names the user already holds left out. */
    public static List<AccessGovernance.Entitlement> requestable(List<AccessGovernance.Entitlement> catalog,
                                                                 Set<String> held) {
        List<AccessGovernance.Entitlement> result = new ArrayList<>();
        for (AccessGovernance.Entitlement entitlement : catalog == null ? List.<AccessGovernance.Entitlement>of() : catalog) {
            if (entitlement == null || !validEntitlement(entitlement.name())) {
                log.warn("Dropping an IGA catalog entry outside the contract");
                continue;
            }
            if (held.contains(entitlement.name())) {
                continue;
            }
            String description = entitlement.description();
            if (description != null) {
                description = TextHygiene.cutAtNotation(TextHygiene.neutralize(description), MAX_DESCRIPTION);
            }
            result.add(new AccessGovernance.Entitlement(entitlement.name(),
                    description == null || description.isBlank() ? null : description));
        }
        return result;
    }

    /** The result of {@code request}: exactly one of a safe URL and a request id, otherwise null (an adapter fault). */
    public static AccessGovernance.RequestResult validResult(AccessGovernance.RequestResult result, boolean allowPlainHttp) {
        if (result == null || (result.requestUrl() == null) == (result.requestId() == null)) {
            return null;
        }
        if (result.requestUrl() != null) {
            return isSafeUrl(result.requestUrl(), allowPlainHttp) ? result : null;
        }
        boolean fits = !result.requestId().isEmpty() && result.requestId().length() <= MAX_REQUEST_ID
                && TextHygiene.isClean(result.requestId(), false);
        return fits ? result : null;
    }

    public static boolean validEntitlement(String name) {
        return name != null && name.length() <= ContractValues.GROUP_NAME_MAX && ContractValues.GROUP_NAME.matcher(name).matches();
    }

    /**
     * The browser is sent to this address or shows it as a link, and the IGA is outside the platform: https only (plain
     * http in the dev profile), a host, no credentials in the address, printable ASCII, so a {@code javascript:} or
     * {@code data:} URL cannot get through.
     */
    static boolean isSafeUrl(String value, boolean allowPlainHttp) {
        if (value.length() > MAX_URL || !URL_CHARS.matcher(value).matches()) {
            return false;
        }
        try {
            URI uri = new URI(value);
            boolean scheme = "https".equalsIgnoreCase(uri.getScheme())
                    || allowPlainHttp && "http".equalsIgnoreCase(uri.getScheme());
            return scheme && uri.getHost() != null && uri.getRawUserInfo() == null && uri.getRawFragment() == null;
        } catch (URISyntaxException e) {
            return false;
        }
    }
}
