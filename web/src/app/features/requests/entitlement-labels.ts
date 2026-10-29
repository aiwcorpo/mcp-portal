import { SystemId } from '../../api/generated';
import { isSystemId, systemName } from '../../shared/labels';

const LEVELS: Record<string, () => string> = {
  read: () => $localize`:@@entitlement.read:odczyt`,
  write: () => $localize`:@@entitlement.write:zapis`,
  destructive: () => $localize`:@@entitlement.destructive:operacje nieodwracalne`,
};

const CONVENTION = /^mcp-([a-z]+)-([a-z]+)$/;

/**
 * Readable name of an entitlement by the naming convention `mcp-<system>-<level>` (C9), for example
 * "Jira, zapis". Null for any other name: the code is then the only thing shown.
 */
export function entitlementTitle(entitlement: string): string | null {
  const match = CONVENTION.exec(entitlement);
  if (!match || !isSystemId(match[1]) || !Object.hasOwn(LEVELS, match[2])) {
    return null;
  }
  const system: SystemId = match[1];
  return `${systemName(system)}, ${LEVELS[match[2]]()}`;
}
