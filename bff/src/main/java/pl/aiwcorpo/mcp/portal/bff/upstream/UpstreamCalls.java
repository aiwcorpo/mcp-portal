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
                throw new UpstreamException(name, status, errorCode(response));
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

    private static String errorCode(ClientHttpResponse response) {
        try (InputStream body = response.getBody()) {
            byte[] bytes = body.readNBytes(MAX_ERROR_BODY);
            JsonNode node = MAPPER.readTree(bytes);
            JsonNode error = node == null ? null : node.get("error");
            if (error != null && error.isString() && ERROR_CODE.matcher(error.asString()).matches()) {
                return error.asString();
            }
        } catch (IOException | RuntimeException ignored) {
            // Body is not the C4/C5 Error JSON; the status alone decides.
        }
        return null;
    }
}
