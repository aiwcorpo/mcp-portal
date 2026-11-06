/**
 * How to create the narrowest token a system allows. One text for every system: the systems are runtime data of the
 * broker, C12 carries no per-system hints, and the steps below hold for a personal access token anywhere.
 */
export function tokenInstructions(systemName: string): string[] {
  return [
    $localize`:@@token.generic.1:In ${systemName}:system:, open your profile or account settings and find personal access tokens (or API tokens).`,
    $localize`:@@token.generic.2:Create a token with a name that points to the MCP portal and an expiry date. Grant only the permissions the tools need, read access first.`,
    $localize`:@@token.generic.3:Set the shortest expiry that works for you. The token acts with your permissions in ${systemName}:system:; the portal does not extend them.`,
  ];
}
