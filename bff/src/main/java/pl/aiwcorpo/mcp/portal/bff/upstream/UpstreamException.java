package pl.aiwcorpo.mcp.portal.bff.upstream;

/**
 * Non-2xx answer of C4/C5 or no answer at all ({@code status} 0). {@code error} is the {@code error} field of the
 * upstream JSON body when present. Of the rest of the body only {@code reason} and {@code message} are kept (the
 * {@code ManifestRejected} of a registry approval, which C12 passes on), checked against their patterns and limits;
 * of the headers only {@code Retry-After} as a number of seconds.
 */
public class UpstreamException extends RuntimeException {

    private final int status;
    private final String error;
    private final String reason;
    private final String message;
    private final Integer retryAfterSeconds;

    public UpstreamException(String upstream, int status, String error) {
        this(upstream, status, error, null, null, null);
    }

    public UpstreamException(String upstream, int status, String error, String reason, String message,
                             Integer retryAfterSeconds) {
        super(upstream + " answered " + status + (error == null ? "" : " " + error), null, false, false);
        this.status = status;
        this.error = error;
        this.reason = reason;
        this.message = message;
        this.retryAfterSeconds = retryAfterSeconds;
    }

    /** No usable answer. Only exception types are kept: messages of I/O errors may quote the request. */
    public UpstreamException(String upstream, Throwable failure) {
        super(upstream + " unreachable: " + failure.getClass().getSimpleName()
                + (failure.getCause() == null ? "" : " / " + failure.getCause().getClass().getSimpleName()),
                null, false, false);
        this.status = 0;
        this.error = null;
        this.reason = null;
        this.message = null;
        this.retryAfterSeconds = null;
    }

    public int status() {
        return status;
    }

    public String error() {
        return error;
    }

    /** {@code reason} of the upstream body (pattern {@code ^[a-z][a-z0-9_]{0,63}$}), or null. */
    public String reason() {
        return reason;
    }

    /** {@code message} of the upstream body, at most 500 characters, hidden characters not yet neutralized; or null. */
    public String upstreamMessage() {
        return message;
    }

    /** {@code Retry-After} in seconds (at least 1), or null when absent or not a plain number. */
    public Integer retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
