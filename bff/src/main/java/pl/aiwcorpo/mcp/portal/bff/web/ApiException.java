package pl.aiwcorpo.mcp.portal.bff.web;

import org.springframework.http.HttpStatus;

/** Ends an API call with a given status and JSON body. The body must already be safe to show to the browser. */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final transient Object body;

    public ApiException(HttpStatus status, Object body) {
        super(status.toString(), null, false, false);
        this.status = status;
        this.body = body;
    }

    public static ApiException badRequest() {
        return new ApiException(HttpStatus.BAD_REQUEST, ApiError.of(ApiError.INVALID_REQUEST));
    }

    public static ApiException unauthenticated() {
        return new ApiException(HttpStatus.UNAUTHORIZED, ApiError.of(ApiError.UNAUTHENTICATED));
    }

    public static ApiException upstreamUnavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, ApiError.of(ApiError.UPSTREAM_UNAVAILABLE));
    }

    public HttpStatus status() {
        return status;
    }

    public Object body() {
        return body;
    }
}
