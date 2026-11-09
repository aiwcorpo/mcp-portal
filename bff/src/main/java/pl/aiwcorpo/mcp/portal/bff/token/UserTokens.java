package pl.aiwcorpo.mcp.portal.bff.token;

import java.io.Serializable;
import java.time.Clock;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.ClientAuthorizationException;
import org.springframework.security.oauth2.client.OAuth2AuthorizeRequest;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.OAuth2RefreshToken;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import pl.aiwcorpo.mcp.portal.bff.config.IdpClientConfig;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;
import pl.aiwcorpo.mcp.portal.bff.security.SessionAttributes;
import pl.aiwcorpo.mcp.portal.bff.web.ApiException;

/**
 * Tokens of the logged-in user for C4 and C5: the session's access token (refreshed when needed) exchanged for
 * {@code aud=mcp-credential-broker} or {@code aud=mcp-gateway-admin}. The subject is always the session's own
 * login, so the BFF cannot act for another {@code sub}.
 */
@Component
public class UserTokens {

    public enum Audience { BROKER, GATEWAY_ADMIN }

    private final OAuth2AuthorizedClientManager authorizedClients;
    private final TokenExchangeClient exchange;
    private final PortalProperties.TokenExchange config;
    private final PortalProperties.StepUp stepUp;
    private final OAuth2AuthorizedClientRepository authorizedClientRepository;
    private final String registrationId;
    private final Clock clock;

    public UserTokens(OAuth2AuthorizedClientManager authorizedClients, OAuth2AuthorizedClientRepository authorizedClientRepository,
                      PortalProperties properties, Clock clock, @Qualifier(IdpClientConfig.IDP_REST_CLIENT) RestClient idp) {
        this.authorizedClients = authorizedClients;
        this.authorizedClientRepository = authorizedClientRepository;
        this.stepUp = properties.stepUp();
        this.exchange = new TokenExchangeClient(idp, clock);
        this.config = properties.tokenExchange();
        this.registrationId = properties.registrationId();
        this.clock = clock;
    }

