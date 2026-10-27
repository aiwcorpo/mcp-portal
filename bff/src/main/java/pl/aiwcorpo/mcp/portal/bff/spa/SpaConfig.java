package pl.aiwcorpo.mcp.portal.bff.spa;

import java.nio.file.Path;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;

/** Static files of the Angular build from {@code portal.web.dist-path}, same origin as the API. */
@Configuration(proxyBeanMethods = false)
class SpaConfig implements WebMvcConfigurer {

    private static final Logger log = LoggerFactory.getLogger(SpaConfig.class);

    private final Path distRoot;

    SpaConfig(PortalProperties properties) {
        this.distRoot = Path.of(properties.web().distPath()).toAbsolutePath().normalize();
        if (!distRoot.resolve("index.html").toFile().isFile()) {
            log.warn("No index.html in {}; the frontend is not served until it is built there", distRoot);
        }
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        String location = distRoot.toUri().toString();
        registry.addResourceHandler("/**")
                .addResourceLocations(location.endsWith("/") ? location : location + "/")
                // Revalidate: hashed file names depend on the build configuration, which the BFF does not control.
                .setCacheControl(CacheControl.noCache());
    }

    /** Runs after Spring Security, so index.html gets the same security headers as everything else. */
    @Bean
    FilterRegistrationBean<SpaFallbackFilter> spaFallbackFilter(PortalProperties properties) {
        FilterRegistrationBean<SpaFallbackFilter> registration = new FilterRegistrationBean<>(
                new SpaFallbackFilter(distRoot, properties.web().cspNonceToken()));
        registration.setOrder(Ordered.LOWEST_PRECEDENCE);
        return registration;
    }
}
