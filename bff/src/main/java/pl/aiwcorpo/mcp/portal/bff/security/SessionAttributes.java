package pl.aiwcorpo.mcp.portal.bff.security;

/** Names of the server-side session attributes owned by the BFF. None of them ever holds a user secret. */
public final class SessionAttributes {

    /** Validated return path for the end of the OIDC login. */
    public static final String LOGIN_RETURN_PATH = "portal.login.returnPath";

    /** {@code sub} of the session that started a step-up; the step-up login must authenticate the same user. */
    public static final String STEP_UP_SUB = "portal.login.stepUpSub";

    /** Tokens exchanged for the broker and gateway admin audiences (server side only). */
    public static final String EXCHANGED_TOKENS = "portal.exchangedTokens";

    private SessionAttributes() {
    }
}
