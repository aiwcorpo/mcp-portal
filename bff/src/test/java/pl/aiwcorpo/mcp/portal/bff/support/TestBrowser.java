package pl.aiwcorpo.mcp.portal.bff.support;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Same-origin browser stand-in: keeps cookies by name (including {@code Secure} ones over http://localhost, as
 * browsers do), never follows redirects, and records every response for leak checks.
 */
public final class TestBrowser {

    private final URI origin;
    private final HttpClient http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();
    private final Map<String, String> cookies = new LinkedHashMap<>();
    private final List<HttpResponse<String>> history;
    private String referer;

    public TestBrowser(URI origin, List<HttpResponse<String>> history) {
        this.origin = origin;
        this.history = history;
    }

    public URI origin() {
        return origin;
    }

    public Optional<String> cookie(String name) {
        return Optional.ofNullable(cookies.get(name));
    }

    public void setReferer(String path) {
        this.referer = path == null ? null : origin.resolve(path).toString();
    }

    public HttpResponse<String> get(String pathOrUrl) {
        return send(request(pathOrUrl).GET(), Map.of());
    }

    public HttpResponse<String> get(String pathOrUrl, Map<String, String> headers) {
        return send(request(pathOrUrl).GET(), headers);
    }

    public HttpResponse<String> put(String path, String json, boolean withCsrf) {
        return send(request(path).PUT(HttpRequest.BodyPublishers.ofString(json)).header("Content-Type", "application/json"),
                csrf(withCsrf));
    }

    public HttpResponse<String> post(String path, String json, boolean withCsrf) {
        HttpRequest.Builder builder = request(path);
        builder = json == null ? builder.POST(HttpRequest.BodyPublishers.noBody())
                : builder.POST(HttpRequest.BodyPublishers.ofString(json)).header("Content-Type", "application/json");
        return send(builder, csrf(withCsrf));
    }

    public HttpResponse<String> delete(String path, boolean withCsrf) {
        return send(request(path).DELETE(), csrf(withCsrf));
    }

    public HttpResponse<String> send(HttpRequest.Builder builder, Map<String, String> headers) {
        headers.forEach(builder::header);
        if (!cookies.isEmpty()) {
            builder.header("Cookie", String.join("; ", cookies.entrySet().stream()
                    .map(e -> e.getKey() + "=" + e.getValue()).toList()));
        }
        if (referer != null) {
            builder.header("Referer", referer);
        }
        try {
            HttpResponse<String> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            history.add(response);
            storeCookies(response);
            return response;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    public List<String> setCookieHeaders(HttpResponse<String> response, String name) {
        List<String> result = new ArrayList<>();
        for (String header : response.headers().allValues("Set-Cookie")) {
            if (header.startsWith(name + "=")) {
                result.add(header);
            }
        }
        return result;
    }

    private Map<String, String> csrf(boolean withCsrf) {
        if (!withCsrf) {
            return Map.of();
        }
        return Map.of("X-XSRF-TOKEN", cookies.getOrDefault("__Host-XSRF-TOKEN", ""));
    }

    private HttpRequest.Builder request(String pathOrUrl) {
        URI uri = pathOrUrl.startsWith("http") ? URI.create(pathOrUrl) : origin.resolve(pathOrUrl);
        return HttpRequest.newBuilder(uri);
    }

    private void storeCookies(HttpResponse<String> response) {
        if (!response.uri().getHost().equals(origin.getHost()) || response.uri().getPort() != origin.getPort()) {
            return;
        }
        for (String header : response.headers().allValues("Set-Cookie")) {
            String pair = header.split(";", 2)[0];
            int eq = pair.indexOf('=');
            String name = pair.substring(0, eq).trim();
            String value = pair.substring(eq + 1).trim();
            boolean expired = header.toLowerCase().contains("max-age=0") || value.isEmpty();
            if (expired) {
                cookies.remove(name);
            } else {
                cookies.put(name, value);
            }
        }
    }
}
