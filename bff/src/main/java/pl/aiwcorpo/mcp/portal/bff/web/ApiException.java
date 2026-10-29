package pl.aiwcorpo.mcp.portal.bff.web;

import java.util.Map;

import org.springframework.http.HttpStatus;

import pl.aiwcorpo.mcp.portal.bff.upstream.UpstreamException;

/** Ends an API call with a given status and JSON body. The body must already be safe to show to the browser. */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final transient Object body;
    private final transient Map<String, String> headers;

    public ApiException(HttpStatus status, Object body) {
        this(status, body, Map.of());
    }

    public ApiException(HttpStatus status, Object body, Map<String, String> headers) {
        super(status.toString(), null, false, false);
        this.status = status;
        this.body = body;
        this.headers = headers;
    }

    /** Wait announced when the broker limited a request but sent no usable {@code Retry-After}; C12 promises the header. */
    public static final long DEFAULT_RETRY_AFTER_SECONDS = 60;

    /** {@code 429 rate_limited} with {@code Retry-After} (seconds, at least 1) and no other header (CC-156). */
    public static ApiException rateLimited(long retryAfterSeconds) {
        return new ApiException(HttpStatus.TOO_MANY_REQUESTS, ApiError.of(ApiError.RATE_LIMITED),
                Map.of("Retry-After", Long.toString(Math.max(1, retryAfterSeconds))));
    }

    /**
     * For the operations whose C12 description lists a 429: a limit of the broker, with its {@code Retry-After} or the
     * default. Anything else is returned as it is (it becomes a 503).
     */
    public static RuntimeException limitOf(RuntimeException failure) {
        if (!(failure instanceof UpstreamException upstream) || upstream.status() != 429) {
            return failure;
        }
        return rateLimited(upstream.retryAfterSeconds() == null ? DEFAULT_RETRY_AFTER_SECONDS : upstream.retryAfterSeconds());
    }

    public static ApiException badRequest() {
        return new ApiException(HttpStatus.BAD_REQUEST, ApiError.of(ApiError.INVALID_REQUEST));
    }

    public static ApiException unauthenticated() {
        return new ApiException(HttpStatus.UNAUTHORIZED, ApiError.of(ApiError.UNAUTHENTICATED));
    }

    public HttpStatus status() {
        return status;
    }

    public Object body() {
        return body;
    }

    public Map<String, String> headers() {
        return headers;
    }
}
