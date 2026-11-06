package pl.aiwcorpo.mcp.portal.bff.upstream;

import tools.jackson.databind.JsonNode;

/**
 * A successful answer of an admin operation of C4 or C5: the JSON body (null for 204) and the {@code ETag} when the
 * upstream sent a well-formed one, which the BFF hands to the browser unchanged so the next write can send it back.
 */
public record AdminReply(int status, JsonNode body, String etag) {
}
