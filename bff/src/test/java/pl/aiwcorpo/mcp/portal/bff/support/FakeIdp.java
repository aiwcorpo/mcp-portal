package pl.aiwcorpo.mcp.portal.bff.support;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import tools.jackson.databind.json.JsonMapper;

/**
 * Minimal OIDC provider for tests: discovery, JWKS, authorization code with PKCE, refresh, RFC 8693 exchange,
 * userinfo and back-channel logout. The browser step at the authorization endpoint is {@link #approve}.
 */
public final class FakeIdp implements AutoCloseable {

    public static final String CLIENT_ID = "mcp-portal-bff";
    public static final String CLIENT_SECRET = "test-only-client-secret";

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final SecureRandom RANDOM = new SecureRandom();

    private final HttpServer server;
    private final String issuer;
    private final RSAKey key;
    private final Map<String, Grant> codes = new ConcurrentHashMap<>();
    private final Map<String, Grant> accessTokens = new ConcurrentHashMap<>();
    private final Map<String, Grant> refreshTokens = new ConcurrentHashMap<>();
    private final Set<String> issued = ConcurrentHashMap.newKeySet();
    private final List<Map<String, String>> tokenRequests = new CopyOnWriteArrayList<>();
    private final List<Map<String, String>> logoutRequests = new CopyOnWriteArrayList<>();
    private final java.util.concurrent.atomic.AtomicInteger discoveryRequests = new java.util.concurrent.atomic.AtomicInteger();

    public record User(String sub, String username, String name, List<String> groups) {
    }

    private record Grant(User user, String nonce, String codeChallenge, Instant authTime, String acr, String audience) {
    }

    public FakeIdp() {
        try {
            key = new RSAKeyGenerator(2048).keyID("test-key").generate();
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        } catch (IOException | JOSEException e) {
            throw new IllegalStateException(e);
        }
        issuer = "http://127.0.0.1:" + server.getAddress().getPort() + "/realms/test";
        server.createContext("/realms/test/.well-known/openid-configuration", this::discovery);
        server.createContext("/realms/test/jwks", exchange -> json(exchange, 200,
                new JWKSet(key.toPublicJWK()).toJSONObject()));
        server.createContext("/realms/test/token", this::token);
        server.createContext("/realms/test/userinfo", this::userinfo);
        server.createContext("/realms/test/logout", this::logout);
        server.start();
    }

    public String issuer() {
        return issuer;
    }

    public String authorizationEndpoint() {
        return issuer + "/auth";
    }

    /** Every access, refresh, ID and exchanged token handed out so far. */
    public Set<String> issuedTokens() {
        return Collections.unmodifiableSet(issued);
    }

    public List<Map<String, String>> tokenRequests() {
        return tokenRequests;
    }

    public List<Map<String, String>> logoutRequests() {
        return logoutRequests;
    }

    /**
     * Plays the user at the authorization endpoint: checks the request and returns the redirect back to the
     * client with a code bound to the nonce and PKCE challenge.
     */
    public URI approve(URI authorizationRequest, User user, Instant authTime, String acr) {
        Map<String, String> query = parse(authorizationRequest.getRawQuery());
        if (!authorizationRequest.toString().startsWith(authorizationEndpoint())) {
            throw new IllegalArgumentException("not an authorization request of this IdP: " + authorizationRequest);
        }
        String code = random("code");
        codes.put(code, new Grant(user, query.get("nonce"), query.get("code_challenge"), authTime, acr, null));
        return URI.create(query.get("redirect_uri") + "?code=" + code + "&state="
                + URLEncoder.encode(query.get("state"), StandardCharsets.UTF_8));
    }

    /** The user cancels at the IdP: redirect back with {@code error=access_denied} and the original state. */
    public URI deny(URI authorizationRequest) {
        Map<String, String> query = parse(authorizationRequest.getRawQuery());
        return URI.create(query.get("redirect_uri") + "?error=access_denied&state="
                + URLEncoder.encode(query.get("state"), StandardCharsets.UTF_8));
    }

    public int discoveryRequests() {
        return discoveryRequests.get();
    }

    private void discovery(HttpExchange exchange) throws IOException {
        discoveryRequests.incrementAndGet();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("issuer", issuer);
        body.put("authorization_endpoint", authorizationEndpoint());
        body.put("token_endpoint", issuer + "/token");
        body.put("jwks_uri", issuer + "/jwks");
        body.put("userinfo_endpoint", issuer + "/userinfo");
        body.put("end_session_endpoint", issuer + "/logout");
        body.put("response_types_supported", List.of("code"));
        body.put("subject_types_supported", List.of("public"));
        body.put("id_token_signing_alg_values_supported", List.of("RS256"));
        body.put("grant_types_supported", List.of("authorization_code", "refresh_token",
                "urn:ietf:params:oauth:grant-type:token-exchange"));
        body.put("code_challenge_methods_supported", List.of("S256"));
        json(exchange, 200, body);
    }

