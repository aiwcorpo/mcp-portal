import {
  createPortalBffHandlers,
  portalBffExample,
  portalBffExamples,
} from '@aiwcorpo/mcp-contracts/msw';
import { http, HttpResponse, type HttpHandler } from 'msw';
import type {
  CatalogAction,
  CatalogCredential,
  CatalogStatus,
  CatalogTool,
  ClientConfigs,
  Connection,
  PortalCatalog,
  PortalCatalogServer,
  PortalVirtualServer,
  PutSecretRequest,
  SystemId,
  VirtualServerCreate,
} from '../app/api/generated';

/**
 * Stateful layer over the contract MSW handlers (@aiwcorpo/mcp-contracts 2.2.3). Response bodies come
 * from the C12 examples (catalog `states` or `mixed`); the layer tracks what the contract mock cannot:
 * the session, the connections the user adds or removes, access requests and virtual servers. Requests
 * it does not handle fall through to the contract handlers, which also enforce the CSRF rule.
 */

export type MockScenario = 'default' | 'mixed' | 'empty' | 'nolinks' | 'errors';
export type MockOAuthOutcome = 'ok' | 'cancelled' | 'flow_invalid' | 'provider_error';

/** A connection the user changed in the mock; `null` stands for "disconnected". */
export interface MockConnection {
  type: Connection['type'];
  status: Connection['status'];
  expiresAt: string | null;
}

export interface MockLink {
  slug: string;
  displayName: string;
  tools: string[];
}

export interface MockState {
  session: boolean;
  scenario: MockScenario;
  oauthOutcome: MockOAuthOutcome;
  /** Per system; absent means "as in the scenario's example". */
  connections: Partial<Record<SystemId, MockConnection | null>>;
  requested: SystemId[];
  /** Links created or deleted in the mock; absent means the scenario's seed. */
  links: MockLink[] | null;
  pendingOAuth: { system: SystemId; returnPath: string } | null;
}

/** Mock identity in the target systems, the same user as the C12 `me` example. */
const MOCK_BACKEND_USER = 'jkowalski';
const MOCK_REQUEST_ID = '0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e7f';
const PUBLIC_BASE = 'https://mcp.aiwcorpo.pl';
/** A slug owned by somebody else (the C12 example), so that a 409 can be shown. */
export const FOREIGN_SLUG = 'team-a-dev';

/** Default per-user limit of the gateway (CC-119); the real one is gateway configuration. */
export const LINK_LIMIT = 50;
const DAY_MS = 86_400_000;
const EXPIRING_WITHIN_DAYS = 7;

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
    scenario: 'default',
    oauthOutcome: 'ok',
    connections: {},
    requested: [],
    links: null,
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

function tool(
  system: string,
  name: string,
  title: string,
  extra: Partial<CatalogTool> & { entitlement: string },
): CatalogTool {
  const { entitlement, ...rest } = extra;
  return {
    name: `${system}__${name}`,
    title,
    description: title,
    risk: 'READ_ONLY',
    action: 'read',
    access: 'granted',
    requiredEntitlements: [entitlement],
    ...rest,
  };
}

const iso = (time: number): string => new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Catalog example `states` (every row state and credential kind) with a few more tools, so that the
 * tool list and the link wizard look like the mockups; dates are relative to now so that "expires in
 * 5 days" stays true.
 */
function baseCatalog(scenario: MockScenario, now: number): PortalCatalogServer[] {
  const source = scenario === 'mixed' ? 'mixed' : 'states';
  const servers = exampleBody<PortalCatalog>('getPortalCatalog', source).servers;
  for (const server of servers) {
    server.credential ??= defaultCredential(server.system);
    server.connection ??= null;
    if (server.connection?.status === 'expiring') {
      server.connection.expiresAt = iso(now + 5 * DAY_MS);
    }
  }
  if (scenario === 'mixed') {
    return servers;
  }
  const jira = servers.find((server) => server.system === 'jira');
  if (jira) {
    jira.tools = [
      tool('jira', 'search_issues', 'Wyszukiwanie zgłoszeń (JQL)', {
        entitlement: 'mcp-jira-read',
      }),
      jira.tools[0],
      tool('jira', 'create_issue', 'Tworzenie zgłoszenia', {
        entitlement: 'mcp-jira-write',
        risk: 'UPDATE',
        action: 'update',
      }),
      tool('jira', 'add_comment', 'Dodanie komentarza', {
        entitlement: 'mcp-jira-write',
        risk: 'UPDATE',
        action: 'update',
      }),
      tool('jira', 'delete_issue', 'Usunięcie zgłoszenia', {
        entitlement: 'mcp-jira-destructive',
        risk: 'DESTRUCTIVE',
        action: 'delete',
        requiresConfirmation: true,
      }),
    ];
  }
  const gitlab = servers.find((server) => server.system === 'gitlab');
  if (gitlab) {
    gitlab.tools = [
      tool('gitlab', 'list_merge_requests', 'Lista merge requestów', {
        entitlement: 'mcp-gitlab-read',
      }),
      ...gitlab.tools,
    ];
  }
  return servers;
}

