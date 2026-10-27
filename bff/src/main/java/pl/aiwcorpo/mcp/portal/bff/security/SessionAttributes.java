package pl.aiwcorpo.mcp.portal.bff.security;

/** Names of the server-side session attributes owned by the BFF. None of them ever holds a user secret. */
public final class SessionAttributes {

    /** Validated return path for the end of the OIDC login. */
    public static final String LOGIN_RETURN_PATH = "portal.login.returnPath";

    /** Tokens exchanged for the broker and gateway admin audiences (server side only). */
    public static final String EXCHANGED_TOKENS = "portal.exchangedTokens";

    private SessionAttributes() {
    }
}
