package pl.aiwcorpo.mcp.portal.bff.web;

import org.apache.catalina.core.StandardHost;
import org.springframework.boot.tomcat.ConfigurableTomcatWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class TomcatErrorConfig {

    @Bean
    WebServerFactoryCustomizer<ConfigurableTomcatWebServerFactory> jsonErrorReports() {
        return factory -> factory.addContextCustomizers(context -> {
            if (context.getParent() instanceof StandardHost host) {
                host.setErrorReportValveClass(JsonErrorReportValve.class.getName());
            }
        });
    }
}
