package pl.aiwcorpo.mcp.portal.bff.token;

import java.io.Serializable;
import java.time.Duration;
import java.time.Instant;

/** Access token for a downstream audience. {@link #toString()} never shows the value. */
public record BearerToken(String value, Instant expiresAt) implements Serializable {

    public boolean usableAt(Instant now, Duration skew) {
        return expiresAt.minus(skew).isAfter(now);
    }

    public String authorizationHeader() {
        return "Bearer " + value;
    }

    @Override
    public String toString() {
        return "BearerToken[expiresAt=" + expiresAt + "]";
    }
}
