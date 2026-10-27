import {
  createPortalBffHandlers,
  portalBffExample,
  portalBffExamples,
} from '@aiwcorpo/mcp-contracts/msw';
import { http, HttpResponse, type HttpHandler } from 'msw';
import type {
  CatalogAction,
  CatalogStatus,
  Connection,
  PortalCatalog,
  PortalCatalogServer,
  PutSecretRequest,
  SystemId,
} from '../app/api/generated';

/**
 * Stateful layer over the contract MSW handlers (@aiwcorpo/mcp-contracts). Every response body comes
 * from the C12 examples; the layer only tracks what the contract mock cannot: whether the session and
 * a fresh MFA exist, and which connections were added or removed. Requests it does not handle fall
 * through to the contract handlers, which also enforce the CSRF rule.
 */

export type MockScenario = 'default' | 'empty' | 'errors';

export interface MockState {
  session: boolean;
  mfaFresh: boolean;
  scenario: MockScenario;
  connections: Connection[];
  pendingOAuth: { system: SystemId; returnPath: string } | null;
}

/** Systems for which the mock offers OAuth, as in the contract example (GitLab). */
const OAUTH_SYSTEMS: readonly SystemId[] = ['gitlab'];

/** Mock identity in the target systems, the same user as the C12 `me` example. */
const MOCK_BACKEND_USER = 'jkowalski';

function exampleBody<T>(operationId: string, name: string): T {
  const operation = portalBffExamples.find((candidate) => candidate.operationId === operationId);
  const example = operation?.responses.find((response) => response.name === name);
  if (!example || example.body === undefined) {
    throw new Error(`no example ${operationId}/${name}`);
  }
  return structuredClone(example.body) as T;
}

export function initialMockState(): MockState {
  return {
    session: true,
    mfaFresh: false,
    scenario: 'default',
    connections: exampleBody<Connection[]>('listMyConnections', 'one'),
    pendingOAuth: null,
  };
}

export class MockStore {
  private current: MockState;

  constructor(
    initial: MockState = initialMockState(),
    private readonly persist: (state: MockState) => void = () => undefined,
  ) {
    this.current = initial;
  }

  get state(): Readonly<MockState> {
    return this.current;
  }

  update(change: Partial<MockState>): void {
    this.current = { ...this.current, ...change };
    this.persist(this.current);
  }

  reset(state: MockState = initialMockState()): void {
    this.current = state;
    this.persist(this.current);
  }
}

function catalogStatusFor(connection: Connection): CatalogStatus {
  if (connection.status === 'connected') {
    return 'connected';
  }
  return connection.status === 'expiring' ? 'expiring' : 'reconnect_required';
}

function actionsFor(status: CatalogStatus, system: SystemId): CatalogAction[] {
  switch (status) {
    case 'connected':
      return ['copy_link', 'disconnect'];
    case 'expiring':
      return ['copy_link', 'reconnect', 'disconnect'];
    case 'reconnect_required':
      return ['reconnect', 'disconnect'];
    default:
      return OAUTH_SYSTEMS.includes(system) ? ['connect_oauth', 'add_secret'] : ['add_secret'];
  }
}

/** Catalog example `mixed` with statuses recomputed from the mock connections (rule 4 and 5 of CC-021). */
export function mockCatalog(state: MockState): PortalCatalog {
  if (state.scenario === 'empty') {
    return { servers: [] };
  }
  const catalog = exampleBody<PortalCatalog>('getPortalCatalog', 'mixed');
  catalog.servers = catalog.servers.map((server): PortalCatalogServer => {
    if (server.status === 'request_pending' || server.status === 'no_access') {
      return server;
    }
    const connection = state.connections.find((candidate) => candidate.system === server.system);
    const status = connection ? catalogStatusFor(connection) : 'not_connected';
    const keepsRequest = server.actions.includes('request_access')
      ? (['request_access'] as const)
      : [];
    return { ...server, status, actions: [...actionsFor(status, server.system), ...keepsRequest] };
  });
  return catalog;
}

function csrfValid(request: Request, cookies: Record<string, string>): boolean {
  const header = request.headers.get('X-XSRF-TOKEN');
  return Boolean(header) && header === cookies['XSRF-TOKEN'];
}

