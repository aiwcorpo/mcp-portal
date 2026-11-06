import { entitlementTitle } from './entitlement-labels';

describe('entitlementTitle', () => {
  it('names the system and the level from the mcp-<system>-<level> convention', () => {
    expect(entitlementTitle('mcp-jira-write')).toBe('Jira, write');
    expect(entitlementTitle('mcp-opensearch-read')).toBe('Opensearch, read');
    expect(entitlementTitle('mcp-confluence-destructive')).toBe(
      'Confluence, irreversible operations',
    );
  });

  it('gives nothing for a name that does not follow the convention', () => {
    expect(entitlementTitle('mcp-Sonar-read')).toBeNull();
    expect(entitlementTitle('mcp-jira-admin')).toBeNull();
    expect(entitlementTitle('finance-approvers')).toBeNull();
    expect(entitlementTitle('mcp-jira-__proto__')).toBeNull();
  });
});
