import { CatalogAction, PortalCatalogServer } from '../../api/generated';

/**
 * Actions this release can carry out. Access requests are an M4 topic: the BFF of M2 has no
 * `POST /access-requests` and view_request needs the requests screen, so neither is offered even when
 * the BFF lists them; the pending status is still shown as text. Add 'request_access' here when the BFF
 * implements the operation (the flow in ConnectionActions is ready).
 */
export const SUPPORTED_ACTIONS: readonly CatalogAction[] = [
  'copy_link',
  'connect_oauth',
  'add_secret',
  'reconnect',
  'disconnect',
];

export const ACCESS_REQUESTS_AVAILABLE = SUPPORTED_ACTIONS.includes('request_access');

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
