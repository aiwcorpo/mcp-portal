package pl.aiwcorpo.mcp.portal.bff.web;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;

import org.springframework.boot.webmvc.error.ErrorController;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Replaces Spring Boot's error controller so that errors raised outside MVC (filters, the container) are JSON
 * as well; whitelabel HTML would break the rule that /api/** never answers with HTML.
 */
@RestController
public class JsonErrorController implements ErrorController {

    @RequestMapping("/error")
    ResponseEntity<ApiError> error(HttpServletRequest request) {
        Object code = request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
        int status = code instanceof Integer i ? i : HttpStatus.INTERNAL_SERVER_ERROR.value();
        HttpStatus resolved = HttpStatus.resolve(status);
        return ResponseEntity.status(resolved == null ? HttpStatus.INTERNAL_SERVER_ERROR : resolved)
                .contentType(MediaType.APPLICATION_JSON)
                .body(ApiError.of(ErrorCodes.forStatus(status)).withRequestId(RequestIds.of(request)));
    }
}