function defaultCredential(system: SystemId): CatalogCredential {
  return system === 'servicedesk'
    ? { supportedTypes: ['service-account'], defaultType: 'service-account' }
    : { supportedTypes: ['user-oauth', 'user-secret'], defaultType: 'user-oauth' };
}

function connectionOf(
  system: SystemId,
  mock: MockConnection,
  base: Connection | null | undefined,
  now: number,
): Connection {
  return {
    system,
    type: mock.type,
    status: mock.status,
    backendUser: base?.backendUser ?? MOCK_BACKEND_USER,
    expiresAt: mock.expiresAt,
    connectedAt: base?.connectedAt ?? iso(now),
    lastUsedAt: base?.lastUsedAt ?? null,
  };
}

/** The status and action table of C12 `getPortalCatalog` (CC-021, CC-083). */
export function deriveRow(
  server: PortalCatalogServer,
  connection: Connection | null,
  requestPending: boolean,
): { status: CatalogStatus; actions: CatalogAction[] } {
  const granted = server.tools.some((candidate) => candidate.access === 'granted');
  const someDenied = server.tools.some((candidate) => candidate.access === 'denied');
  if (!granted) {
    return requestPending
      ? { status: 'request_pending', actions: ['view_request'] }
      : { status: 'no_access', actions: ['request_access'] };
  }
  const credential = server.credential;
  const nothingToConnect =
    credential?.defaultType === 'service-account' || credential?.defaultType === 'token-exchange';
  const extra: CatalogAction[] = someDenied ? ['request_access'] : [];
  if (nothingToConnect) {
    return { status: 'connected', actions: ['copy_link', ...extra] };
  }
  if (!connection) {
    const types = credential?.supportedTypes ?? [];
    const actions: CatalogAction[] = [];
    if (types.includes('user-oauth')) {
      actions.push('connect_oauth');
    }
    if (types.includes('user-secret')) {
      actions.push('add_secret');
    }
    return { status: 'not_connected', actions };
  }
  const renew: CatalogAction = connection.type === 'user-oauth' ? 'reconnect' : 'add_secret';
  switch (connection.status) {
    case 'connected':
      return { status: 'connected', actions: ['copy_link', 'disconnect', ...extra] };
    case 'expiring':
      return { status: 'expiring', actions: ['copy_link', renew, 'disconnect'] };
    default:
      return { status: 'reconnect_required', actions: [renew, 'disconnect'] };
  }
}

export function mockCatalog(state: MockState, now: number = Date.now()): PortalCatalog {
  if (state.scenario === 'empty') {
    return { servers: [] };
  }
  const servers = baseCatalog(state.scenario, now).map((server): PortalCatalogServer => {
    const override = state.connections[server.system];
    const connection =
      override === undefined
        ? (server.connection ?? null)
        : override && connectionOf(server.system, override, server.connection, now);
    const row = deriveRow(server, connection, state.requested.includes(server.system));
    return { ...server, connection, ...row };
  });
  return { servers };
}

export function mockLinks(state: MockState): MockLink[] {
  if (state.links) {
    return state.links;
  }
  if (state.scenario === 'empty' || state.scenario === 'nolinks') {
    return [];
  }
  return [
    {
      slug: 'przeglad-zgloszen',
      displayName: 'Przegląd zgłoszeń',
      tools: ['jira__search_issues', 'jira__get_issue', 'jira__add_comment', 'jira__delete_issue'],
    },
    {
      slug: 'podglad-serwisowy',
      displayName: 'Podgląd zgłoszeń serwisowych',
      tools: ['servicedesk__get_ticket'],
    },
  ];
}

