import type { CatalogTool, ClientConfigs, McpEndpoint } from '../app/api/generated';
import {
  FILTER_PARAMETERS,
  InvalidFilterError,
  applyFilter,
  parseFilter,
} from '../app/core/mcp-filter';

/** Public address of the mock platform; the real BFF takes it from `publicBaseUrl`, never from the request. */
export const MOCK_PUBLIC_BASE = 'https://mcp.aiwcorpo.pl';
const CLIENT_CONFIG_NAME = 'aiwcorpo-mcp';

export function clientConfigsFor(url: string): ClientConfigs {
  return {
    claudeCode: `claude mcp add --transport http ${CLIENT_CONFIG_NAME} "${url}"`,
    copilot: JSON.stringify({ servers: { [CLIENT_CONFIG_NAME]: { type: 'http', url } } }),
    codex: `[mcp_servers.${CLIENT_CONFIG_NAME}]\nurl = "${url}"\n`,
  };
}

export type McpEndpointAnswer =
  | { status: 200; body: McpEndpoint }
  | { status: 400; body: { error: 'invalid_request'; reason: 'invalid_filter'; message: string } };

const INVALID_FILTER: McpEndpointAnswer = {
  status: 400,
  body: { error: 'invalid_request', reason: 'invalid_filter', message: 'The filter is not valid.' },
};

/**
 * GET /api/v1/me/mcp-endpoint as the BFF answers it (CC-175, CC-182): the query parameters arrive decoded, a
 * parameter outside the four, a repeated one and a value that still has `%`, `&` or `=` are an invalid filter, and
 * the query is composed from the typed values and normalized by the gateway's rules. `toolCount` counts the
 * granted, enabled tools that the filter leaves visible.
 */
export function mcpEndpointAnswer(
  params: URLSearchParams,
  catalog: readonly CatalogTool[],
): McpEndpointAnswer {
  const pairs = [...params.entries()];
  const invalid =
    pairs.some(
      ([name, value]) =>
        !(FILTER_PARAMETERS as readonly string[]).includes(name.toLowerCase()) ||
        /[%&=]/u.test(value),
    ) || new Set(pairs.map(([name]) => name.toLowerCase())).size !== pairs.length;
  if (invalid) {
    return INVALID_FILTER;
  }
  let parsed: ReturnType<typeof parseFilter>;
  try {
    parsed = parseFilter(pairs.map(([name, value]) => `${name}=${value}`).join('&'));
  } catch (error) {
    if (error instanceof InvalidFilterError) {
      return INVALID_FILTER;
    }
    throw error;
  }
  const callable = catalog.filter((tool) => tool.access === 'granted' && !tool.disabled);
  const url = parsed.canonical
    ? `${MOCK_PUBLIC_BASE}/mcp?${parsed.canonical}`
    : `${MOCK_PUBLIC_BASE}/mcp`;
  return {
    status: 200,
    body: {
      url,
      ...(parsed.canonical ? { filter: parsed.canonical } : {}),
      toolCount: applyFilter(parsed.filter, callable).length,
      clientConfigs: clientConfigsFor(url),
    },
  };
}
