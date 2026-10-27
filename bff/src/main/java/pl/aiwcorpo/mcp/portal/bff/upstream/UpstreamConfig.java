package pl.aiwcorpo.mcp.portal.bff.upstream;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import pl.aiwcorpo.mcp.portal.bff.config.DevMode;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;

@Configuration(proxyBeanMethods = false)
class UpstreamConfig {

    @Bean
    BrokerClient brokerClient(PortalProperties properties, DevMode devMode) {
        return new BrokerClient(new UpstreamCalls("credential broker",
                UpstreamHttp.restClient("credential broker", properties.broker(), properties.tls(), devMode)));
    }

    @Bean
    GatewayAdminClient gatewayAdminClient(PortalProperties properties, DevMode devMode) {
        return new GatewayAdminClient(new UpstreamCalls("gateway admin",
                UpstreamHttp.restClient("gateway admin", properties.gatewayAdmin(), properties.tls(), devMode)));
    }
}