const unavailable = () => HttpResponse.json({ error: 'upstream_unavailable' }, { status: 503 });

export function createMockHandlers(store: MockStore, baseUrl = ''): HttpHandler[] {
  const at = (path: string) => `${baseUrl}${path}`;
  const stateful: HttpHandler[] = [
    http.get(at('/api/v1/me'), () =>
      store.state.session ? undefined : portalBffExample('getMe', 'unauthenticated'),
    ),
    http.post(at('/api/v1/auth/logout'), ({ request, cookies }) => {
      if (!csrfValid(request, cookies)) {
        return undefined;
      }
      store.update({ session: false, mfaFresh: false });
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(at('/api/v1/catalog'), () => {
      if (!store.state.session) {
        return portalBffExample('getPortalCatalog', 'unauthenticated');
      }
      if (store.state.scenario === 'errors') {
        return unavailable();
      }
      return HttpResponse.json(mockCatalog(store.state));
    }),
    http.get(at('/api/v1/connections'), () => {
      if (!store.state.session) {
        return portalBffExample('listMyConnections', 'unauthenticated');
      }
      if (store.state.scenario === 'errors') {
        return unavailable();
      }
      return HttpResponse.json(store.state.scenario === 'empty' ? [] : store.state.connections);
    }),
    http.put(at('/api/v1/connections/:system/secret'), async ({ request, cookies, params }) => {
      if (!csrfValid(request, cookies)) {
        return undefined;
      }
      if (!store.state.mfaFresh) {
        return portalBffExample('putMySecret', 'step_up_required');
      }
      const body = (await request.json()) as PutSecretRequest;
      if (body.secret.startsWith('invalid')) {
        return portalBffExample('putMySecret', 'secret_invalid');
      }
      const system = params['system'] as SystemId;
      const connection: Connection = {
        system,
        type: 'user-secret',
        status: 'connected',
        backendUser: MOCK_BACKEND_USER,
        expiresAt: body.expiresAt ?? null,
        connectedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        lastUsedAt: null,
      };
      store.update({
        connections: [...store.state.connections.filter((c) => c.system !== system), connection],
      });
      return HttpResponse.json({
        status: connection.status,
        backendUser: connection.backendUser,
        expiresAt: connection.expiresAt,
      });
    }),
    http.delete(at('/api/v1/connections/:system'), ({ request, cookies, params }) => {
      if (!csrfValid(request, cookies)) {
        return undefined;
      }
      store.update({
        connections: store.state.connections.filter((c) => c.system !== params['system']),
      });
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(at('/api/v1/connections/:system/oauth'), async ({ request, cookies, params }) => {
      if (!csrfValid(request, cookies)) {
        return undefined;
      }
      const system = params['system'] as SystemId;
      const body = (await request.json().catch(() => ({}))) as { returnPath?: string };
      store.update({ pendingOAuth: { system, returnPath: body.returnPath ?? '/' } });
      const { authorizeUrl } = exampleBody<{ authorizeUrl: string }>('startConnectOAuth', 'gitlab');
      return HttpResponse.json({
        authorizeUrl: authorizeUrl.replace('gitlab.internal', `${system}.internal`),
      });
    }),
  ];
  return [...stateful, ...createPortalBffHandlers({ baseUrl })];
}

/** What the BFF and the IdP would do after a successful login: session, and fresh MFA on step-up. */
export function completeMockLogin(store: MockStore, stepUp: boolean): void {
  store.update({ session: true, mfaFresh: stepUp || store.state.mfaFresh });
}

/** What the BFF does in GET /api/v1/oauth/callback after the provider approves (CC-022). */
export function completeMockOAuth(store: MockStore): string {
  const pending = store.state.pendingOAuth;
  if (!pending) {
    return '/catalog?connectError=flow_invalid';
  }
  const connection: Connection = {
    system: pending.system,
    type: 'user-oauth',
    status: 'connected',
    backendUser: MOCK_BACKEND_USER,
    expiresAt: null,
    connectedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    lastUsedAt: null,
  };
  store.update({
    pendingOAuth: null,
    connections: [
      ...store.state.connections.filter((c) => c.system !== pending.system),
      connection,
    ],
  });
  const separator = pending.returnPath.includes('?') ? '&' : '?';
  return `${pending.returnPath}${separator}connected=${pending.system}`;
}
