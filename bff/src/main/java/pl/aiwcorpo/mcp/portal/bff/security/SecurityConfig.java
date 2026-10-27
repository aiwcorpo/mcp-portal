package pl.aiwcorpo.mcp.portal.bff.security;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientProviderBuilder;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.AuthorizationRequestRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.HttpSessionOAuth2AuthorizationRequestRepository;
import org.springframework.security.oauth2.client.web.HttpSessionOAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestRedirectFilter;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.util.matcher.AnyRequestMatcher;

import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;

@Configuration(proxyBeanMethods = false)
@EnableWebSecurity
public class SecurityConfig {

    static final String CSRF_COOKIE = "XSRF-TOKEN";
    static final String CSRF_HEADER = "X-XSRF-TOKEN";
    static final long HSTS_MAX_AGE_SECONDS = 31_536_000;

    @Bean
    SecurityFilterChain portalSecurity(HttpSecurity http,
                                       LoginResolvers loginResolvers,
                                       OAuth2AuthorizedClientRepository authorizedClients,
                                       AuthorizationRequestRepository<OAuth2AuthorizationRequest> authorizationRequests,
                                       CookieCsrfTokenRepository csrfTokens,
                                       PortalProperties properties,
                                       Clock clock) throws Exception {
        http
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers(HttpMethod.GET, "/api/v1/auth/login").permitAll()
                        .requestMatchers("/api/**").authenticated()
                        .anyRequest().permitAll())
                .oauth2Login(login -> login
                        // Also switches off Spring's generated HTML login page at /login, which is an SPA route.
                        .loginPage("/api/v1/auth/login")
                        .authorizationEndpoint(endpoint -> endpoint
                                .authorizationRequestResolver(loginResolvers.standard())
                                .authorizationRequestRepository(authorizationRequests))
                        .authorizedClientRepository(authorizedClients)
                        .successHandler(new LoginSuccessHandler(properties.web().loginReturnOrigin()))
                        .failureHandler((request, response, e) -> response.sendRedirect(
                                request.getContextPath() + "/?loginError=true")))
                .csrf(csrf -> csrf.spa().csrfTokenRepository(csrfTokens))
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint(JsonSecurityHandlers.unauthenticated())
                        .accessDeniedHandler(JsonSecurityHandlers.accessDenied()))
                .requestCache(cache -> cache.disable())
                .logout(logout -> logout.disable())
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .headers(headers -> headers
                        .httpStrictTransportSecurity(hsts -> hsts
                                // TLS is usually terminated in front of the BFF, so the request itself may look plain.
                                .requestMatcher(AnyRequestMatcher.INSTANCE)
                                .includeSubDomains(true)
                                .maxAgeInSeconds(HSTS_MAX_AGE_SECONDS))
                        .frameOptions(frame -> frame.deny())
                        .referrerPolicy(referrer -> referrer.policy(
                                org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter.ReferrerPolicy.SAME_ORIGIN)))
                .addFilterBefore(new SessionLifetimeFilter(properties.session().absoluteTimeout(), clock),
                        SecurityContextHolderFilter.class)
                .addFilterAfter(new CsrfCookieFilter(), CsrfFilter.class);
        return http.build();
    }

    @Bean
    CookieCsrfTokenRepository csrfTokenRepository() {
        CookieCsrfTokenRepository repository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        repository.setCookieName(CSRF_COOKIE);
        repository.setHeaderName(CSRF_HEADER);
        repository.setCookiePath("/");
        repository.setCookieCustomizer(cookie -> cookie.secure(true).sameSite("Strict"));
        return repository;
    }

    /** Tokens of the login stay in the server-side session of the browser that logged in, never in a shared store. */
    @Bean
    OAuth2AuthorizedClientRepository authorizedClientRepository() {
        return new HttpSessionOAuth2AuthorizedClientRepository();
    }

    @Bean
    AuthorizationRequestRepository<OAuth2AuthorizationRequest> authorizationRequestRepository() {
        return new HttpSessionOAuth2AuthorizationRequestRepository();
    }

    @Bean
    OAuth2AuthorizedClientManager authorizedClientManager(ClientRegistrationRepository registrations,
                                                          OAuth2AuthorizedClientRepository authorizedClients) {
        DefaultOAuth2AuthorizedClientManager manager = new DefaultOAuth2AuthorizedClientManager(registrations, authorizedClients);
        manager.setAuthorizedClientProvider(OAuth2AuthorizedClientProviderBuilder.builder()
                .authorizationCode()
                .refreshToken()
                .build());
        return manager;
    }

    @Bean
    LoginResolvers loginResolvers(ClientRegistrationRepository registrations, StepUpPolicy stepUp) {
        DefaultOAuth2AuthorizationRequestResolver standard = new DefaultOAuth2AuthorizationRequestResolver(
                registrations, OAuth2AuthorizationRequestRedirectFilter.DEFAULT_AUTHORIZATION_REQUEST_BASE_URI);
        standard.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());

        DefaultOAuth2AuthorizationRequestResolver stepUpResolver = new DefaultOAuth2AuthorizationRequestResolver(
                registrations, OAuth2AuthorizationRequestRedirectFilter.DEFAULT_AUTHORIZATION_REQUEST_BASE_URI);
        String acrValues = stepUp.acrValuesParameter();
        stepUpResolver.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce()
                .andThen(builder -> builder.additionalParameters(parameters -> {
                    // max_age=0 makes the IdP authenticate again even with a live SSO session.
                    parameters.put("max_age", "0");
                    if (acrValues != null) {
                        parameters.put("acr_values", acrValues);
                    }
                })));
        return new LoginResolvers(standard, stepUpResolver);
    }

    record LoginResolvers(DefaultOAuth2AuthorizationRequestResolver standard,
                          DefaultOAuth2AuthorizationRequestResolver stepUp) {
    }
}
