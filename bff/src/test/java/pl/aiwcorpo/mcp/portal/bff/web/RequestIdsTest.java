package pl.aiwcorpo.mcp.portal.bff.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class RequestIdsTest {

    private static final String C8_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

    @Test
    void idsAreUuidV7WithTheTimestampFirst() {
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < 1000; i++) {
            String id = RequestIds.newId();
            assertThat(id).matches(C8_PATTERN);
            assertThat(seen.add(id)).isTrue();
        }
        UUID uuid = RequestIds.uuidV7(0x0192d1b27c3aL);
        assertThat(uuid.version()).isEqualTo(7);
        assertThat(uuid.variant()).isEqualTo(2);
        assertThat(uuid.toString()).startsWith("0192d1b2-7c3a-7");
    }
}
