package pl.aiwcorpo.mcp.portal.bff.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

import pl.aiwcorpo.mcp.portal.bff.config.DevMode;
import pl.aiwcorpo.mcp.portal.bff.config.PortalProperties;
import pl.aiwcorpo.mcp.portal.bff.web.ReturnPaths;

class StepUpPolicyTest {

    private static final Instant NOW = Instant.parse("2026-10-27T10:00:00Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);

    private static PortalProperties properties(List<String> acrValues) {
        return new PortalProperties("keycloak", "mcp-portal-bff", null, null, null, null, null,
                new PortalProperties.StepUp(Duration.ofMinutes(5), acrValues), null, null, null);
    }

    private static StepUpPolicy policy(List<String> acrValues) {
        return new StepUpPolicy(properties(acrValues), new DevMode(true), CLOCK);
    }

    private static PortalUser user(Instant authTime, String acr) {
        return new PortalUser("sub-1", "alice", "Alice", null, Set.of(), authTime, acr, Map.of());
    }

    @Test
    void freshnessFollowsAuthTime() {
        StepUpPolicy policy = policy(List.of());
        assertThat(policy.isFresh(user(NOW.minusSeconds(60), "1"))).isTrue();
        assertThat(policy.isFresh(user(NOW.minus(Duration.ofMinutes(5)), "1"))).isTrue();
        assertThat(policy.isFresh(user(NOW.minus(Duration.ofMinutes(5)).minusSeconds(1), "1"))).isFalse();
        assertThat(policy.isFresh(user(null, "1"))).isFalse();
        assertThat(policy.isFresh(user(NOW.plus(Duration.ofHours(1)), "1"))).isFalse();
    }

    @Test
    void configuredAcrValuesMustMatch() {
        StepUpPolicy policy = policy(List.of("mfa", "gold"));
        assertThat(policy.isFresh(user(NOW, "mfa"))).isTrue();
        assertThat(policy.isFresh(user(NOW, "1"))).isFalse();
        assertThat(policy.isFresh(user(NOW, null))).isFalse();
        assertThat(policy.acrValuesParameter()).isEqualTo("mfa gold");
        assertThat(policy(List.of()).acrValuesParameter()).isNull();
    }

    @Test
    void stepUpWithoutAcrLevelsIsRefusedOutsideDev() {
        assertThatThrownBy(() -> new StepUpPolicy(properties(List.of()), new DevMode(false), CLOCK))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("acr-values");
        assertThat(new StepUpPolicy(properties(List.of("mfa")), new DevMode(false), CLOCK).acrValuesParameter())
                .isEqualTo("mfa");
    }

    @Test
    void stepUpUrlKeepsTheReturnPathParseable() {
        assertThat(StepUpPolicy.stepUpUrl("/catalog")).isEqualTo("/api/v1/auth/login?stepUp=true&returnPath=/catalog");
        assertThat(StepUpPolicy.stepUpUrl("/c?a=1&b=2+3"))
                .isEqualTo("/api/v1/auth/login?stepUp=true&returnPath=/c?a%3D1%26b%3D2%2B3");
        assertThat(StepUpPolicy.stepUpUrl("//evil.example")).endsWith("returnPath=" + ReturnPaths.DEFAULT);
        assertThat(StepUpPolicy.stepUpUrl(null)).endsWith("returnPath=/");
    }
}