    /**
     * Token of an ordinary call (C4, C5 reads and the user's own calls): the exchange of the session's access token. Where
     * the session was granted the audience scope by a step-up login of an administrator, it is the narrowed refresh grant
     * instead, and never the exchange: on Keycloak every token exchange resets the {@code acr} that the user session
     * remembers, so one exchange after the step-up (a registry read of the page that opens after it is enough) makes every
     * later refresh answer {@code acr=password} and the gateway refuses the write that needs fresh MFA. For the same reason a
     * refresh that fails there ends the call with {@link TokenUnavailableException} (503) and does not fall back to the
     * exchange: a transient failure of the IdP must not downgrade the session for good.
     */
    public BearerToken tokenFor(Audience audience, Authentication user, HttpServletRequest request,
                                HttpServletResponse response) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            throw ApiException.unauthenticated();
        }
        if (stepUp.adminTokens() == PortalProperties.AdminTokens.REFRESH) {
            BearerToken refreshed = refreshedToken(audience, user, request, response, session);
            if (refreshed != null) {
                return refreshed;
            }
        }
        return exchangedToken(audience, user, request, response, session);
    }

    private BearerToken exchangedToken(Audience audience, Authentication user, HttpServletRequest request,
                                       HttpServletResponse response, HttpSession session) {
        ExchangedTokens cache = exchangedTokens(session);
        BearerToken cached = cache.tokens.get(audience);
        Duration skew = config.expirySkew();
        if (cached != null && cached.usableAt(clock.instant(), skew)) {
            return cached;
        }
        OAuth2AuthorizedClient client = sessionClient(user, request, response);
        BearerToken exchanged = switch (audience) {
            case BROKER -> exchange.exchange(client.getClientRegistration(), client.getAccessToken().getTokenValue(),
                    config.brokerAudience(), config.brokerScope());
            case GATEWAY_ADMIN -> exchange.exchange(client.getClientRegistration(), client.getAccessToken().getTokenValue(),
                    config.gatewayAdminAudience(), config.gatewayAdminScope());
        };
        cache.tokens.put(audience, exchanged);
        return exchanged;
    }

    /**
     * The narrowed refresh grant for the audience, or null where the session was not granted its scope (or has no refresh
     * token) and the exchange is the way. A refresh grant narrowed to the scope of the audience gives a token that keeps
     * {@code acr} and {@code auth_time} of the step-up login, which a write that needs fresh MFA requires. The tokens stay
     * in the memory of the session, one per audience, for {@code portal.step-up.admin-token-ttl} at most; the token of the
     * login itself, which carries both audiences, is never sent anywhere.
     * <p>
     * The refreshes of one session run one at a time: a page that opens asks for both audiences at once, and an IdP that
     * revokes a refresh token when it is used would refuse the second request, which holds the old one.
     */
    private BearerToken refreshedToken(Audience audience, Authentication user, HttpServletRequest request,
                                       HttpServletResponse response, HttpSession session) {
        ExchangedTokens cache = exchangedTokens(session);
        Duration skew = config.expirySkew();
        BearerToken cached = cache.adminTokens.get(audience);
        if (cached != null && cached.usableAt(clock.instant(), skew)) {
            return cached;
        }
        cache.refreshLock.lock();
        try {
            cached = cache.adminTokens.get(audience);
            if (cached != null && cached.usableAt(clock.instant(), skew)) {
                return cached;
            }
            OAuth2AuthorizedClient client = sessionClient(user, request, response);
            String scope = audience == Audience.BROKER ? config.brokerScope() : config.gatewayAdminScope();
            if (client.getRefreshToken() == null || !client.getAccessToken().getScopes().contains(scope)) {
                return null;
            }
            TokenExchangeClient.Refreshed refreshed = exchange.refresh(client.getClientRegistration(),
                    client.getRefreshToken().getTokenValue(), scope, stepUp.adminTokenTtl());
            if (refreshed.refreshToken() != null) {
                saveRefreshToken(client, refreshed.refreshToken(), user, request, response);
            }
            cache.adminTokens.put(audience, refreshed.token());
            return refreshed.token();
        } finally {
            cache.refreshLock.unlock();
        }
    }

    /** The IdP rotates refresh tokens: the session must hold the new one or its next refresh is refused. */
    private void saveRefreshToken(OAuth2AuthorizedClient used, String refreshToken, Authentication user,
                                  HttpServletRequest request, HttpServletResponse response) {
        if (refreshToken.equals(used.getRefreshToken().getTokenValue())) {
            return;
        }
        // Whatever the session holds now, not the snapshot taken before the call: the access token may have been renewed since.
        OAuth2AuthorizedClient current = authorizedClientRepository.loadAuthorizedClient(registrationId, user, request);
        if (current == null) {
            current = used;
        }
        authorizedClientRepository.saveAuthorizedClient(new OAuth2AuthorizedClient(current.getClientRegistration(),
                current.getPrincipalName(), current.getAccessToken(), new OAuth2RefreshToken(refreshToken, clock.instant())),
                user, request, response);
    }

    private OAuth2AuthorizedClient sessionClient(Authentication user, HttpServletRequest request,
                                                 HttpServletResponse response) {
        OAuth2AuthorizedClient client;
        try {
            client = authorizedClients.authorize(OAuth2AuthorizeRequest.withClientRegistrationId(registrationId)
                    .principal(user)
                    .attribute(HttpServletRequest.class.getName(), request)
                    .attribute(HttpServletResponse.class.getName(), response)
                    .build());
        } catch (ClientAuthorizationException e) {
            // Refresh rejected: the IdP session is gone (logout elsewhere, idle timeout), so is ours.
            request.getSession().invalidate();
            throw ApiException.unauthenticated();
        }
        if (client == null || client.getAccessToken() == null) {
            throw ApiException.unauthenticated();
        }
        return client;
    }

    private static ExchangedTokens exchangedTokens(HttpSession session) {
        if (session.getAttribute(SessionAttributes.EXCHANGED_TOKENS) instanceof ExchangedTokens existing) {
            return existing;
        }
        // One cache per session, so that its lock really is one lock.
        synchronized (ExchangedTokens.class) {
            if (session.getAttribute(SessionAttributes.EXCHANGED_TOKENS) instanceof ExchangedTokens existing) {
                return existing;
            }
            ExchangedTokens created = new ExchangedTokens();
            session.setAttribute(SessionAttributes.EXCHANGED_TOKENS, created);
            return created;
        }
    }

    static final class ExchangedTokens implements Serializable {
        private final ConcurrentHashMap<Audience, BearerToken> tokens = new ConcurrentHashMap<>();
        private final ConcurrentHashMap<Audience, BearerToken> adminTokens = new ConcurrentHashMap<>();
        private final ReentrantLock refreshLock = new ReentrantLock();

        @Override
        public String toString() {
            return "ExchangedTokens" + tokens.keySet() + adminTokens.keySet();
        }
    }
}
