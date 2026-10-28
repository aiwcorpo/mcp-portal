import { PortalCatalogServer } from '../api/generated';
import { serverFixture, toolFixture } from '../../testing/fixtures';
import { entitlementToRequest } from './connection-actions.service';

describe('entitlementToRequest', () => {
  const jira: PortalCatalogServer = serverFixture('jira', {
    tools: [
      toolFixture('jira__create_issue', {
        access: 'denied',
        requiredEntitlements: ['mcp-jira-write'],
      }),
      toolFixture('jira__delete_issue', {
        access: 'denied',
        requiredEntitlements: ['mcp-jira-destructive'],
      }),
    ],
  });

  it('asks for the entitlement of the tool that was clicked, not of the first denied one', () => {
    expect(entitlementToRequest(jira, jira.tools[1])).toBe('mcp-jira-destructive');
    expect(entitlementToRequest(jira, jira.tools[0])).toBe('mcp-jira-write');
  });

  it('falls back to the first denied tool for a whole server row', () => {
    expect(entitlementToRequest(jira)).toBe('mcp-jira-write');
  });

  it('has nothing to ask for when the tool names no entitlement', () => {
    expect(
      entitlementToRequest(jira, toolFixture('jira__x', { requiredEntitlements: [] })),
    ).toBeNull();
  });
});
