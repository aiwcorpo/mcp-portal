package pl.aiwcorpo.mcp.portal.bff.support;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.CertificateFactory;
import java.util.Base64;
import java.util.List;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

/**
 * A throwaway CA and a server certificate for localhost, made with the keytool of the running JDK so that the tests
 * need neither a checked-in key nor another library. The server key and certificate are written as PEM, the form the
 * BFF reads; the CA is exported as a trust store for the client side of a test.
 */
public final class TestPki {

    private static final String PASSWORD = "changeit";

    private final Path dir;

    public TestPki(Path dir) {
        this.dir = dir;
        for (String name : new String[] {"ca.p12", "server.p12", "server.csr", "server.crt", "ca.crt"}) {
            try {
                Files.deleteIfExists(dir.resolve(name));
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
        keytool("-genkeypair", "-alias", "ca", "-keystore", "ca.p12", "-dname", "CN=portal-test-ca", "-keyalg", "EC",
                "-groupname", "secp256r1", "-validity", "2", "-ext", "bc:c", "-ext", "ku:c=keyCertSign,cRLSign");
        keytool("-genkeypair", "-alias", "server", "-keystore", "server.p12", "-dname", "CN=localhost", "-keyalg", "EC",
                "-groupname", "secp256r1", "-validity", "2");
        keytool("-certreq", "-alias", "server", "-keystore", "server.p12", "-file", "server.csr");
        keytool("-gencert", "-alias", "ca", "-keystore", "ca.p12", "-infile", "server.csr", "-outfile", "server.crt",
                "-rfc", "-validity", "2", "-ext", "san=dns:localhost,ip:127.0.0.1", "-ext", "eku=serverAuth");
        keytool("-exportcert", "-alias", "ca", "-keystore", "ca.p12", "-file", "ca.crt", "-rfc");
        writeServerPem();
    }

    public Path certificate() {
        return dir.resolve("server-chain.pem");
    }

    public Path privateKey() {
        return dir.resolve("server-key.pem");
    }

    /** A client context that trusts this CA only. */
    public SSLContext clientContext() {
        try {
            KeyStore trust = KeyStore.getInstance("PKCS12");
            trust.load(null, null);
            try (InputStream in = Files.newInputStream(dir.resolve("ca.crt"))) {
                trust.setCertificateEntry("ca", CertificateFactory.getInstance("X.509").generateCertificate(in));
            }
            TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            factory.init(trust);
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, factory.getTrustManagers(), null);
            return context;
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private void writeServerPem() {
        try {
            String signed = Files.readString(dir.resolve("server.crt"));
            String ca = Files.readString(dir.resolve("ca.crt"));
            Files.writeString(dir.resolve("server-chain.pem"), signed + ca);
            KeyStore store = KeyStore.getInstance("PKCS12");
            try (InputStream in = Files.newInputStream(dir.resolve("server.p12"))) {
                store.load(in, PASSWORD.toCharArray());
            }
            PrivateKey key = (PrivateKey) store.getKey("server", PASSWORD.toCharArray());
            String body = Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.US_ASCII)).encodeToString(key.getEncoded());
            Files.writeString(dir.resolve("server-key.pem"), "-----BEGIN PRIVATE KEY-----\n" + body + "\n-----END PRIVATE KEY-----\n");
            Files.setPosixFilePermissions(dir.resolve("server-key.pem"), java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private void keytool(String... args) {
        String executable = Path.of(System.getProperty("java.home"), "bin", "keytool").toString();
        List<String> command = new java.util.ArrayList<>(List.of(executable));
        command.addAll(List.of(args));
        command.addAll(List.of("-storepass", PASSWORD, "-noprompt"));
        if (args[0].equals("-genkeypair")) {
            command.addAll(List.of("-keypass", PASSWORD));
        }
        try {
            Process process = new ProcessBuilder(command).directory(dir.toFile()).redirectErrorStream(true).start();
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            if (process.waitFor() != 0) {
                throw new IllegalStateException("keytool " + args[0] + " failed: " + output);
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }
}
