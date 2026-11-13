package pl.aiwcorpo.mcp.portal.bff.config;

import java.time.Clock;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.tomcat.TomcatContextCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration(proxyBeanMethods = false)
class CoreConfig {

    @Bean
    @ConditionalOnMissingBean
    Clock clock() {
        return Clock.systemUTC();
    }

    // The in-memory session store has no bound of its own, and a login start creates a session for anyone.
    @Bean
    TomcatContextCustomizer sessionBound(PortalProperties properties) {
        return context -> context.setManager(new LoginRoomSessionManager(properties.session().maxActive()));
    }

    @Bean
    DevMode devMode(Environment environment) {
        return DevMode.of(environment);
    }

    @Bean
    PublicUrls publicUrls(PortalProperties properties, DevMode devMode) {
        return new PublicUrls(properties.publicBaseUrl(), devMode);
    }
}
