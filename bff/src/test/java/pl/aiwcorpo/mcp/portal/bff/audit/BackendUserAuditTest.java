package pl.aiwcorpo.mcp.portal.bff.audit;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class BackendUserAuditTest {

    @ParameterizedTest
    @ValueSource(strings = {"", "a\u0000b", "a\u001fb", "a\u007fb", "a\u0085b", "a\u009fb", "a b", "a b",
            "adm‮nimda", "a‪b", "a⁦b", "a⁩b", "a\ud800b", "a\udc00b", "ab\ud800"})
    void namesOutsideTheSchemaAreLeftOut(String name) {
        assertThat(AuditLog.auditableBackendUser(name)).isNull();
    }

    @Test
    void tooLongNamesAreLeftOutAndTheBoundaryCountsCodePoints() {
        assertThat(AuditLog.auditableBackendUser("x".repeat(256))).isNull();
        assertThat(AuditLog.auditableBackendUser("x".repeat(255))).hasSize(255);
        String astral255 = "😀".repeat(255);
        assertThat(AuditLog.auditableBackendUser(astral255)).isEqualTo(astral255);
        assertThat(AuditLog.auditableBackendUser(astral255 + "x")).isNull();
    }

    @Test
    void ordinaryAccountNamesPassUnchanged() {
        for (String name : new String[] {"alice", "jkowalski", "a.kowalska@firma.pl", "DOMAIN\\user", "za\u017c\u00f3\u0142\u0107", "x"}) {
            assertThat(AuditLog.auditableBackendUser(name)).isEqualTo(name);
        }
        assertThat(AuditLog.auditableBackendUser(null)).isNull();
    }
}
