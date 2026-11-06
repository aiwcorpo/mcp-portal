import type { CatalogTool, Connection, PortalCatalogServer } from '../app/api/generated';

export function toolFixture(name: string, overrides: Partial<CatalogTool> = {}): CatalogTool {
  return {
    name,
    description: `${name} description`,
    risk: 'READ_ONLY',
    action: 'read',
    access: 'granted',
    requiredEntitlements: ['mcp-test-read'],
    ...overrides,
  };
}

export function connectionFixture(
  system: string,
  overrides: Partial<Connection> = {},
): Connection {
  return {
    system,
    type: 'user-oauth',
    status: 'connected',
    backendUser: 'jkowalski',
    verified: true,
    expiresAt: null,
    connectedAt: '2026-10-01T08:00:00Z',
    lastUsedAt: null,
    ...overrides,
  };
}

export function serverFixture(
  system: string,
  overrides: Partial<PortalCatalogServer> = {},
): PortalCatalogServer {
  return {
    serverId: `mcp-${system}`,
    system,
    version: '1.0.0',
    url: `https://mcp.aiwcorpo.pl/s/mcp-${system}/mcp`,
    status: 'connected',
    actions: ['copy_link'],
    credential: { supportedTypes: ['user-oauth', 'user-secret'], defaultType: 'user-oauth' },
    connection: null,
    tools: [toolFixture(`${system}__get`)],
    ...overrides,
  };
}
