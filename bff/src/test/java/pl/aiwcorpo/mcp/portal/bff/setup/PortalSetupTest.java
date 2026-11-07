package pl.aiwcorpo.mcp.portal.bff.setup;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.net.ConnectException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.util.HashMap;
import java.util.Map;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLHandshakeException;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;

/** The check names what is missing or unreachable; only the identity provider and the local files stop the start. */
class PortalSetupTest {

    private static final String PASSWORD = "changeit";
    private static final String CATALOG = "entitlements:\n  jira: [mcp-jira-read]\ndescriptions:\n  mcp-jira-read: Read access\n";
    private static final String DISCOVERY_PATH = "/realms/mcp/.well-known/openid-configuration";

    @TempDir
    Path dir;

    private final ByteArrayOutputStream output = new ByteArrayOutputStream();
    private HttpServer server;
    private HttpsServer https;

    @AfterEach
    void stopServers() {
        if (server != null) {
            server.stop(0);
        }
        if (https != null) {
            https.stop(0);
        }
    }

    private int check(Map<String, String> env) {
        return new PortalSetup(env, new PrintStream(output, true, StandardCharsets.UTF_8)).check();
    }

    private String printed() {
        return output.toString(StandardCharsets.UTF_8);
    }

    @Test
    void namesEveryMissingSettingAndFails() {
        int exit = check(Map.of("PORTAL_PUBLIC_BASE_URL", "https://mcp.aiwcorpo.pl"));

        assertThat(exit).isEqualTo(1);
        assertThat(printed())
                .contains("FAIL  not set: PORTAL_OIDC_ISSUER_URI, PORTAL_OIDC_CLIENT_SECRET, PORTAL_BROKER_URL")
                .contains("PORTAL_IGA_CATALOG_FILE, PORTAL_STEP_UP_ACR_VALUES (or PORTAL_STEP_UP_AMR_VALUES)")
                .doesNotContain("PORTAL_PUBLIC_BASE_URL,");
    }

    @Test
    void thePublicAddressIsAnHttpsOriginWithoutPath() {
        for (String bad : new String[] {"http://mcp.aiwcorpo.pl", "https://mcp.aiwcorpo.pl/portal", "mcp.aiwcorpo.pl"}) {
            output.reset();
            Map<String, String> env = valid("http://127.0.0.1:1");
            env.put("PORTAL_PUBLIC_BASE_URL", bad);
            check(env);
            assertThat(printed()).contains("FAIL  PORTAL_PUBLIC_BASE_URL " + bad + " must be the https origin");
        }
    }

    @Test
    void anEmptyOrMisspelledCatalogFailsAndAMissingOneToo() throws Exception {
        Path catalog = dir.resolve("catalog.yaml");
        Map<String, String> env = valid("http://127.0.0.1:1");
        env.put("PORTAL_IGA_CATALOG_FILE", catalog.toString());

        check(env);
        assertThat(printed()).contains("FAIL  IGA catalog file " + catalog + " does not exist");

        Files.writeString(catalog, "entitlements: {}\n");
        output.reset();
        check(env);
        assertThat(printed()).contains("lists no entitlements: the portal does not start with an empty catalog");

        Files.writeString(catalog, "entitlement:\n  jira: [a]\n");
        output.reset();
        check(env);
        assertThat(printed()).contains("unknown key entitlement");

        Files.writeString(catalog, CATALOG);
        output.reset();
        check(env);
        assertThat(printed()).contains("ok    IGA catalog " + catalog + ": 1 system(s)");
    }

    @Test
    void onlyKeycloakGroupsIsAnAdapterOutsideTheDevProfile() {
        Map<String, String> env = valid("http://127.0.0.1:1");
        env.put("PORTAL_IGA_ADAPTER", "mock");

        check(env);

        assertThat(printed()).contains("FAIL  PORTAL_IGA_ADAPTER mock: only keycloak-groups works");
    }

    @Test
    void aReverseProxyOnAnotherHostIsAWarningUntilItIsListed() {
        Map<String, String> env = valid("http://127.0.0.1:1");

        check(env);
        assertThat(printed()).contains("warn  PORTAL_TRUSTED_PROXIES is not set");

        output.reset();
        env.put("PORTAL_TRUSTED_PROXIES", "10[.]0[.]0[.]5");
        check(env);
        assertThat(printed()).contains("ok    trusted proxies: 10[.]0[.]0[.]5").doesNotContain("PORTAL_TRUSTED_PROXIES is not set");
    }

