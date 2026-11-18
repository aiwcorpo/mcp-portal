package pl.aiwcorpo.mcp.portal.bff.web;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * The body limit of the API outside {@code /api/v1/admin/} (which has its own, {@code AdminBodyLimitFilter}): the user
 * writes bind the body as a byte array, which the framework reads whole before any handler or limit runs. A declared
 * {@code Content-Length} above the limit is answered {@code 400 invalid_request} without reading; a body without one
 * (chunked) fails the read one byte past the limit, which the handler answers the same way.
 */
@Component
@Order(-50)
class UserBodyLimitFilter extends OncePerRequestFilter {

    /** Far above the largest user body of the contract (a secret of 4096 characters, JSON-escaped). */
    static final int MAX_BYTES = 64 * 1024;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String uri = request.getRequestURI();
        return !uri.startsWith("/api/") || uri.startsWith("/api/v1/admin/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        long declared = request.getContentLengthLong();
        if (declared > MAX_BYTES) {
            response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            // The body is not read, so the connection cannot be reused for the next request.
            response.setHeader("Connection", "close");
            response.getWriter().write("{\"error\":\"" + ApiError.INVALID_REQUEST + "\",\"requestId\":\""
                    + RequestIds.of(request) + "\"}");
            return;
        }
        chain.doFilter(declared < 0 ? new Limited(request) : request, response);
    }

    private static final class Limited extends HttpServletRequestWrapper {

        private ServletInputStream limited;

        Limited(HttpServletRequest request) {
            super(request);
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (limited == null) {
                limited = new LimitedStream(super.getInputStream());
            }
            return limited;
        }
    }

    private static final class LimitedStream extends ServletInputStream {

        private final ServletInputStream in;
        private long count;

        LimitedStream(ServletInputStream in) {
            this.in = in;
        }

        @Override
        public int read() throws IOException {
            int b = in.read();
            if (b >= 0) {
                counted(1);
            }
            return b;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            // Never asks the connection for more than one byte past the limit.
            int n = in.read(buffer, offset, (int) Math.min(length, MAX_BYTES + 1L - count));
            if (n > 0) {
                counted(n);
            }
            return n;
        }

        private void counted(int n) throws IOException {
            count += n;
            if (count > MAX_BYTES) {
                throw new IOException("request body larger than " + MAX_BYTES + " bytes");
            }
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
    }
}
