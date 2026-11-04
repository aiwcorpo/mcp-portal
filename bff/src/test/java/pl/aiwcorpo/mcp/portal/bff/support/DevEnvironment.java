package pl.aiwcorpo.mcp.portal.bff.support;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A running dev stack ({@code make up}): configuration read from its {@code .env} and generated
 * {@code .secrets/dev.env} at test time, never copied into this repository.
 */
public final class DevEnvironment {

    private static final Pattern LOGIN_FORM = Pattern.compile("<form[^>]*id=\"kc-form-login\"[^>]*>", Pattern.DOTALL);
    private static final Pattern ACTION = Pattern.compile("action=\"([^\"]+)\"");

    private final Path root;
    private final Map<String, String> values = new HashMap<>();

    private DevEnvironment(Path root) {
        this.root = root;
        values.putAll(read(root.resolve(".env")));
        values.putAll(read(root.resolve(".secrets/dev.env")));
    }

    public static DevEnvironment locate() {
        String configured = System.getenv("MCP_PLATFORM_DEV_DIR");
        Path root = configured != null ? Path.of(configured) : Path.of("../../mcp-platform-dev");
        return new DevEnvironment(root.toAbsolutePath().normalize());
    }

    public boolean keycloakReachable() {
        try {
            HttpResponse<Void> response = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build().send(
                    HttpRequest.newBuilder(URI.create(issuer() + "/.well-known/openid-configuration")).build(),
                    HttpResponse.BodyHandlers.discarding());
            return response.statusCode() == 200 && Files.isRegularFile(root.resolve(".secrets/dev.env"));
        } catch (IOException e) {
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    /**
     * Whether the realm accepts this redirect URI for the BFF client: Keycloak answers an unknown one with 400 and
     * its error page instead of redirecting to the login form. Needs no secret.
     */
    public boolean realmAcceptsRedirectUri(String redirectUri) {
        try {
            HttpResponse<Void> response = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build().send(
                    HttpRequest.newBuilder(URI.create(issuer() + "/protocol/openid-connect/auth?client_id=mcp-portal-bff"
                            + "&response_type=code&scope=openid&redirect_uri=" + enc(redirectUri))).build(),
                    HttpResponse.BodyHandlers.discarding());
            return response.statusCode() == 200 || response.statusCode() == 302;
        } catch (IOException e) {
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    public String value(String key) {
        String value = values.get(key);
        if (value == null) {
            throw new IllegalStateException("the dev stack has no " + key);
        }
        return value;
    }

    public String issuer() {
        return "http://localhost:" + values.getOrDefault("KEYCLOAK_PORT", "18080") + "/realms/corp";
    }

    public Path certs() {
        return root.resolve("certs");
    }

    public String password(String user) {
        return value("KC_USER_" + user.toUpperCase() + "_PASSWORD");
    }

    /**
     * Fills the Keycloak login form for the authorization request the BFF redirected to and returns the redirect
     * back to the BFF. When Keycloak skips the form (live SSO session without max_age), its redirect is returned.
     */
    public URI keycloakLogin(TestBrowser keycloak, URI authorizationRequest, String user) {
        HttpResponse<String> page = keycloak.get(authorizationRequest.toString());
        if (page.statusCode() == 302) {
            return URI.create(page.headers().firstValue("Location").orElseThrow());
        }
        Matcher form = LOGIN_FORM.matcher(page.body());
        if (!form.find()) {
            throw new IllegalStateException("no Keycloak login form (HTTP " + page.statusCode() + ")");
        }
        Matcher action = ACTION.matcher(form.group());
        if (!action.find()) {
            throw new IllegalStateException("login form without action");
        }
        String target = action.group(1).replace("&amp;", "&");
        String body = "username=" + enc(user) + "&password=" + enc(password(user)) + "&credentialId=";
        HttpResponse<String> posted = keycloak.send(HttpRequest.newBuilder(URI.create(target))
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .header("Content-Type", "application/x-www-form-urlencoded"), Map.of());
        if (posted.statusCode() != 302) {
            throw new IllegalStateException("Keycloak login of " + user + " failed: HTTP " + posted.statusCode());
        }
        return URI.create(posted.headers().firstValue("Location").orElseThrow());
    }

    /** True when Keycloak shows its login form for the request, i.e. there is no SSO session to reuse. */
    public boolean asksForCredentials(TestBrowser keycloak, URI authorizationRequest) {
        HttpResponse<String> page = keycloak.get(authorizationRequest.toString());
        return page.statusCode() == 200 && LOGIN_FORM.matcher(page.body()).find();
    }

    private static String enc(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8);
    }

    private static Map<String, String> read(Path file) {
        Map<String, String> result = new HashMap<>();
        if (!Files.isRegularFile(file)) {
            return result;
        }
        try {
            List<String> lines = Files.readAllLines(file);
            for (String line : lines) {
                String trimmed = line.trim();
                int eq = trimmed.indexOf('=');
                if (!trimmed.isEmpty() && !trimmed.startsWith("#") && eq > 0) {
                    result.put(trimmed.substring(0, eq).trim(), trimmed.substring(eq + 1).trim());
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return result;
    }
}
