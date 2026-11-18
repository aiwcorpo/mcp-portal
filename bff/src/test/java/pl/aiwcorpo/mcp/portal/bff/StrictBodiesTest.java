package pl.aiwcorpo.mcp.portal.bff;

import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathMatching;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

import jakarta.servlet.Filter;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.Ordered;

import pl.aiwcorpo.mcp.portal.bff.support.TestBrowser;

/** A JSON value of another type than the schema names is a 400, never coerced into text. */
@Import(StrictBodiesTest.CountingBodies.class)
class StrictBodiesTest extends PortalHarness {

    /** Bytes the application read from request bodies, counted outside every filter of the application. */
    static final AtomicLong BYTES_READ = new AtomicLong();

    @TestConfiguration
    static class CountingBodies {
        @Bean
        FilterRegistrationBean<Filter> countingBodies() {
            Filter filter = (request, response, chain) -> chain.doFilter(
                    new HttpServletRequestWrapper((HttpServletRequest) request) {
                        @Override
                        public ServletInputStream getInputStream() throws IOException {
                            ServletInputStream in = super.getInputStream();
                            return new ServletInputStream() {
                                @Override
                                public int read() throws IOException {
                                    int b = in.read();
                                    if (b >= 0) {
                                        BYTES_READ.incrementAndGet();
                                    }
                                    return b;
                                }

                                @Override
                                public int read(byte[] buffer, int offset, int length) throws IOException {
                                    int n = in.read(buffer, offset, length);
                                    if (n > 0) {
                                        BYTES_READ.addAndGet(n);
                                    }
                                    return n;
                                }

                                @Override
                                public boolean isFinished() {
                                    return in.isFinished();
                                }

                                @Override
                                public boolean isReady() {
                                    return in.isReady();
                                }

                                @Override
                                public void setReadListener(ReadListener listener) {
                                    in.setReadListener(listener);
                                }
                            };
                        }
                    }, response);
            FilterRegistrationBean<Filter> registration = new FilterRegistrationBean<>(filter);
            registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
            return registration;
        }
    }

    private static int brokerWrites() {
        return BROKER.findAll(anyRequestedFor(urlPathMatching("/v1/connections/.*(secret|oauth/start)"))).size();
    }

    @Test
    void aUserWriteOverTheBodyLimitIsRefusedWithoutReadingIt() {
        TestBrowser browser = login(ALICE, Instant.now());
        byte[] body = ("{\"secret\":\"" + "a".repeat(1024 * 1024 - 13) + "\"}").getBytes(StandardCharsets.UTF_8);
        assertThat(body).hasSize(1024 * 1024);

        BYTES_READ.set(0);
        HttpResponse<String> declared = browser.requestWith("PUT", "/api/v1/connections/gitlab/secret",
                HttpRequest.BodyPublishers.ofByteArray(body), true, Map.of());
        assertThat(declared.statusCode()).isEqualTo(400);
        assertThat(JSON.readTree(declared.body()).get("error").asString()).isEqualTo("invalid_request");
        assertThat(BYTES_READ.get()).isZero();

        BYTES_READ.set(0);
        HttpResponse<String> chunked = browser.requestWith("PUT", "/api/v1/connections/gitlab/secret",
                HttpRequest.BodyPublishers.ofInputStream(() -> new ByteArrayInputStream(body)), true, Map.of());
        assertThat(chunked.statusCode()).isEqualTo(400);
        assertThat(JSON.readTree(chunked.body()).get("error").asString()).isEqualTo("invalid_request");
        assertThat(BYTES_READ.get()).isLessThanOrEqualTo(64 * 1024 + 1);
    }

    @Test
    void secretAndExpiryMustBeJsonStrings() {
        TestBrowser browser = login(ALICE, Instant.now());
        int before = brokerWrites();

        for (String body : List.of("{\"secret\":123456}", "{\"secret\":true}", "{\"secret\":1.5}",
                "{\"secret\":\"x\",\"expiresAt\":20270131}", "{\"secret\":[\"x\"]}", "{\"secret\":{\"a\":1}}")) {
            HttpResponse<String> response = browser.put("/api/v1/connections/jira/secret", body, true);
            C12.assertResponse("PUT", "/api/v1/connections/{system}/secret", response);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("invalid_request");
            assertThat(response.body()).doesNotContain("123456");
        }
        assertThat(brokerWrites()).isEqualTo(before);
    }

    @Test
    void returnPathOfAnOAuthStartMustBeAString() {
        TestBrowser browser = login(ALICE, Instant.now());
        int before = brokerWrites();

        for (String body : List.of("{\"returnPath\":1}", "{\"returnPath\":true}")) {
            HttpResponse<String> response = browser.post("/api/v1/connections/gitlab/oauth", body, true);
            C12.assertResponse("POST", "/api/v1/connections/{system}/oauth", response);
            assertThat(response.statusCode()).as(body).isEqualTo(400);
        }
        assertThat(brokerWrites()).isEqualTo(before);
    }
}