export function clientConfigsFor(slug: string): ClientConfigs {
  const url = `${PUBLIC_BASE}/v/${slug}/mcp`;
  return {
    // Same shape as the dev BFF (client id and port of the dev Keycloak); the UI shows it as received.
    claudeCode: `claude mcp add --transport http --client-id claude-code --callback-port 33418 ${slug} ${url}`,
    copilot: JSON.stringify({ servers: { [slug]: { type: 'http', url } } }),
    codex: `[mcp_servers.${slug}]\nurl = "${url}"\n`,
  };
}

function toPortalLink(link: MockLink): PortalVirtualServer {
  return {
    slug: link.slug,
    displayName: link.displayName,
    tools: link.tools,
    url: `${PUBLIC_BASE}/v/${link.slug}/mcp`,
    clientConfigs: clientConfigsFor(link.slug),
  };
}

function csrfValid(request: Request, cookies: Record<string, string>): boolean {
  const header = request.headers.get('X-XSRF-TOKEN');
  return Boolean(header) && header === cookies['__Host-XSRF-TOKEN'];
}

function failure(error: string, status: number): Response {
  return HttpResponse.json(
    { error, requestId: MOCK_REQUEST_ID },
    { status, headers: { 'X-Request-Id': MOCK_REQUEST_ID } },
  );
}

const unavailable = () => failure('upstream_unavailable', 503);

