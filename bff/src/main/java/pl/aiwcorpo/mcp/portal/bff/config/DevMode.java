package pl.aiwcorpo.mcp.portal.bff.config;

import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;

/**
 * Whether the Spring profile {@code dev} is active. Settings that only make sense against mcp-platform-dev (IGA mock,
 * step-up without acr levels, return to ng serve, plain HTTP to stubs) are refused at start-up without it.
 */
public record DevMode(boolean enabled) {

    public static final String PROFILE = "dev";

    public static DevMode of(Environment environment) {
        return new DevMode(environment.acceptsProfiles(Profiles.of(PROFILE)));
    }

    /** Fails start-up when a dev-only setting is used outside the dev profile. */
    public void require(boolean devOnlySettingUsed, String setting) {
        if (devOnlySettingUsed && !enabled) {
            throw new IllegalStateException(setting + " is allowed only with the Spring profile '" + PROFILE + "'");
        }
    }
}
