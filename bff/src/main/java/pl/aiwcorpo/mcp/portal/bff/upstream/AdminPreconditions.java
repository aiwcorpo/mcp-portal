package pl.aiwcorpo.mcp.portal.bff.upstream;

/** {@code If-Match} or {@code If-None-Match: *} of a write, sent to the upstream exactly as the browser gave it. */
public record AdminPreconditions(String ifMatch, boolean ifNoneMatchStar) {

    public static final AdminPreconditions NONE = new AdminPreconditions(null, false);
}
