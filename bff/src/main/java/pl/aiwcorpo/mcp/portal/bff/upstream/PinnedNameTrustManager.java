package pl.aiwcorpo.mcp.portal.bff.upstream;

import java.net.Socket;
import java.security.cert.CertificateException;
import java.security.cert.CertificateParsingException;
import java.security.cert.X509Certificate;
import java.util.Collection;
import java.util.List;
import java.util.Locale;

import javax.net.ssl.SSLEngine;
import javax.net.ssl.X509ExtendedTrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * Validates the server chain against the internal CA and then requires a DNS SAN equal to a configured name
 * instead of the host in the URL (CC-035). Without this, a client connecting through another address would have
 * to switch name checks off, and any certificate of the internal CA (for example an MCP server's) could pose as
 * the broker and receive PATs.
 */
public final class PinnedNameTrustManager extends X509ExtendedTrustManager {

    private static final int SAN_DNS = 2;

    private final X509TrustManager chainValidator;
    private final String expectedName;

    public PinnedNameTrustManager(X509TrustManager chainValidator, String expectedName) {
        this.chainValidator = chainValidator;
        this.expectedName = expectedName.toLowerCase(Locale.ROOT);
    }

    @Override
    public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
        chainValidator.checkServerTrusted(chain, authType);
        requireName(chain[0]);
    }

    @Override
    public void checkServerTrusted(X509Certificate[] chain, String authType, Socket socket) throws CertificateException {
        checkServerTrusted(chain, authType);
    }

    @Override
    public void checkServerTrusted(X509Certificate[] chain, String authType, SSLEngine engine) throws CertificateException {
        checkServerTrusted(chain, authType);
    }

    @Override
    public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
        throw new CertificateException("client certificates are not accepted here");
    }

    @Override
    public void checkClientTrusted(X509Certificate[] chain, String authType, Socket socket) throws CertificateException {
        checkClientTrusted(chain, authType);
    }

    @Override
    public void checkClientTrusted(X509Certificate[] chain, String authType, SSLEngine engine) throws CertificateException {
        checkClientTrusted(chain, authType);
    }

    @Override
    public X509Certificate[] getAcceptedIssuers() {
        return chainValidator.getAcceptedIssuers();
    }

    private void requireName(X509Certificate certificate) throws CertificateException {
        Collection<List<?>> names;
        try {
            names = certificate.getSubjectAlternativeNames();
        } catch (CertificateParsingException e) {
            throw new CertificateException("unreadable subject alternative names", e);
        }
        if (names != null) {
            for (List<?> name : names) {
                if (name.size() >= 2 && Integer.valueOf(SAN_DNS).equals(name.get(0))
                        && expectedName.equals(String.valueOf(name.get(1)).toLowerCase(Locale.ROOT))) {
                    return;
                }
            }
        }
        throw new CertificateException("server certificate has no DNS name " + expectedName);
    }
}
