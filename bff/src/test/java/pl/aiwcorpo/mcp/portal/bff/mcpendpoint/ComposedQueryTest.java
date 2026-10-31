package pl.aiwcorpo.mcp.portal.bff.mcpendpoint;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/** The step before the filter parser: the query composed from what the HTTP layer made of the request. */
class ComposedQueryTest {

    private static MockHttpServletRequest request(String queryString, String... nameValuePairs) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/me/mcp-endpoint");
        request.setQueryString(queryString);
        for (int i = 0; i < nameValuePairs.length; i += 2) {
            request.addParameter(nameValuePairs[i], nameValuePairs[i + 1]);
        }
        return request;
    }

    @Test
    void decodedValuesAreJoinedWithoutEncodingThemAgain() {
        assertThat(McpEndpointController.composedQuery(
                request("systems=jira%2Cgitlab&access=read", "systems", "jira,gitlab", "access", "read")))
                .isEqualTo("systems=jira,gitlab&access=read");
    }

    @Test
    void aBrokenEscapeIsAnInvalidFilterBecauseTheContainerWouldDropTheParameter() {
        for (String query : new String[] {"systems=jira%zz", "systems=%", "systems=jira%2", "access=read&exclude=%g1"}) {
            assertThat(McpEndpointController.composedQuery(request(query, "access", "read"))).as(query).isNull();
        }
    }

    @Test
    void aRepeatedParameterIsAnInvalidFilter() {
        MockHttpServletRequest request = request("systems=jira&systems=gitlab");
        request.addParameter("systems", "jira");
        request.addParameter("systems", "gitlab");
        assertThat(McpEndpointController.composedQuery(request)).isNull();
    }

    @Test
    void noQueryComposesNothing() {
        assertThat(McpEndpointController.composedQuery(request(null))).isEmpty();
    }
}
