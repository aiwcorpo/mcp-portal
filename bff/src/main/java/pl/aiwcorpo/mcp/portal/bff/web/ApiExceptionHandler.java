package pl.aiwcorpo.mcp.portal.bff.web;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import pl.aiwcorpo.mcp.portal.bff.token.TokenUnavailableException;
import pl.aiwcorpo.mcp.portal.bff.upstream.UpstreamException;

/**
 * Every MVC error becomes the C12 {@code Error} JSON. Exception messages are never copied into the response
 * or the log: a JSON parse error of {@code PUT .../secret} could quote the request body.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Object> api(ApiException e) {
        return json(e.status(), e.body());
    }

    @ExceptionHandler(TokenUnavailableException.class)
    ResponseEntity<Object> tokenUnavailable(TokenUnavailableException e) {
        log.warn("{}", e.getMessage());
        return json(HttpStatus.SERVICE_UNAVAILABLE, ApiError.of(ApiError.UPSTREAM_UNAVAILABLE));
    }

    @ExceptionHandler(UpstreamException.class)
    ResponseEntity<Object> upstream(UpstreamException e) {
        log.warn("{}", e.getMessage());
        return json(HttpStatus.SERVICE_UNAVAILABLE, ApiError.of(ApiError.UPSTREAM_UNAVAILABLE));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Object> other(Exception e) {
        if (e instanceof ErrorResponse framework) {
            HttpStatus status = HttpStatus.resolve(framework.getStatusCode().value());
            if (status != null && status.is4xxClientError()) {
                return json(status, ApiError.of(ErrorCodes.forStatus(status.value())));
            }
        }
        if (e instanceof org.springframework.http.converter.HttpMessageNotReadableException
                || e instanceof org.springframework.web.method.annotation.MethodArgumentTypeMismatchException) {
            return json(HttpStatus.BAD_REQUEST, ApiError.of(ApiError.INVALID_REQUEST));
        }
        log.error("Unhandled exception of type {}", e.getClass().getName());
        return json(HttpStatus.INTERNAL_SERVER_ERROR, ApiError.of(ApiError.INTERNAL_ERROR));
    }

    private static ResponseEntity<Object> json(HttpStatus status, Object body) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(body);
    }
}