    @Test
    void discoveryThatMatchesTheIssuerPasses() throws Exception {
        String base = startServer();
        server.createContext(DISCOVERY_PATH, ok(discovery(base + "/realms/mcp")));
        Map<String, String> env = valid(base);
        Stores stores = stores();
        env.put("PORTAL_TLS_KEYSTORE", stores.keystore.toString());
        env.put("PORTAL_TLS_TRUSTSTORE", stores.truststore.toString());
        env.put("PORTAL_BROKER_URL", "https://localhost:1");
        env.put("PORTAL_GATEWAY_ADMIN_URL", "https://localhost:1");

        int exit = check(env);

        assertThat(printed()).contains("ok    identity provider " + base + DISCOVERY_PATH);
        assertThat(exit).isZero();
    }

    @Test
    void discoveryThatNamesAnotherIssuerFails() throws Exception {
        String base = startServer();
        server.createContext(DISCOVERY_PATH, ok(discovery("https://other.aiwcorpo.pl/realms/mcp")));

        int exit = check(valid(base));

        assertThat(exit).isEqualTo(1);
        assertThat(printed()).contains("the document names the issuer https://other.aiwcorpo.pl/realms/mcp").contains("they must be equal");
    }

    @Test
    void anUnreachableOrWrongIdentityProviderFails() throws Exception {
        check(valid("http://127.0.0.1:1"));
        assertThat(printed()).contains("FAIL  identity provider http://127.0.0.1:1" + DISCOVERY_PATH + ": connection refused");

        String base = startServer();
        server.createContext(DISCOVERY_PATH, ok("{}"));
        output.reset();
        check(valid(base));
        assertThat(printed()).contains("without a discovery document; check PORTAL_OIDC_ISSUER_URI");
    }

    @Test
    void explicitEndpointsAreCheckedByTheirKeys() throws Exception {
        String base = startServer();
        server.createContext("/keys", ok("{\"keys\":[{}]}"));
        Map<String, String> env = valid(base);
        env.put("PORTAL_OIDC_TOKEN_URI", base + "/token");

        check(env);
        assertThat(printed()).contains("FAIL  PORTAL_OIDC_AUTHORIZATION_URI is required together with PORTAL_OIDC_TOKEN_URI");

        output.reset();
        env.put("PORTAL_OIDC_AUTHORIZATION_URI", "https://idp.aiwcorpo.pl/auth");
        env.put("PORTAL_OIDC_JWK_SET_URI", base + "/keys");
        check(env);
        assertThat(printed()).contains("ok    identity provider keys " + base + "/keys");
    }

    @Test
    void reportsMissingCertificateFilesAndAWrongPassword() throws Exception {
        Map<String, String> env = valid("http://127.0.0.1:1");
        check(env);
        assertThat(printed()).contains("FAIL  certificate file " + dir.resolve("keystore.p12") + " does not exist");

        Stores stores = stores();
        env.put("PORTAL_TLS_KEYSTORE", stores.keystore.toString());
        env.put("PORTAL_TLS_TRUSTSTORE", stores.truststore.toString());
        env.put("PORTAL_TLS_KEYSTORE_PASSWORD", "wrong");
        output.reset();
        check(env);
        assertThat(printed()).contains("wrong PORTAL_TLS_KEYSTORE_PASSWORD or PORTAL_TLS_TRUSTSTORE_PASSWORD");
    }

    @Test
    void aKeystoreWithoutAKeyIsNamed() throws Exception {
        Stores stores = stores();
        Map<String, String> env = valid("http://127.0.0.1:1");
        env.put("PORTAL_TLS_KEYSTORE", stores.truststore.toString());
        env.put("PORTAL_TLS_TRUSTSTORE", stores.truststore.toString());

        check(env);

        assertThat(printed()).contains("FAIL  keystore " + stores.truststore + " has no private key");
    }

    @Test
    void theBrokerAndTheGatewayOnlyWarnWhenTheyDoNotAnswer() throws Exception {
        String idp = startServer();
        server.createContext(DISCOVERY_PATH, ok(discovery(idp + "/realms/mcp")));
        Stores stores = stores();
        Map<String, String> env = valid(idp);
        env.put("PORTAL_TLS_KEYSTORE", stores.keystore.toString());
        env.put("PORTAL_TLS_TRUSTSTORE", stores.truststore.toString());
        https = HttpsServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        https.setHttpsConfigurator(new HttpsConfigurator(serverContext(stores.keystore)));
        https.createContext("/", answer(401, "{}"));
        https.start();
        String broker = "https://localhost:" + https.getAddress().getPort();
        env.put("PORTAL_BROKER_URL", broker);
        env.put("PORTAL_BROKER_TLS_NAME", "localhost");
        env.put("PORTAL_GATEWAY_ADMIN_URL", "https://localhost:1");
        env.put("PORTAL_GATEWAY_ADMIN_TLS_NAME", "localhost");

        int exit = check(env);

        assertThat(printed())
                .contains("ok    credential broker " + broker)
                .contains("warn  gateway admin API https://localhost:1: connection refused")
                .contains("Ready to start.");
        assertThat(exit).isZero();

        output.reset();
        env.put("PORTAL_BROKER_TLS_NAME", "mcp-credential-broker.internal");
        exit = check(env);
        assertThat(printed()).contains("warn  credential broker " + broker + ": its certificate does not name mcp-credential-broker.internal");
        assertThat(exit).isZero();
    }