export function createMockHandlers(store: MockStore, baseUrl = ''): HttpHandler[] {
  const at = (path: string) => `${baseUrl}${path}`;
  const guarded = (handler: () => Response | Promise<Response> | undefined) => () =>
    store.state.session ? handler() : portalBffExample('getMe', 'unauthenticated');

  const stateful: HttpHandler[] = [
    http.get(at('/api/v1/me'), () =>
      store.state.session ? undefined : portalBffExample('getMe', 'unauthenticated'),
    ),
    http.post(at('/api/v1/auth/logout'), ({ request, cookies }) => {
      if (!csrfValid(request, cookies)) {
        return undefined;
      }
      store.update({ session: false });
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(
      at('/api/v1/catalog'),
      guarded(() =>
        store.state.scenario === 'errors'
          ? unavailable()
          : HttpResponse.json(mockCatalog(store.state), {
              headers: { 'X-Request-Id': MOCK_REQUEST_ID },
            }),
      ),
    ),
    http.put(at('/api/v1/connections/:system/secret'), async ({ request, cookies, params }) => {
      if (!csrfValid(request, cookies)) {
        return undefined;
      }
      if (!store.state.session) {
        return portalBffExample('putMySecret', 'unauthenticated');
      }
      const body = (await request.json()) as PutSecretRequest;
      if (body.secret.startsWith('invalid')) {
        return portalBffExample('putMySecret', 'secret_invalid');
      }
      const system = params['system'] as SystemId;
      const expiresAt = body.expiresAt ?? null;
      const soon =
        expiresAt !== null && Date.parse(expiresAt) - Date.now() < EXPIRING_WITHIN_DAYS * DAY_MS;
      const status: Connection['status'] = soon ? 'expiring' : 'connected';
      store.update({
        connections: {
          ...store.state.connections,
          [system]: { type: 'user-secret', status, expiresAt },
        },
      });
      return HttpResponse.json(
        { status, backendUser: MOCK_BACKEND_USER, expiresAt },
        { headers: { 'X-Request-Id': MOCK_REQUEST_ID } },
      );
    }),
    http.delete(at('/api/v1/connections/:system'), ({ request, cookies, params }) => {
      if (!csrfValid(request, cookies)) {
        return undefined;
      }
      store.update({
        connections: { ...store.state.connections, [params['system'] as SystemId]: null },
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
      return HttpResponse.json(
        { authorizeUrl: authorizeUrl.replace('gitlab.internal', `${system}.internal`) },
        { headers: { 'X-Request-Id': MOCK_REQUEST_ID } },
      );
    }),
    http.post(at('/api/v1/access-requests'), async ({ request, cookies }) => {
      if (!csrfValid(request, cookies)) {
        return undefined;
      }
      const { entitlement } = (await request.json()) as { entitlement: string };
      const owner = mockCatalog(store.state).servers.find((server) =>
        server.tools.some((candidate) => candidate.requiredEntitlements.includes(entitlement)),
      );
      if (owner && !store.state.requested.includes(owner.system)) {
        store.update({ requested: [...store.state.requested, owner.system] });
      }
      return portalBffExample('createAccessRequest', 'created');
    }),
    http.get(
      at('/api/v1/virtual-servers'),
      guarded(() =>
        store.state.scenario === 'errors'
          ? unavailable()
          : HttpResponse.json(mockLinks(store.state).map(toPortalLink), {
              headers: { 'X-Request-Id': MOCK_REQUEST_ID },
            }),
      ),
    ),
    http.post(at('/api/v1/virtual-servers'), async ({ request, cookies }) => {
      if (!csrfValid(request, cookies)) {
        return undefined;
      }
      if (!store.state.session) {
        return portalBffExample('createMyVirtualServer', 'unauthenticated');
      }
      const body = (await request.json()) as VirtualServerCreate;
      const defaults = body.resourceDefaults;
      if (defaults !== undefined && defaults !== null && Object.keys(defaults).length > 0) {
        return failure('resource_defaults_unsupported', 400);
      }
      const links = mockLinks(store.state);
      if (body.slug === FOREIGN_SLUG || links.some((link) => link.slug === body.slug)) {
        return failure('slug_taken', 409);
      }
      if (links.length >= LINK_LIMIT) {
        return failure('virtual_server_limit_reached', 409);
      }
      const usable = new Set(
        mockCatalog(store.state)
          .servers.flatMap((server) => server.tools)
          .filter((candidate) => candidate.access === 'granted' && !candidate.disabled)
          .map((candidate) => candidate.name),
      );
      if (!body.tools.length || body.tools.some((name) => !usable.has(name))) {
        return failure('access_denied', 403);
      }
      store.update({
        links: [...links, { slug: body.slug, displayName: body.displayName, tools: body.tools }],
      });
      return HttpResponse.json(
        {
          slug: body.slug,
          url: `${PUBLIC_BASE}/v/${body.slug}/mcp`,
          clientConfigs: clientConfigsFor(body.slug),
        },
        { status: 201, headers: { 'X-Request-Id': MOCK_REQUEST_ID } },
      );
    }),
    http.delete(at('/api/v1/virtual-servers/:slug'), ({ request, cookies, params }) => {
      if (!csrfValid(request, cookies)) {
        return undefined;
      }
      const links = mockLinks(store.state);
      if (!links.some((link) => link.slug === params['slug'])) {
        return failure('not_found_or_denied', 404);
      }
      store.update({ links: links.filter((link) => link.slug !== params['slug']) });
      return new HttpResponse(null, { status: 204 });
    }),
  ];
  return [...stateful, ...createPortalBffHandlers({ baseUrl })];
}

/** What the BFF and the IdP would do after a successful login. */
export function completeMockLogin(store: MockStore): void {
  store.update({ session: true });
}

/**
 * What the BFF does in GET /api/v1/oauth/callback (CC-022, CC-086): the connection on success, or
 * `connectError` with a code from the closed list, appended to the return path.
 */
export function completeMockOAuth(store: MockStore): string {
  const pending = store.state.pendingOAuth;
  if (!pending) {
    // The BFF sends an unknown or used flow to the root, whatever the page the user started from (C12).
    return '/?connectError=flow_invalid';
  }
  const separator = pending.returnPath.includes('?') ? '&' : '?';
  const outcome = store.state.oauthOutcome;
  store.update({
    pendingOAuth: null,
    ...(outcome === 'ok'
      ? {
          connections: {
            ...store.state.connections,
            [pending.system]: { type: 'user-oauth', status: 'connected', expiresAt: null },
          },
        }
      : {}),
  });
  return outcome === 'ok'
    ? `${pending.returnPath}${separator}connected=${pending.system}`
    : `${pending.returnPath}${separator}connectError=${outcome}`;
}
