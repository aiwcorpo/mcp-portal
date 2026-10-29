package pl.aiwcorpo.mcp.portal.bff.web;

import java.util.Map;

import org.springframework.http.HttpStatus;

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

    /**
     * {@code 429 rate_limited} with {@code Retry-After} (seconds, at least 1) and no other header (CC-156). A limit of
     * another component that did not say when to retry gives {@code null}: the header is left out rather than invented.
     */
    public static ApiException rateLimited(Long retryAfterSeconds) {
        return new ApiException(HttpStatus.TOO_MANY_REQUESTS, ApiError.of(ApiError.RATE_LIMITED),
                retryAfterSeconds == null ? Map.of() : Map.of("Retry-After", Long.toString(Math.max(1, retryAfterSeconds))));
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
