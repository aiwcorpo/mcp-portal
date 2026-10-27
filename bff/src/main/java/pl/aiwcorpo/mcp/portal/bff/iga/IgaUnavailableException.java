package pl.aiwcorpo.mcp.portal.bff.iga;

/** The IGA adapter cannot answer for this user; mapped to 503 like any other unavailable upstream. */
public class IgaUnavailableException extends RuntimeException {

    public IgaUnavailableException(String message) {
        super(message, null, false, false);
    }
}
