package pl.aiwcorpo.mcp.portal.bff.web;

import com.fasterxml.jackson.annotation.JsonInclude;

/** Generic C12 error body (CC-012, CC-087). {@code message} never carries upstream text. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiError(String error, String message, String requestId) {

    public static final String INVALID_REQUEST = "invalid_request";
    public static final String UNAUTHENTICATED = "unauthenticated";
    public static final String ACCESS_DENIED = "access_denied";
    public static final String CSRF_INVALID = "csrf_invalid";
    public static final String NOT_FOUND_OR_DENIED = "not_found_or_denied";
    public static final String UPSTREAM_UNAVAILABLE = "upstream_unavailable";
    public static final String INTERNAL_ERROR = "internal_error";

    public static ApiError of(String error) {
        return new ApiError(error, null, null);
    }

    public ApiError withRequestId(String id) {
        return new ApiError(error, message, id);
    }
}
