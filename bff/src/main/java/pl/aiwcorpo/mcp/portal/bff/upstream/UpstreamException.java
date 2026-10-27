package pl.aiwcorpo.mcp.portal.bff.upstream;

/**
 * Non-2xx answer of C4/C5 or no answer at all ({@code status} 0). {@code error} is the {@code error} field of the
 * upstream JSON body when present; nothing else from the body is kept.
 */
public class UpstreamException extends RuntimeException {

    private final int status;
    private final String error;

    public UpstreamException(String upstream, int status, String error) {
        super(upstream + " answered " + status + (error == null ? "" : " " + error), null, false, false);
        this.status = status;
        this.error = error;
    }

    /** No usable answer. Only exception types are kept: messages of I/O errors may quote the request. */
    public UpstreamException(String upstream, Throwable failure) {
        super(upstream + " unreachable: " + failure.getClass().getSimpleName()
                + (failure.getCause() == null ? "" : " / " + failure.getCause().getClass().getSimpleName()),
                null, false, false);
        this.status = 0;
        this.error = null;
    }

    public int status() {
        return status;
    }

    public String error() {
        return error;
    }
}
