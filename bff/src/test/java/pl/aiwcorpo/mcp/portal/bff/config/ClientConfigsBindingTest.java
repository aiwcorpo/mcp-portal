package pl.aiwcorpo.mcp.portal.bff.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.assertj.AssertableApplicationContext;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/** The binder with the shipped application.yml and without the dev profile (what a production start sees). */
class ClientConfigsBindingTest {

    @EnableConfigurationProperties(PortalProperties.class)
    static class Config {
    }

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withInitializer(new ConfigDataApplicationContextInitializer())
            .withUserConfiguration(Config.class);

    private static PortalProperties.ClaudeCode claudeCode(AssertableApplicationContext context) {
        return context.getBean(PortalProperties.class).clientConfigs().claudeCode();
    }

    @Test
    void withoutTheDevProfileAndWithoutSettingsThereAreNoFlags() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(claudeCode(context).clientId()).isNull();
            assertThat(claudeCode(context).callbackPort()).isNull();
        });
    }

    @Test
    void emptyValuesGiveNoFlagsAndSetValuesAreBound() {
        runner.withPropertyValues("portal.client-configs.claude-code.client-id=",
                "portal.client-configs.claude-code.callback-port=").run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(claudeCode(context).clientId()).isNull();
            assertThat(claudeCode(context).callbackPort()).isNull();
        });
        runner.withPropertyValues("portal.client-configs.claude-code.client-id=0oa1b2c3",
                "portal.client-configs.claude-code.callback-port=33418").run(context -> {
            assertThat(claudeCode(context).clientId()).isEqualTo("0oa1b2c3");
            assertThat(claudeCode(context).callbackPort()).isEqualTo(33418);
        });
    }

    @Test
    void theDevProfileSetsTheDevClientAndAnEmptyOverrideSwitchesItOff() {
        runner.withPropertyValues("spring.profiles.active=dev").run(context -> {
            assertThat(claudeCode(context).clientId()).isEqualTo("claude-code");
            assertThat(claudeCode(context).callbackPort()).isEqualTo(33418);
        });
    }

    @Test
    void aBadValueStopsTheStartup() {
        runner.withPropertyValues("portal.client-configs.claude-code.client-id=a;b")
                .run(context -> assertThat(context).hasFailed());
        runner.withPropertyValues("portal.client-configs.claude-code.callback-port=80")
                .run(context -> assertThat(context).hasFailed());
        runner.withPropertyValues("portal.client-configs.claude-code.callback-port=abc")
                .run(context -> assertThat(context).hasFailed());
    }
}
