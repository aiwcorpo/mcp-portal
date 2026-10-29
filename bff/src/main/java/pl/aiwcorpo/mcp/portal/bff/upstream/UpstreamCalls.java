package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.io.IOException;
import java.io.InputStream;
import java.util.function.Function;
import java.util.regex.Pattern;

import org.springframework.http.HttpHeaders;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import pl.aiwcorpo.mcp.portal.bff.token.BearerToken;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Shared request plumbing for C4 and C5 clients: bearer token, request id, uniform error mapping. */
final class UpstreamCalls {

    // Newer minor versions of C4/C5 may add optional response fields; reading must not fail on them.
    private static final JsonMapper MAPPER = JsonMapper.builder()
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();
    private static final Pattern ERROR_CODE = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final int MAX_ERROR_BODY = 4096;
    private static final int MAX_MESSAGE = 500;

    private final String name;
    private final RestClient http;

    UpstreamCalls(String name, RestClient http) {
        this.name = name;
        this.http = http;
    }

    RestClient.RequestHeadersSpec<?> authorize(RestClient.RequestHeadersSpec<?> spec, BearerToken token, String requestId) {
        return spec.header(HttpHeaders.AUTHORIZATION, token.authorizationHeader())
                .header("X-Request-Id", requestId);
    }

    RestClient http() {
        return http;
    }

    /** Runs the call and turns any non-2xx answer or I/O failure into {@link UpstreamException}. */
    <T> T call(RestClient.RequestHeadersSpec<?> spec, Function<ClientHttpResponse, T> onSuccess) {
        try {
            return spec.exchange((request, response) -> {
                int status = response.getStatusCode().value();
                if (status >= 200 && status < 300) {
                    return onSuccess.apply(response);
                }
                ErrorBody body = errorBody(response);
                throw new UpstreamException(name, status, body.error(), body.reason(), body.message(),
                        retryAfter(response.getHeaders().getFirst(HttpHeaders.RETRY_AFTER)));
            });
        } catch (UpstreamException e) {
            throw e;
        } catch (RestClientException e) {
            if (e.getCause() instanceof UpstreamException upstream) {
                throw upstream;
            }
            throw new UpstreamException(name, e);
        }
    }

    <T> T read(ClientHttpResponse response, Class<T> type) {
        try (InputStream body = response.getBody()) {
            return MAPPER.readerFor(type).readValue(body);
        } catch (IOException | RuntimeException e) {
            throw new UpstreamException(name, 502, null);
        }
    }

    <T> T read(ClientHttpResponse response, TypeReference<T> type) {
        try (InputStream body = response.getBody()) {
            return MAPPER.readerFor(type).readValue(body);
        } catch (IOException | RuntimeException e) {
            throw new UpstreamException(name, 502, null);
        }
    }

    private record ErrorBody(String error, String reason, String message) {
    }

    private static ErrorBody errorBody(ClientHttpResponse response) {
        try (InputStream body = response.getBody()) {
            byte[] bytes = body.readNBytes(MAX_ERROR_BODY);
            JsonNode node = MAPPER.readTree(bytes);
            return new ErrorBody(text(node, "error", ERROR_CODE), text(node, "reason", ERROR_CODE), message(node));
        } catch (IOException | RuntimeException ignored) {
            // Body is not the C4/C5 Error JSON; the status alone decides.
            return new ErrorBody(null, null, null);
        }
    }

    private static String text(JsonNode node, String field, Pattern pattern) {
        JsonNode value = node == null ? null : node.get(field);
        return value != null && value.isString() && pattern.matcher(value.asString()).matches() ? value.asString() : null;
    }

    private static String message(JsonNode node) {
        JsonNode value = node == null ? null : node.get("message");
        return value != null && value.isString() && !value.asString().isEmpty()
                && value.asString().length() <= MAX_MESSAGE ? value.asString() : null;
    }

    /** Delta-seconds only (RFC 9110); an HTTP date or anything else is treated as absent. */
    static Integer retryAfter(String header) {
        if (header == null || !header.matches("[0-9]{1,9}")) {
            return null;
        }
        return Math.max(1, Integer.parseInt(header));
    }
}
