package pl.aiwcorpo.mcp.portal.bff.admin;

import java.io.IOException;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Reads the body of an administration request, and only when a controller asks for it after the administrator check:
 * a user without the group gets {@code 403} without a byte of the body being read. The read stops one byte past the limit,
 * so a body without a {@code Content-Length} (chunked) that keeps growing is cut here, and a declared length above the
 * limit never gets this far ({@link AdminBodyLimitFilter}).
 */
final class AdminBody {

    /** The largest body of an administration request; the largest legitimate one is a scope mapping or a system, far below. */
    static final int MAX_BYTES = 64 * 1024;

    private AdminBody() {
    }

    /** The body, or null when it is larger than {@link #MAX_BYTES} or cannot be read (the caller answers 400). */
    static byte[] read(HttpServletRequest request) {
        try {
            byte[] body = request.getInputStream().readNBytes(MAX_BYTES + 1);
            return body.length > MAX_BYTES ? null : body;
        } catch (IOException e) {
            return null;
        }
    }
}
