package pl.aiwcorpo.mcp.portal.bff.setup;

import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.net.ConnectException;
import java.net.URI;
import java.net.UnknownHostException;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.cert.CertPathValidatorException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLException;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

import pl.aiwcorpo.mcp.portal.bff.upstream.PinnedNameTrustManager;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.dataformat.yaml.YAMLMapper;

/**
 * Check of one portal installation, run as {@code java -jar app.jar init} before the portal starts (the init service of
 * deploy/compose.yaml, ExecStartPre of the systemd unit). The portal keeps no state of its own (sessions are in memory, no database,
 * no Redis), so nothing is generated: it only checks what the portal will need and stops with exit code 1 and the likely cause when
 * the portal could not start or could not sign anyone in.
 *
 * <p>The identity provider is a failure, because without it nobody can sign in. The credential broker and the gateway admin API only
 * warn: they may be installed after the portal, and the portal starts without them.
 *
 * <p>The checks use the same trust as the portal: the JVM store for the identity provider, the truststore with the pinned server name
 * for the broker and the gateway.
 */
public final class PortalSetup {

    static final List<String> REQUIRED = List.of("PORTAL_PUBLIC_BASE_URL", "PORTAL_OIDC_ISSUER_URI", "PORTAL_OIDC_CLIENT_SECRET",
            "PORTAL_BROKER_URL", "PORTAL_BROKER_TLS_NAME", "PORTAL_GATEWAY_ADMIN_URL", "PORTAL_GATEWAY_ADMIN_TLS_NAME",
            "PORTAL_TLS_KEYSTORE", "PORTAL_TLS_KEYSTORE_PASSWORD", "PORTAL_TLS_TRUSTSTORE", "PORTAL_TLS_TRUSTSTORE_PASSWORD",
            "PORTAL_IGA_ADAPTER", "PORTAL_IGA_CATALOG_FILE");

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final Map<String, String> env;
    private final PrintStream out;
    private int failures;

    PortalSetup(Map<String, String> env, PrintStream out) {
        this.env = new LinkedHashMap<>(env);
        this.out = out;
    }

    public static int run() {
        return new PortalSetup(System.getenv(), System.out).check();
    }

    int check() {
        List<String> missing = new ArrayList<>(REQUIRED.stream().filter(name -> blank(env.get(name))).toList());
        if (blank(env.get("PORTAL_STEP_UP_ACR_VALUES")) && blank(env.get("PORTAL_STEP_UP_AMR_VALUES"))) {
            missing.add("PORTAL_STEP_UP_ACR_VALUES (or PORTAL_STEP_UP_AMR_VALUES)");
        }
        if (!missing.isEmpty()) {
            fail("not set: " + String.join(", ", missing));
        } else {
            checkConfiguration();
        }
        if (failures > 0) {
            out.println();
            out.println(failures + " problem(s): fix them in the configuration and start again.");
            return 1;
        }
        out.println();
        out.println("Ready to start.");
        return 0;
    }

