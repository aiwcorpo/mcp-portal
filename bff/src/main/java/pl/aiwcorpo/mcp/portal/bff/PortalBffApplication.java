package pl.aiwcorpo.mcp.portal.bff;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class PortalBffApplication {

    public static void main(String[] args) {
        SpringApplication.run(PortalBffApplication.class, args);
    }
}
