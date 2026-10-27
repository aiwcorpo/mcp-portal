import { CatalogAction, CatalogStatus, PortalCatalogServer } from '../../api/generated';

/**
 * Actions this release can carry out. request_access and view_request need the access-request
 * screen (next milestone), so they are not offered yet even when the BFF lists them.
 */
export const SUPPORTED_ACTIONS: readonly CatalogAction[] = [
  'copy_link',
  'connect_oauth',
  'add_secret',
  'reconnect',
  'disconnect',
];

/** Preferred main action per status; the first one present in the server's actions[] wins. */
const PRIMARY_BY_STATUS: Record<CatalogStatus, readonly CatalogAction[]> = {
  connected: ['copy_link'],
  expiring: ['reconnect', 'copy_link'],
  reconnect_required: ['reconnect'],
  not_connected: ['connect_oauth', 'add_secret'],
  request_pending: ['view_request'],
  no_access: ['request_access'],
};

const FALLBACK_ORDER: readonly CatalogAction[] = [
  'copy_link',
  'reconnect',
  'connect_oauth',
  'add_secret',
  'request_access',
  'view_request',
  'disconnect',
];

export interface ServerActions {
  primary: CatalogAction | null;
  secondary: CatalogAction[];
}

export function serverActions(server: PortalCatalogServer): ServerActions {
  const offered = server.actions.filter((action) => SUPPORTED_ACTIONS.includes(action));
  const preferred = [...PRIMARY_BY_STATUS[server.status], ...FALLBACK_ORDER];
  const primary = preferred.find((action) => offered.includes(action) && action !== 'disconnect');
  return {
    primary: primary ?? null,
    secondary: FALLBACK_ORDER.filter((action) => action !== primary && offered.includes(action)),
  };
}