    private void token(HttpExchange exchange) throws IOException {
        Map<String, String> form = parse(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        Map<String, String> recorded = new HashMap<>(form);
        recorded.put("_authorization", exchange.getRequestHeaders().getFirst("Authorization"));
        tokenRequests.add(recorded);
        if (!clientAuthenticated(exchange, form)) {
            json(exchange, 401, Map.of("error", "invalid_client"));
            return;
        }
        switch (form.getOrDefault("grant_type", "")) {
            case "authorization_code" -> {
                Grant grant = codes.remove(form.getOrDefault("code", ""));
                if (grant == null || grant.codeChallenge() == null || !grant.codeChallenge().equals(s256(form.get("code_verifier")))) {
                    json(exchange, 400, Map.of("error", "invalid_grant"));
                    return;
                }
                json(exchange, 200, tokens(grant, true));
            }
            case "refresh_token" -> {
                Grant grant = refreshTokens.get(form.getOrDefault("refresh_token", ""));
                if (grant == null) {
                    json(exchange, 400, Map.of("error", "invalid_grant"));
                    return;
                }
                json(exchange, 200, tokens(grant, false));
            }
            case "urn:ietf:params:oauth:grant-type:token-exchange" -> {
                Grant subject = accessTokens.get(form.getOrDefault("subject_token", ""));
                String audience = form.get("audience");
                if (subject == null || audience == null || subject.audience() != null) {
                    json(exchange, 400, Map.of("error", "invalid_request"));
                    return;
                }
                String token = random("xt-" + audience);
                accessTokens.put(token, new Grant(subject.user(), null, null, subject.authTime(), subject.acr(), audience));
                issued.add(token);
                json(exchange, 200, Map.of("access_token", token, "token_type", "Bearer", "expires_in", 300,
                        "issued_token_type", "urn:ietf:params:oauth:token-type:access_token"));
            }
            default -> json(exchange, 400, Map.of("error", "unsupported_grant_type"));
        }
    }

    private Map<String, Object> tokens(Grant grant, boolean withIdToken) {
        String accessToken = random("at");
        String refreshToken = random("rt");
        accessTokens.put(accessToken, grant);
        refreshTokens.put(refreshToken, grant);
        issued.add(accessToken);
        issued.add(refreshToken);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("access_token", accessToken);
        body.put("token_type", "Bearer");
        body.put("expires_in", 300);
        body.put("refresh_token", refreshToken);
        body.put("scope", "openid profile email");
        if (withIdToken) {
            String idToken = idToken(grant);
            issued.add(idToken);
            body.put("id_token", idToken);
        }
        return body;
    }

    private String idToken(Grant grant) {
        Instant now = Instant.now();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(issuer)
                .subject(grant.user().sub())
                .audience(CLIENT_ID)
                .claim("azp", CLIENT_ID)
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plusSeconds(300)))
                .claim("nonce", grant.nonce())
                .claim("auth_time", grant.authTime().getEpochSecond())
                .claim("acr", grant.acr())
                .claim("preferred_username", grant.user().username())
                .claim("name", grant.user().name())
                .build();
        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID()).build(), claims);
            jwt.sign(new RSASSASigner(key));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }

    private void userinfo(HttpExchange exchange) throws IOException {
        String header = exchange.getRequestHeaders().getFirst("Authorization");
        Grant grant = header != null && header.startsWith("Bearer ") ? accessTokens.get(header.substring(7)) : null;
        if (grant == null || grant.audience() != null) {
            json(exchange, 401, Map.of("error", "invalid_token"));
            return;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("sub", grant.user().sub());
        body.put("preferred_username", grant.user().username());
        body.put("name", grant.user().name());
        body.put("groups", grant.user().groups());
        json(exchange, 200, body);
    }

    private void logout(HttpExchange exchange) throws IOException {
        Map<String, String> form = parse(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        logoutRequests.add(form);
        refreshTokens.remove(form.getOrDefault("refresh_token", ""));
        exchange.sendResponseHeaders(204, -1);
        exchange.close();
    }

    private static boolean clientAuthenticated(HttpExchange exchange, Map<String, String> form) {
        String header = exchange.getRequestHeaders().getFirst("Authorization");
        if (header != null && header.startsWith("Basic ")) {
            String decoded = new String(Base64.getDecoder().decode(header.substring(6)), StandardCharsets.UTF_8);
            return decoded.equals(CLIENT_ID + ":" + CLIENT_SECRET);
        }
        return CLIENT_ID.equals(form.get("client_id")) && CLIENT_SECRET.equals(form.get("client_secret"));
    }

    private static void json(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] bytes = JSON.writeValueAsBytes(body);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    public static Map<String, String> parse(String query) {
        Map<String, String> values = new LinkedHashMap<>();
        if (query == null || query.isEmpty()) {
            return values;
        }
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            String name = URLDecoder.decode(eq < 0 ? pair : pair.substring(0, eq), StandardCharsets.UTF_8);
            String value = eq < 0 ? "" : URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
            values.put(name, value);
        }
        return values;
    }

    private static String s256(String verifier) {
        if (verifier == null) {
            return null;
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String random(String prefix) {
        byte[] bytes = new byte[18];
        RANDOM.nextBytes(bytes);
        return prefix + "-" + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
