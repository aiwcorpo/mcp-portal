package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.options;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.github.tomakehurst.wiremock.WireMockServer;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import pl.aiwcorpo.mcp.portal.bff.support.FakeIdp;
import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Starts the BFF the way scripts/run-dev.sh does: profile dev and the script's PORTAL_* values as environment
 * variables (relaxed binding included), so a variable that binds to a property directly cannot break the start
 * unnoticed again. Only the IdP and C4/C5 addresses point at test doubles.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("dev")
@ContextConfiguration(initializers = RunDevConfigurationTest.ScriptEnvironment.class)
class RunDevConfigurationTest {

    static final Path BFF_DIR = Path.of("").toAbsolutePath().normalize();
    static final FakeIdp IDP = new FakeIdp();
    static final WireMockServer BROKER = new WireMockServer(options().dynamicPort()
            .usingFilesUnderClasspath("mcp-contracts/mocks/wiremock/credential-broker"));
    static final WireMockServer GATEWAY = new WireMockServer(options().dynamicPort()
            .usingFilesUnderClasspath("mcp-contracts/mocks/wiremock/gateway-admin"));

    static {
        BROKER.start();
        GATEWAY.start();
    }

    /** The values run-dev.sh exports that do not depend on mcp-platform-dev. */
    static Map<String, Object> scriptVariables() {
        return Map.of(
                "PORTAL_IGA_MOCK_FILE", BFF_DIR.resolve("dev/iga-mock.yaml").toString(),
                "PORTAL_WEB_DIST", BFF_DIR.resolve("../web/dist/portal").toString(),
                "SPRING_PROFILES_ACTIVE", "dev");
    }

    static class ScriptEnvironment implements ApplicationContextInitializer<ConfigurableApplicationContext> {
        @Override
        public void initialize(ConfigurableApplicationContext context) {
            context.getEnvironment().getPropertySources()
                    .addFirst(new SystemEnvironmentPropertySource("run-dev.sh", scriptVariables()));
        }
    }

    @DynamicPropertySource
    static void doubles(DynamicPropertyRegistry registry) {
        registry.add("spring.security.oauth2.client.provider.keycloak.issuer-uri", IDP::issuer);
        registry.add("spring.security.oauth2.client.registration.keycloak.client-secret", () -> FakeIdp.CLIENT_SECRET);
        registry.add("portal.broker.base-url", BROKER::baseUrl);
        registry.add("portal.gateway-admin.base-url", GATEWAY::baseUrl);
        registry.add("portal.public-base-url", () -> "http://localhost:18000");
        registry.add("spring.security.oauth2.client.registration.keycloak.redirect-uri",
                () -> "{baseUrl}/api/v1/auth/callback");
        registry.add("portal.tls.insecure-plain-http-for-tests", () -> "true");
    }

    @AfterAll
    static void stop() {
        IDP.close();
        BROKER.stop();
        GATEWAY.stop();
    }

    @LocalServerPort
    int port;

    @Autowired
    Environment environment;

    @Test
    void environmentVariablesBindToPropertiesLikeInTheScript() {
        // This is how the 2026-10-27 start failure happened: the variable replaced the yml value of the property.
        assertThat(environment.getProperty("portal.iga.mock-file"))
                .isEqualTo(BFF_DIR.resolve("dev/iga-mock.yaml").toString());
    }

    @Test
    void scriptStillExportsTheValuesThisTestUses() throws IOException {
        String script = Files.readString(BFF_DIR.resolve("scripts/run-dev.sh"));
        assertThat(script)
                .contains("export PORTAL_IGA_MOCK_FILE=\"${PORTAL_IGA_MOCK_FILE:-$bff_dir/dev/iga-mock.yaml}\"")
                .contains("export PORTAL_WEB_DIST=\"${PORTAL_WEB_DIST:-$bff_dir/../web/dist/portal}\"")
                .contains("export SPRING_PROFILES_ACTIVE=dev");
    }

    @Test
    void startsWithTheScriptConfigurationAndUsesTheIgaMockData() {
        TestBrowser browser = new TestBrowser(URI.create("http://localhost:" + port), new ArrayList<>());
        assertThat(browser.get("/api/v1/me").body()).contains("\"error\":\"unauthenticated\"");

        HttpResponse<String> start = browser.get("/api/v1/auth/login");
        URI callback = IDP.approve(URI.create(start.headers().firstValue("Location").orElseThrow()),
                new FakeIdp.User("sub-mallory", "mallory", "Mallory Nogroups", List.of()), Instant.now(), "1");
        browser.get(callback.toString());
        JsonNode gitlab = JsonMapper.builder().build().readTree(browser.get("/api/v1/catalog").body()).get("servers").get(1);

        // mallory's pending request for mcp-gitlab-read comes from dev/iga-mock.yaml.
        assertThat(gitlab.get("status").asString()).isEqualTo("request_pending");
    }
}
