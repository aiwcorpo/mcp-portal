import { CatalogAction, PortalCatalogServer } from '../../api/generated';

/**
 * Actions this release can carry out. view_request needs the requests screen (M4), so it is not
 * offered even when the BFF lists it; the pending status is still shown as text.
 */
export const SUPPORTED_ACTIONS: readonly CatalogAction[] = [
  'copy_link',
  'connect_oauth',
  'add_secret',
  'reconnect',
  'request_access',
  'disconnect',
];

const CATALOG_ORDER: readonly CatalogAction[] = [
  'reconnect',
  'connect_oauth',
  'add_secret',
  'copy_link',
  'request_access',
];

const CONNECTIONS_ORDER: readonly CatalogAction[] = [
  'reconnect',
  'connect_oauth',
  'add_secret',
  'request_access',
  'disconnect',
];

function pick(server: PortalCatalogServer, order: readonly CatalogAction[]): CatalogAction[] {
  return order.filter(
    (action) => server.actions.includes(action) && SUPPORTED_ACTIONS.includes(action),
  );
}

/** Buttons of a catalog row: everything the BFF offers except disconnect (that is on Connections). */
export function catalogRowActions(server: PortalCatalogServer): CatalogAction[] {
  return pick(server, CATALOG_ORDER);
}

/** Buttons of a connections row: how to (re)connect, request access, disconnect; no link copying. */
export function connectionRowActions(server: PortalCatalogServer): CatalogAction[] {
  return pick(server, CONNECTIONS_ORDER);
}

/** Actions that move the user forward get the filled button, the rest the outlined one (mockups). */
export function isEmphasised(action: CatalogAction): boolean {
  return action === 'reconnect' || action === 'connect_oauth' || action === 'add_secret';
}
