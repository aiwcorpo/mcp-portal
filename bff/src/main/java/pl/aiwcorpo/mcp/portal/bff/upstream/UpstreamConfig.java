package pl.aiwcorpo.mcp.portal.bff.upstream;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;

@Configuration(proxyBeanMethods = false)
class UpstreamConfig {

    @Bean
    BrokerClient brokerClient(PortalProperties properties) {
        return new BrokerClient(new UpstreamCalls("credential broker",
                UpstreamHttp.restClient("credential broker", properties.broker(), properties.tls())));
    }

    @Bean
    GatewayAdminClient gatewayAdminClient(PortalProperties properties) {
        return new GatewayAdminClient(new UpstreamCalls("gateway admin",
                UpstreamHttp.restClient("gateway admin", properties.gatewayAdmin(), properties.tls())));
    }
}
