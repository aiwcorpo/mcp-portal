package pl.aiwcorpo.mcp.portal.bff.support;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpHeaders;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
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

    /** Plants a cookie the way a browser extension or an attacker on a sibling host would. */
    public void setCookie(String name, String value) {
        cookies.put(name, value);
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

    /**
     * GET with the request target written byte for byte, for queries that {@link java.net.URI} refuses to build (a lone
     * percent sign, {@code %zz}); a browser sends such a target as typed. Cookies and Referer are those of the session.
     */
    public HttpResponse<String> getRawTarget(String rawTarget) {
        StringBuilder head = new StringBuilder("GET ").append(rawTarget).append(" HTTP/1.1\r\nHost: ")
                .append(origin.getHost()).append(':').append(origin.getPort()).append("\r\nConnection: close\r\n");
        if (!cookies.isEmpty()) {
            head.append("Cookie: ").append(String.join("; ", cookies.entrySet().stream()
                    .map(e -> e.getKey() + "=" + e.getValue()).toList())).append("\r\n");
        }
        if (referer != null) {
            head.append("Referer: ").append(referer).append("\r\n");
        }
        head.append("\r\n");
        try (Socket socket = new Socket(origin.getHost(), origin.getPort())) {
            socket.getOutputStream().write(head.toString().getBytes(StandardCharsets.US_ASCII));
            socket.getOutputStream().flush();
            ByteArrayOutputStream raw = new ByteArrayOutputStream();
            socket.getInputStream().transferTo(raw);
            HttpResponse<String> response = parseRaw(raw.toString(StandardCharsets.UTF_8), origin.resolve("/"));
            history.add(response);
            storeCookies(response);
            return response;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Status line, headers and the body, decoded when chunked. */
    private static HttpResponse<String> parseRaw(String text, URI uri) {
        int split = text.indexOf("\r\n\r\n");
        String[] lines = text.substring(0, split).split("\r\n");
        int status = Integer.parseInt(lines[0].split(" ")[1]);
        Map<String, List<String>> map = new LinkedHashMap<>();
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            map.computeIfAbsent(lines[i].substring(0, colon).trim(), k -> new ArrayList<>()).add(lines[i].substring(colon + 1).trim());
        }
        String body = text.substring(split + 4);
        if (map.entrySet().stream().anyMatch(e -> e.getKey().equalsIgnoreCase("Transfer-Encoding")
                && e.getValue().stream().anyMatch(v -> v.equalsIgnoreCase("chunked")))) {
            body = dechunk(body);
        }
        HttpHeaders headers = HttpHeaders.of(map, (k, v) -> true);
        return new RawResponse(status, headers, body, uri);
    }

    private static String dechunk(String chunked) {
        StringBuilder out = new StringBuilder();
        int at = 0;
        while (true) {
            int eol = chunked.indexOf("\r\n", at);
            int size = Integer.parseInt(chunked.substring(at, eol).split(";")[0].trim(), 16);
            if (size == 0) {
                return out.toString();
            }
            out.append(chunked, eol + 2, eol + 2 + size);
            at = eol + 2 + size + 2;
        }
    }

    private record RawResponse(int statusCode, HttpHeaders headers, String body, URI uri) implements HttpResponse<String> {
        @Override
        public HttpRequest request() {
            return HttpRequest.newBuilder(uri).build();
        }

        @Override
        public Optional<HttpResponse<String>> previousResponse() {
            return Optional.empty();
        }

        @Override
        public Optional<javax.net.ssl.SSLSession> sslSession() {
            return Optional.empty();
        }

        @Override
        public HttpClient.Version version() {
            return HttpClient.Version.HTTP_1_1;
        }
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

    public HttpResponse<String> post(String path, String json, boolean withCsrf, Map<String, String> extraHeaders) {
        HttpRequest.Builder builder = request(path);
        builder = json == null ? builder.POST(HttpRequest.BodyPublishers.noBody())
                : builder.POST(HttpRequest.BodyPublishers.ofString(json)).header("Content-Type", "application/json");
        Map<String, String> headers = new LinkedHashMap<>(csrf(withCsrf));
        headers.putAll(extraHeaders);
        return send(builder, headers);
    }

    public HttpResponse<String> delete(String path, boolean withCsrf, Map<String, String> extraHeaders) {
        Map<String, String> headers = new LinkedHashMap<>(csrf(withCsrf));
        headers.putAll(extraHeaders);
        return send(request(path).DELETE(), headers);
    }

    public HttpResponse<String> delete(String path, boolean withCsrf) {
        return send(request(path).DELETE(), csrf(withCsrf));
    }

    /** Any method with a JSON body (null for none) and extra headers, for the operations that carry preconditions. */
    public HttpResponse<String> request(String method, String path, String json, boolean withCsrf,
                                        Map<String, String> extraHeaders) {
        HttpRequest.Builder builder = request(path);
        if (json == null) {
            builder.method(method, HttpRequest.BodyPublishers.noBody());
        } else {
            builder.method(method, HttpRequest.BodyPublishers.ofString(json)).header("Content-Type", "application/json");
        }
        Map<String, String> headers = new LinkedHashMap<>(csrf(withCsrf));
        headers.putAll(extraHeaders);
        return send(builder, headers);
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
