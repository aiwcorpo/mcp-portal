package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.io.IOException;
import java.io.InputStream;
import java.net.http.HttpClient;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

import javax.net.ssl.KeyManager;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import pl.aiwcorpo.mcp.portal.bff.config.DevMode;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;

/** HTTP clients for C4 and C5: client certificate {@code CN=mcp-portal-bff}, internal CA, pinned server name. */
final class UpstreamHttp {

    private UpstreamHttp() {
    }

    /**
     * C4 carries PATs and both carry user tokens, so plain HTTP and a missing client certificate or trust anchor
     * are start-up errors; the only exception is the explicit test flag together with the dev profile.
     */
    static RestClient restClient(String name, PortalProperties.Upstream upstream, PortalProperties.Tls tls,
                                 DevMode devMode) {
        if (upstream == null || upstream.baseUrl() == null || !upstream.baseUrl().isAbsolute()) {
            throw new IllegalStateException("Base URL of the " + name + " is not configured");
        }
        boolean https = "https".equalsIgnoreCase(upstream.baseUrl().getScheme());
        if (!https) {
            if (!"http".equalsIgnoreCase(upstream.baseUrl().getScheme()) || !tls.insecurePlainHttpForTests()) {
                throw new IllegalStateException("The " + name + " must be reached over https with mTLS");
            }
            devMode.require(true, "portal.tls.insecure-plain-http-for-tests");
        } else if (!isSet(tls.keystore()) || !isSet(tls.truststore())) {
            throw new IllegalStateException("mTLS to the " + name + " needs portal.tls.keystore and portal.tls.truststore");
        }
        HttpClient.Builder http = HttpClient.newBuilder()
                .connectTimeout(upstream.connectTimeout())
                .followRedirects(HttpClient.Redirect.NEVER)
                // Without TLS the JDK client would try an h2c upgrade on requests with a body, which some servers drop.
                .version(HttpClient.Version.HTTP_1_1);
        if (https) {
            http.sslContext(sslContext(tls, upstream.tlsName()));
        }
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(http.build());
        requestFactory.setReadTimeout(upstream.readTimeout());
        return RestClient.builder()
                .baseUrl(upstream.baseUrl().toString())
                .requestFactory(requestFactory)
                .build();
    }

    private static SSLContext sslContext(PortalProperties.Tls tls, String tlsName) {
        try {
            KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            kmf.init(load(tls.keystore(), tls.keystorePassword()), password(tls.keystorePassword()));
            KeyManager[] keyManagers = kmf.getKeyManagers();
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            // Only the internal CA: the JDK default trust store would accept any public certificate.
            tmf.init(load(tls.truststore(), tls.truststorePassword()));
            X509TrustManager chainValidator = x509(tmf.getTrustManagers());
            TrustManager trust = tlsName == null || tlsName.isBlank()
                    ? chainValidator
                    : new PinnedNameTrustManager(chainValidator, tlsName);
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(keyManagers, new TrustManager[] {trust}, null);
            return context;
        } catch (GeneralSecurityException | IOException e) {
            throw new IllegalStateException("Cannot set up TLS for upstream calls: " + e.getClass().getSimpleName(), e);
        }
    }

    private static KeyStore load(Path path, String password) throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(path)) {
            store.load(in, password(password));
        }
        return store;
    }

    // An unset environment variable binds to an empty path rather than null.
    private static boolean isSet(Path path) {
        return path != null && !path.toString().isEmpty();
    }

    private static char[] password(String password) {
        return password == null ? new char[0] : password.toCharArray();
    }

    private static X509TrustManager x509(TrustManager[] managers) {
        for (TrustManager manager : managers) {
            if (manager instanceof X509TrustManager x509) {
                return x509;
            }
        }
        throw new IllegalStateException("No X509TrustManager available");
    }
}