    private void checkConfiguration() {
        checkPublicUrl();
        checkTrustedProxies();
        checkCatalog();
        HttpClient jvmTrust = HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).followRedirects(HttpClient.Redirect.NEVER).build();
        checkIdentityProvider(jvmTrust);
        if (!tls()) {
            return;
        }
        reachUpstream("credential broker", env.get("PORTAL_BROKER_URL"), env.get("PORTAL_BROKER_TLS_NAME"));
        reachUpstream("gateway admin API", env.get("PORTAL_GATEWAY_ADMIN_URL"), env.get("PORTAL_GATEWAY_ADMIN_TLS_NAME"));
    }

    /** The session cookie is __Host- and Secure, so a portal behind plain http would sign in and then lose the session. */
    private void checkPublicUrl() {
        String value = env.get("PORTAL_PUBLIC_BASE_URL");
        URI uri;
        try {
            uri = URI.create(value);
        } catch (IllegalArgumentException e) {
            fail("PORTAL_PUBLIC_BASE_URL " + value + " is not a valid address");
            return;
        }
        String path = uri.getRawPath();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || !(path == null || path.isEmpty() || path.equals("/"))
                || uri.getRawQuery() != null || uri.getRawUserInfo() != null) {
            fail("PORTAL_PUBLIC_BASE_URL " + value + " must be the https origin of your reverse proxy (https://host[:port], no path)");
            return;
        }
        ok("public address " + value + ", login callback " + value.replaceAll("/$", "") + "/api/v1/auth/callback");
    }

    private void checkTrustedProxies() {
        if (blank(env.get("PORTAL_TRUSTED_PROXIES")) && blank(env.get("PORTAL_TRUSTED_PROXY_HOST"))) {
            out.println("warn  PORTAL_TRUSTED_PROXIES is not set: X-Forwarded-* is trusted from the loopback address only, so a reverse"
                    + " proxy on another host is not believed");
        } else {
            ok("trusted proxies: " + Objects.requireNonNullElse(env.get("PORTAL_TRUSTED_PROXIES"), env.get("PORTAL_TRUSTED_PROXY_HOST")));
        }
    }

    /** The portal refuses an empty catalog and a misspelled key; the check reads the file the way the adapter does. */
    private void checkCatalog() {
        if (!"keycloak-groups".equals(env.get("PORTAL_IGA_ADAPTER"))) {
            fail("PORTAL_IGA_ADAPTER " + env.get("PORTAL_IGA_ADAPTER") + ": only keycloak-groups works outside the dev profile");
            return;
        }
        Path file = Path.of(env.get("PORTAL_IGA_CATALOG_FILE"));
        if (!Files.isReadable(file)) {
            fail("IGA catalog file " + file + " does not exist or cannot be read");
            return;
        }
        try {
            JsonNode catalog = YAMLMapper.builder().build().readTree(Files.readString(file));
            List<String> unknown = new ArrayList<>(catalog.propertyNames());
            unknown.removeAll(List.of("entitlements", "descriptions"));
            if (!unknown.isEmpty()) {
                fail("IGA catalog file " + file + ": unknown key " + String.join(", ", unknown) + " (only entitlements and descriptions)");
                return;
            }
            long systems = catalog.path("entitlements").propertyNames().size();
            if (systems == 0) {
                fail("IGA catalog file " + file + " lists no entitlements: the portal does not start with an empty catalog");
                return;
            }
            ok("IGA catalog " + file + ": " + systems + " system(s)");
        } catch (IOException | JacksonException e) {
            fail("IGA catalog file " + file + " is not valid YAML: " + rootMessage(e));
        }
    }

    /** Without PORTAL_OIDC_TOKEN_URI the portal discovers the endpoints under the issuer and compares its own answer with the issuer. */
    private void checkIdentityProvider(HttpClient http) {
        if (!blank(env.get("PORTAL_OIDC_TOKEN_URI"))) {
            checkExplicitEndpoints(http);
            return;
        }
        String issuer = env.get("PORTAL_OIDC_ISSUER_URI");
        String url = issuer.replaceAll("/$", "") + "/.well-known/openid-configuration";
        HttpResponse<String> response = get("identity provider", url, http, true);
        if (response == null) {
            return;
        }
        try {
            JsonNode document = JSON.readTree(response.body());
            if (response.statusCode() != 200 || !document.path("token_endpoint").isString()) {
                fail("identity provider " + url + ": HTTP " + response.statusCode() + " without a discovery document; check PORTAL_OIDC_ISSUER_URI");
            } else if (!issuer.replaceAll("/$", "").equals(document.path("issuer").asString("").replaceAll("/$", ""))) {
                fail("identity provider " + url + ": the document names the issuer " + document.path("issuer").asString("")
                        + ", PORTAL_OIDC_ISSUER_URI says " + issuer + "; they must be equal");
            } else {
                ok("identity provider " + url);
            }
        } catch (JacksonException e) {
            fail("identity provider " + url + ": not a discovery document; check PORTAL_OIDC_ISSUER_URI");
        }
    }

    private void checkExplicitEndpoints(HttpClient http) {
        for (String name : List.of("PORTAL_OIDC_AUTHORIZATION_URI", "PORTAL_OIDC_JWK_SET_URI")) {
            if (blank(env.get(name))) {
                fail(name + " is required together with PORTAL_OIDC_TOKEN_URI");
                return;
            }
        }
        String url = env.get("PORTAL_OIDC_JWK_SET_URI");
        HttpResponse<String> response = get("identity provider keys", url, http, true);
        if (response == null) {
            return;
        }
        if (response.statusCode() == 200 && response.body().contains("\"keys\"")) {
            ok("identity provider keys " + url);
        } else {
            fail("identity provider keys " + url + ": HTTP " + response.statusCode() + " without keys; check PORTAL_OIDC_JWK_SET_URI");
        }
    }

    private boolean tls() {
        Path keystore = Path.of(env.get("PORTAL_TLS_KEYSTORE"));
        Path truststore = Path.of(env.get("PORTAL_TLS_TRUSTSTORE"));
        for (Path file : List.of(keystore, truststore)) {
            if (!Files.isReadable(file)) {
                fail("certificate file " + file + " does not exist or cannot be read");
                return false;
            }
        }
        try {
            char[] keystorePassword = env.get("PORTAL_TLS_KEYSTORE_PASSWORD").toCharArray();
            KeyStore keys = load(keystore, keystorePassword);
            KeyStore trust = load(truststore, env.get("PORTAL_TLS_TRUSTSTORE_PASSWORD").toCharArray());
            if (Collections.list(keys.aliases()).stream().noneMatch(alias -> isKey(keys, alias))) {
                fail("keystore " + keystore + " has no private key: it must hold the certificate of the portal (CN mcp-portal-bff) and its key");
                return false;
            }
            if (trust.size() == 0) {
                fail("truststore " + truststore + " has no certificate: it must hold the internal CA");
                return false;
            }
            ok("portal certificate " + keystore + " and internal CA " + truststore);
            return true;
        } catch (GeneralSecurityException | IOException e) {
            // PKCS12 reports a wrong password as a failed decryption.
            boolean wrongPassword = inChain(e, javax.crypto.BadPaddingException.class)
                    || inChain(e, java.security.UnrecoverableKeyException.class) || chainMentions(e, "password");
            fail("cannot open " + keystore + " or " + truststore + ": "
                    + (wrongPassword ? "wrong PORTAL_TLS_KEYSTORE_PASSWORD or PORTAL_TLS_TRUSTSTORE_PASSWORD" : rootMessage(e)));
            return false;
        }
    }

    private SSLContext contextOf(KeyManagerFactory keyManagers, KeyStore trust, String tlsName) throws GeneralSecurityException {
        TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        factory.init(trust);
        X509TrustManager chain = java.util.Arrays.stream(factory.getTrustManagers()).filter(X509TrustManager.class::isInstance)
                .map(X509TrustManager.class::cast).findFirst().orElseThrow();
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(keyManagers.getKeyManagers(), new TrustManager[] {tlsName == null ? chain : new PinnedNameTrustManager(chain, tlsName)}, null);
        return context;
    }

    /** Any HTTP answer counts: it proves the name, the route and both certificates (the service answers 401 or 403 without a token). */
    private void reachUpstream(String what, String url, String tlsName) {
        try {
            KeyStore keys = load(Path.of(env.get("PORTAL_TLS_KEYSTORE")), env.get("PORTAL_TLS_KEYSTORE_PASSWORD").toCharArray());
            KeyStore trust = load(Path.of(env.get("PORTAL_TLS_TRUSTSTORE")), env.get("PORTAL_TLS_TRUSTSTORE_PASSWORD").toCharArray());
            KeyManagerFactory keyManagers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            keyManagers.init(keys, env.get("PORTAL_TLS_KEYSTORE_PASSWORD").toCharArray());
            HttpClient http = HttpClient.newBuilder().sslContext(contextOf(keyManagers, trust, tlsName)).connectTimeout(CONNECT_TIMEOUT)
                    .followRedirects(HttpClient.Redirect.NEVER).version(HttpClient.Version.HTTP_1_1).build();
            if (!url.startsWith("https://")) {
                out.println("warn  " + what + " " + url + ": must be an https address, the portal does not start with it");
                return;
            }
            if (get(what, url, http, false, tlsName) != null) {
                ok(what + " " + url);
            }
        } catch (GeneralSecurityException | IOException e) {
            out.println("warn  " + what + " " + url + ": " + rootMessage(e));
        }
    }

    private static KeyStore load(Path file, char[] password) throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(file)) {
            store.load(in, password);
        }
        return store;
    }

    private static boolean isKey(KeyStore store, String alias) {
        try {
            return store.isKeyEntry(alias);
        } catch (java.security.KeyStoreException e) {
            return false;
        }
    }

    private HttpResponse<String> get(String what, String url, HttpClient http, boolean required) {
        return get(what, url, http, required, null);
    }

    private HttpResponse<String> get(String what, String url, HttpClient http, boolean required, String tlsName) {
        try {
            return http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(10)).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (IllegalArgumentException e) {
            report(required, what + " " + url + ": not a valid URL");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            report(required, what + " " + url + ": interrupted");
        } catch (IOException e) {
            report(required, what + " " + url + ": " + cause(e, tlsName));
        }
        return null;
    }

    /** The most specific cause anywhere in the chain wins: an unresolved name also arrives wrapped in a ConnectException. */
    static String cause(Throwable e, String tlsName) {
        if (inChain(e, UnknownHostException.class) || inChain(e, java.nio.channels.UnresolvedAddressException.class)) {
            return "the name does not resolve from this host (DNS or /etc/hosts)";
        }
        if (inChain(e, HttpConnectTimeoutException.class)) {
            return "no answer within " + CONNECT_TIMEOUT.toSeconds() + " s; a firewall drops the connection";
        }
        if (chainMentions(e, "has no DNS name")) {
            return "its certificate does not name " + tlsName + " in subjectAltName";
        }
        if (inChain(e, CertPathValidatorException.class) || chainMentions(e, "PKIX path")) {
            return tlsName == null
                    ? "its certificate is not signed by a CA this JVM trusts; add your CA with JAVA_TOOL_OPTIONS (see deploy/README.md)"
                    : "its certificate is not signed by the internal CA in PORTAL_TLS_TRUSTSTORE";
        }
        if (inChain(e, ConnectException.class)) {
            return "connection refused; nothing listens on that port, or the service is not running yet";
        }
        if (inChain(e, HttpTimeoutException.class)) {
            return "connected, but no answer within 10 s";
        }
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof SSLException) {
                return tlsName == null ? "TLS failed: " + t.getMessage()
                        : "TLS failed (" + t.getMessage() + "); the service may not accept the portal certificate";
            }
        }
        return Objects.requireNonNullElse(rootMessage(e), e.getClass().getSimpleName());
    }

    private static boolean inChain(Throwable e, Class<? extends Throwable> type) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (type.isInstance(t)) {
                return true;
            }
        }
        return false;
    }

    private static boolean chainMentions(Throwable e, String text) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (String.valueOf(t.getMessage()).contains(text)) {
                return true;
            }
        }
        return false;
    }

    private void report(boolean required, String message) {
        if (required) {
            fail(message);
        } else {
            out.println("warn  " + message);
        }
    }

    private void ok(String message) {
        out.println("ok    " + message);
    }

    private void fail(String message) {
        failures++;
        out.println("FAIL  " + message);
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null) {
            t = t.getCause();
        }
        return t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
