package pl.aiwcorpo.mcp.portal.bff.token;

import java.io.Serializable;
import java.time.Clock;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;

import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.ClientAuthorizationException;
import org.springframework.security.oauth2.client.OAuth2AuthorizeRequest;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

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
    private final String registrationId;
    private final Clock clock;

    public UserTokens(OAuth2AuthorizedClientManager authorizedClients, PortalProperties properties, Clock clock) {
        this.authorizedClients = authorizedClients;
        this.exchange = new TokenExchangeClient(RestClient.create(), clock);
        this.config = properties.tokenExchange();
        this.registrationId = properties.registrationId();
        this.clock = clock;
    }

    public BearerToken tokenFor(Audience audience, Authentication user, HttpServletRequest request,
                                HttpServletResponse response) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            throw ApiException.unauthenticated();
        }
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
        // Two parallel first requests may both exchange; the later token simply wins.
        if (session.getAttribute(SessionAttributes.EXCHANGED_TOKENS) instanceof ExchangedTokens existing) {
            return existing;
        }
        ExchangedTokens created = new ExchangedTokens();
        session.setAttribute(SessionAttributes.EXCHANGED_TOKENS, created);
        return created;
    }

    static final class ExchangedTokens implements Serializable {
        private final ConcurrentHashMap<Audience, BearerToken> tokens = new ConcurrentHashMap<>();

        @Override
        public String toString() {
            return "ExchangedTokens" + tokens.keySet();
        }
    }
}
