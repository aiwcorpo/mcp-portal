package pl.aiwcorpo.mcp.portal.bff;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;

import org.apache.catalina.Context;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.tomcat.TomcatWebServer;
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext;
import org.springframework.test.context.TestPropertySource;

import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;

/** The session bound of the BFF: login starts that never complete must not use up the room of signed-in users. */
@TestPropertySource(properties = "portal.session.max-active=5")
class SessionBoundTest extends PortalHarness {

    @Autowired
    ServletWebServerApplicationContext webContext;

    @Test
    void loginStartsAtTheBoundMakeRoomAndNeverPushOutASignedInUser() {
        TestBrowser alice = login(ALICE, Instant.now());
        for (int i = 0; i < 10; i++) {
            assertThat(browser().get("/api/v1/auth/login?returnPath=/catalog").statusCode()).isEqualTo(302);
        }

        TestBrowser bob = login(BOB, Instant.now());
        for (int i = 0; i < 10; i++) {
            assertThat(browser().get("/api/v1/auth/login?returnPath=/catalog").statusCode()).isEqualTo(302);
        }

        assertThat(alice.get("/api/v1/me").statusCode()).isEqualTo(200);
        assertThat(bob.get("/api/v1/me").statusCode()).isEqualTo(200);
        TomcatWebServer server = (TomcatWebServer) webContext.getWebServer();
        assertThat(((Context) server.getTomcat().getHost().findChildren()[0]).getManager().getActiveSessions())
                .isLessThanOrEqualTo(5);
    }
}
