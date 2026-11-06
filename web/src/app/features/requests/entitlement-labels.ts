import { isSystemId, systemName } from '../../shared/labels';

const LEVELS: Record<string, () => string> = {
  read: () => $localize`:@@entitlement.read:read`,
  write: () => $localize`:@@entitlement.write:write`,
  destructive: () => $localize`:@@entitlement.destructive:irreversible operations`,
};

const CONVENTION = /^mcp-([a-z][a-z0-9]{1,30})-([a-z]+)$/;

/**
 * Readable name of an entitlement by the naming convention `mcp-<system>-<level>` (C9), for example
 * "Jira, write". Null for any other name: the code is then the only thing shown.
 */
export function entitlementTitle(
  entitlement: string,
  names: ReadonlyMap<string, string> = new Map(),
): string | null {
  const match = CONVENTION.exec(entitlement);
  if (!match || !isSystemId(match[1]) || !Object.hasOwn(LEVELS, match[2])) {
    return null;
  }
  return `${names.get(match[1]) ?? systemName(match[1])}, ${LEVELS[match[2]]()}`;
}
