package pl.aiwcorpo.mcp.portal.bff.token;

/** No usable token for a downstream call. The message names the step, never a token. */
public class TokenUnavailableException extends RuntimeException {

    public TokenUnavailableException(String message) {
        super(message, null, false, false);
    }
}
