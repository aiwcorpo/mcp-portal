import { SystemId } from '../../api/generated';

/**
 * How to create the narrowest token the system allows. Static texts: C12 does not expose per-system
 * hints, and the steps differ per product, not per user.
 */
const INSTRUCTIONS: Record<SystemId, () => string[]> = {
  jira: () => [
    $localize`:@@token.jira.1:In Jira, open the profile menu and choose Profile, then Personal Access Tokens.`,
    $localize`:@@token.jira.2:Choose Create token, give it a name that points to the MCP portal and enable automatic expiry.`,
    $localize`:@@token.jira.3:Set the shortest expiry that works for you. The token acts with your permissions in Jira; the portal does not extend them.`,
  ],
  confluence: () => [
    $localize`:@@token.confluence.1:In Confluence, open the profile menu and choose Settings, then Personal Access Tokens.`,
    $localize`:@@token.confluence.2:Choose Create token, give it a name that points to the MCP portal and enable automatic expiry.`,
    $localize`:@@token.confluence.3:Set the shortest expiry that works for you. The token acts with your permissions in Confluence.`,
  ],
  gitlab: () => [
    $localize`:@@token.gitlab.1:In GitLab, open User preferences, then Access tokens.`,
    $localize`:@@token.gitlab.2:Add a new token with an expiry date. Select only the read_api scope, unless you need tools that change data; then use api.`,
    $localize`:@@token.gitlab.3:Do not select the sudo, admin_mode or write_repository scopes: MCP tools do not use them.`,
  ],
  servicedesk: () => [
    $localize`:@@token.servicedesk.1:In the service desk, create a personal API token in your profile settings.`,
    $localize`:@@token.servicedesk.2:If the system lets you choose token permissions, limit them to the tickets you work with and set an expiry date.`,
  ],
  opensearch: () => [
    $localize`:@@token.opensearch.1:In OpenSearch Dashboards, create an API token tied to your account.`,
    $localize`:@@token.opensearch.2:Limit it to read access to the indexes you need and set an expiry date.`,
  ],
};

export function tokenInstructions(system: SystemId): string[] {
  return INSTRUCTIONS[system]();
}
