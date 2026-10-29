import { entitlementTitle } from './entitlement-labels';

describe('entitlementTitle', () => {
  it('names the system and the level from the mcp-<system>-<level> convention', () => {
    expect(entitlementTitle('mcp-jira-write')).toBe('Jira, zapis');
    expect(entitlementTitle('mcp-opensearch-read')).toBe('OpenSearch, odczyt');
    expect(entitlementTitle('mcp-confluence-destructive')).toBe(
      'Confluence, operacje nieodwracalne',
    );
  });

  it('gives nothing for a name that does not follow the convention', () => {
    expect(entitlementTitle('mcp-sonar-read')).toBeNull();
    expect(entitlementTitle('mcp-jira-admin')).toBeNull();
    expect(entitlementTitle('finance-approvers')).toBeNull();
    expect(entitlementTitle('mcp-jira-__proto__')).toBeNull();
  });
});
