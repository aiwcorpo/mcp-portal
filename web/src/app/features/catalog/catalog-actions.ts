import { CatalogAction, CatalogTool, PortalCatalogServer } from '../../api/generated';

/** Every action of C12 is handled; "Disconnect" is only offered on the connections page. */
export const SUPPORTED_ACTIONS: readonly CatalogAction[] = [
  'copy_link',
  'connect_oauth',
  'add_secret',
  'reconnect',
  'request_access',
  'view_request',
  'disconnect',
];

const CATALOG_ORDER: readonly CatalogAction[] = [
  'reconnect',
  'connect_oauth',
  'add_secret',
  'copy_link',
  'request_access',
  'view_request',
];

const CONNECTIONS_ORDER: readonly CatalogAction[] = [
  'reconnect',
  'connect_oauth',
  'add_secret',
  'request_access',
  'view_request',
  'disconnect',
];

const CONNECT_ACTIONS: readonly CatalogAction[] = ['connect_oauth', 'add_secret', 'reconnect'];

/**
 * A system whose credential is a service account or a token exchange has nothing for the user to connect
 * (Service Desk, OpenSearch). The BFF does not offer connect actions there; a stray one is dropped so that
 * no button asks for a token the system would never use.
 */
export function hasUserCredential(server: PortalCatalogServer): boolean {
  const types = server.credential?.supportedTypes;
  return !types || types.some((type) => type === 'user-oauth' || type === 'user-secret');
}

function pick(server: PortalCatalogServer, order: readonly CatalogAction[]): CatalogAction[] {
  const connectable = hasUserCredential(server);
  return order.filter(
    (action) =>
      server.actions.includes(action) &&
      SUPPORTED_ACTIONS.includes(action) &&
      (connectable || !CONNECT_ACTIONS.includes(action)),
  );
}

/**
 * "Submit request" next to a denied tool (CC-113): the server must offer `request_access` (it does so only when
 * a denied tool names entitlements and no request for them is pending) and the tool itself names an
 * entitlement to ask for.
 */
export function canRequestTool(server: PortalCatalogServer, tool: CatalogTool): boolean {
  return (
    server.actions.includes('request_access') &&
    tool.access === 'denied' &&
    !tool.disabled &&
    tool.requiredEntitlements.length > 0
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
