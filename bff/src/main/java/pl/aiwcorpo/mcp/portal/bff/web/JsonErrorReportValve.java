package pl.aiwcorpo.mcp.portal.bff.web;

import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;

import org.apache.catalina.connector.Request;
import org.apache.catalina.connector.Response;
import org.apache.catalina.valves.ErrorReportValve;

/**
 * Tomcat's own error page for requests it rejects before any servlet runs (encoded slashes, malformed targets,
 * oversized headers) is HTML. {@code /api/**} never answers with HTML, so the same {@code Error} JSON is written
 * here, with a fresh request id because the request id filter never saw the request.
 */
public class JsonErrorReportValve extends ErrorReportValve {

    public JsonErrorReportValve() {
        setShowReport(false);
        setShowServerInfo(false);
    }

    @Override
    protected void report(Request request, Response response, Throwable throwable) {
        int status = response.getStatus();
        if (status < 400 || response.getContentWritten() > 0 || !response.setErrorReported()) {
            return;
        }
        String id = response.getHeader(RequestIds.HEADER);
        if (id == null) {
            id = RequestIds.newId();
            response.setHeader(RequestIds.HEADER, id);
        }
        try {
            response.setContentType("application/json");
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            Writer writer = response.getReporter();
            if (writer != null) {
                // Fixed snake_case code and a UUID: nothing to escape.
                writer.write("{\"error\":\"" + ErrorCodes.forStatus(status) + "\",\"requestId\":\"" + id + "\"}");
                response.finishResponse();
            }
        } catch (IOException | IllegalStateException e) {
            // The client is gone or the response is already committed; there is nobody left to tell.
        }
    }
}
