package pl.aiwcorpo.mcp.portal.bff.web;

final class ErrorCodes {

    private ErrorCodes() {
    }

    static String forStatus(int status) {
        return switch (status) {
            case 400, 405, 406, 413, 415 -> ApiError.INVALID_REQUEST;
            case 401 -> ApiError.UNAUTHENTICATED;
            case 403 -> ApiError.ACCESS_DENIED;
            case 404 -> ApiError.NOT_FOUND_OR_DENIED;
            case 502, 503, 504 -> ApiError.UPSTREAM_UNAVAILABLE;
            default -> status >= 400 && status < 500 ? ApiError.INVALID_REQUEST : ApiError.INTERNAL_ERROR;
        };
    }
}
