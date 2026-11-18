package pl.aiwcorpo.mcp.portal.bff.config;

import java.net.http.HttpClient;
import java.time.Duration;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/** HTTP client for the BFF's calls to the IdP: login code exchange, userinfo, refresh, token exchange, back-channel logout. */
@Configuration(proxyBeanMethods = false)
public class IdpClientConfig {

    public static final String IDP_REST_CLIENT = "idpRestClient";

    @Bean
    @Qualifier(IDP_REST_CLIENT)
    RestClient idpRestClient() {
        return RestClient.builder().requestFactory(requestFactory()).build();
    }

    /** 5 s to connect and 10 s to answer: a stalled IdP must not hold a request thread for longer. */
    public static JdkClientHttpRequestFactory requestFactory() {
        HttpClient http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                // A redirect from the token endpoint would resend credentials to wherever it points.
                .followRedirects(HttpClient.Redirect.NEVER)
                .version(HttpClient.Version.HTTP_1_1)
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(http);
        requestFactory.setReadTimeout(Duration.ofSeconds(10));
        return requestFactory;
    }
}
