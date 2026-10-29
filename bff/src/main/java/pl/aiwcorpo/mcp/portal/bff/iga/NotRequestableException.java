package pl.aiwcorpo.mcp.portal.bff.iga;

/** The adapter has no request flow, or does not know the entitlement; C12 answers 422 {@code not_requestable}. */
public class NotRequestableException extends RuntimeException {

    public NotRequestableException() {
        super("not requestable", null, false, false);
    }
}
