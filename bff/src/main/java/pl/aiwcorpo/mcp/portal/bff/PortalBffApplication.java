package pl.aiwcorpo.mcp.portal.bff;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

import pl.aiwcorpo.mcp.portal.bff.setup.PortalSetup;

@SpringBootApplication
@ConfigurationPropertiesScan
public class PortalBffApplication {

    public static void main(String[] args) {
        if (args.length > 0 && "init".equals(args[0])) {
            System.exit(PortalSetup.run());
        }
        SpringApplication.run(PortalBffApplication.class, args);
    }
}