    @Test
    void translatesConnectionErrorsIntoLikelyCauses() {
        assertThat(PortalSetup.cause(new IOException(new UnknownHostException("idp.corp")), null)).contains("does not resolve");
        assertThat(PortalSetup.cause(new ConnectException(), null)).contains("connection refused");
        SSLHandshakeException pkix = new SSLHandshakeException("PKIX path building failed");
        assertThat(PortalSetup.cause(pkix, null)).contains("JAVA_TOOL_OPTIONS");
        assertThat(PortalSetup.cause(pkix, "mcp-credential-broker.internal")).contains("PORTAL_TLS_TRUSTSTORE");
    }

    private Map<String, String> valid(String base) {
        Map<String, String> env = new HashMap<>();
        PortalSetup.REQUIRED.forEach(name -> env.put(name, "unused"));
        env.put("PORTAL_PUBLIC_BASE_URL", "https://mcp.aiwcorpo.pl");
        env.put("PORTAL_OIDC_ISSUER_URI", base + "/realms/mcp");
        env.put("PORTAL_STEP_UP_ACR_VALUES", "mfa");
        env.put("PORTAL_IGA_ADAPTER", "keycloak-groups");
        env.put("PORTAL_TLS_KEYSTORE", dir.resolve("keystore.p12").toString());
        env.put("PORTAL_TLS_TRUSTSTORE", dir.resolve("truststore.p12").toString());
        env.put("PORTAL_TLS_KEYSTORE_PASSWORD", PASSWORD);
        env.put("PORTAL_TLS_TRUSTSTORE_PASSWORD", PASSWORD);
        try {
            Path catalog = dir.resolve("iga-catalog.yaml");
            Files.writeString(catalog, CATALOG);
            env.put("PORTAL_IGA_CATALOG_FILE", catalog.toString());
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        return env;
    }

    private static String discovery(String issuer) {
        return "{\"issuer\":\"" + issuer + "\",\"authorization_endpoint\":\"" + issuer + "/auth\",\"token_endpoint\":\"" + issuer
                + "/token\",\"jwks_uri\":\"" + issuer + "/keys\"}";
    }

    private String startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static HttpHandler ok(String body) {
        return answer(200, body);
    }

    private static HttpHandler answer(int status, String body) {
        return (HttpExchange exchange) -> {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getRequestBody().readAllBytes();
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        };
    }

    private record Stores(Path keystore, Path truststore) {
    }

    /** One self-signed certificate for localhost: the keystore of the portal and of the stand-in server, and the only trust anchor. */
    private Stores stores() throws Exception {
        Path keystore = dir.resolve("keystore.p12");
        Path certificate = dir.resolve("localhost.crt");
        Path truststore = dir.resolve("truststore.p12");
        keytool("-genkeypair", "-alias", "portal", "-keystore", keystore.toString(), "-dname", "CN=localhost", "-keyalg", "EC",
                "-groupname", "secp256r1", "-validity", "2", "-ext", "san=dns:localhost,ip:127.0.0.1");
        keytool("-exportcert", "-alias", "portal", "-keystore", keystore.toString(), "-file", certificate.toString(), "-rfc");
        keytool("-importcert", "-noprompt", "-alias", "ca", "-file", certificate.toString(), "-keystore", truststore.toString());
        return new Stores(keystore, truststore);
    }

    private static SSLContext serverContext(Path keystore) throws Exception {
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(keystore)) {
            store.load(in, PASSWORD.toCharArray());
        }
        KeyManagerFactory factory = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        factory.init(store, PASSWORD.toCharArray());
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(factory.getKeyManagers(), null, null);
        return context;
    }

    private static void keytool(String... args) throws Exception {
        String[] command = new String[args.length + 5];
        command[0] = Path.of(System.getProperty("java.home"), "bin", "keytool").toString();
        System.arraycopy(args, 0, command, 1, args.length);
        command[args.length + 1] = "-storetype";
        command[args.length + 2] = "PKCS12";
        command[args.length + 3] = "-storepass";
        command[args.length + 4] = PASSWORD;
        Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
        String log = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        if (process.waitFor() != 0) {
            throw new IllegalStateException("keytool failed: " + log);
        }
    }
}
