import {
  MOCK_XSRF_TOKEN,
  XSRF_COOKIE,
  createPortalBffHandlers,
  portalBffExample,
  portalBffExamples,
} from '@aiwcorpo/mcp-contracts/msw';
import { http, HttpResponse, type HttpHandler } from 'msw';
import { AdminState, createAdminHandlers, initialAdminState } from './admin-mock';
import { createDynamicAdminHandlers } from './dynamic-mock';
import { mcpEndpointAnswer } from './endpoint-mock';
import { M3State, createM3Handlers, initialM3State } from './m3-mock';
import type {
  AccessRequest,
  AccessRequestStatus,
  CatalogAction,
  CatalogCredential,
  CatalogStatus,
  CatalogTool,
  Connection,
  KillSwitch,
  PortalCatalog,
  PortalCatalogServer,
  PutSecretRequest,
  RequestableEntitlement,
} from '../app/api/generated';

/**
 * Stateful layer over the contract MSW handlers (@aiwcorpo/mcp-contracts 3.0.1). Response bodies come
 * from the C12 examples (catalog `states` or `mixed`); the layer tracks what the contract mock cannot:
 * the session, the connections the user adds or removes, access requests. Requests
 * it does not handle fall through to the contract handlers, which also enforce the CSRF rule.
 */

export type MockScenario = 'default' | 'mixed' | 'empty' | 'errors' | 'wide';
/**
 * What the IGA adapter does with a request (C13): `direct` creates it and answers with the id, `redirect`
 * answers with the URL of its own form, `groups` is the Keycloak adapter without a request flow (422) and
 * `down` is an IGA that does not answer (503).
 */
export type MockIga = 'direct' | 'redirect' | 'groups' | 'down';
export type MockOAuthOutcome = 'ok' | 'cancelled' | 'flow_invalid' | 'provider_error';

/** A connection the user changed in the mock; `null` stands for "disconnected". */
export interface MockConnection {
  type: Connection['type'];
  status: Connection['status'];
  expiresAt: string | null;
  /** False for a secret stored in a system that has no whoami (generic-rest without `whoami`): no backend user. */
  verified?: boolean;
}

export interface MockRequest {
  requestId: string;
  entitlement: string;
  status: AccessRequestStatus;
  createdAt: string;
  decidedAt?: string;
}

export interface MockState extends M3State, AdminState {
  session: boolean;
  scenario: MockScenario;
  oauthOutcome: MockOAuthOutcome;
  /** Per system; absent means "as in the scenario's example". */
  connections: Partial<Record<string, MockConnection | null>>;
  /** Requests of the user; null means the scenario's seed. */
  requests: MockRequest[] | null;
  iga: MockIga;
  /** Jira asks for a login next to the token (userSecretScheme Basic, CC-222). */
  basicLogin: boolean;
  /** A generic-rest system `notes` with user-secret and no whoami is in the catalog (CC-247). */
  unverified: boolean;
  pendingOAuth: { system: string; returnPath: string } | null;
}

/** Mock identity in the target systems, the same user as the C12 `me` example. */
const MOCK_BACKEND_USER = 'jkowalski';
const MOCK_REQUEST_ID = '0192d1b2-7c3a-7d4e-8f10-2a3b4c5d6e7f';
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
    requests: null,
    iga: 'direct',
    basicLogin: false,
    unverified: false,
    pendingOAuth: null,
    ...initialM3State(),
    ...initialAdminState(),
  };
}

export class MockStore {
  private current: MockState;
  /** Called by `reset`, for mock data that is not part of the state in the cookie (the administration registry). */
  readonly onReset: (() => void)[] = [];

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
    this.onReset.forEach((hook) => hook());
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
function baseCatalog(
  scenario: MockScenario,
  now: number,
  basicLogin = false,
  unverified = false,
): PortalCatalogServer[] {
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
  if (unverified) {
    // A system added from the template with user secrets and no whoami: the broker stores the token without a check.
    servers.push({
      serverId: 'mcp-notes',
      system: 'notes',
      version: '0.1.0',
      url: 'https://localhost/s/mcp-notes/mcp',
      status: 'not_connected',
      actions: ['add_secret'],
      credential: {
        supportedTypes: ['user-secret'],
        defaultType: 'user-secret',
        displayName: 'Team notes',
        userSecretVerified: false,
      },
      connection: null,
      tools: [tool('notes', 'list_notes', 'List notes', { entitlement: 'mcp-notes-read' })],
    });
  }
  if (jira && basicLogin) {
    // Jira Data Center: the login of the account and a password or token (CC-222).
    jira.credential = {
      supportedTypes: ['user-secret'],
      defaultType: 'user-secret',
      userSecretScheme: 'Basic',
      deployment: 'dc',
    };
  }
  if (jira) {
    jira.tools = [
      tool('jira', 'search_issues', 'Search issues', {
        entitlement: 'mcp-jira-read',
      }),
      jira.tools[0],
      tool('jira', 'create_issue', 'Create issue', {
        entitlement: 'mcp-jira-write',
        risk: 'UPDATE',
        action: 'update',
      }),
      tool('jira', 'add_comment', 'Add comment', {
        entitlement: 'mcp-jira-write',
        risk: 'UPDATE',
        action: 'update',
      }),
      tool('jira', 'delete_issue', 'Delete issue', {
        entitlement: 'mcp-jira-destructive',
        risk: 'DESTRUCTIVE',
        action: 'delete',
        requiresConfirmation: true,
      }),
    ];
  }
  if (scenario === 'wide' && jira) {
    // Enough long names to pass the default size warning and to reach 512 bytes with sixteen of them.
    jira.tools.push(
      ...Array.from({ length: 45 }, (_, index) =>
        tool(
          'jira',
          `report_number_${String(index).padStart(2, '0')}_for_quarter`,
          `Report ${index + 1}`,
          {
            entitlement: 'mcp-jira-read',
          },
        ),
      ),
    );
  }
  const gitlab = servers.find((server) => server.system === 'gitlab');
  if (gitlab) {
    gitlab.tools = [
      tool('gitlab', 'list_merge_requests', 'List merge requests', {
        entitlement: 'mcp-gitlab-read',
      }),
      ...gitlab.tools,
    ];
  }
  return servers;
}

function defaultCredential(system: string): CatalogCredential {
  if (system === 'servicedesk') {
    return { supportedTypes: ['service-account'], defaultType: 'service-account' };
  }
  if (system === 'opensearch') {
    return { supportedTypes: ['token-exchange'], defaultType: 'token-exchange' };
  }
  return { supportedTypes: ['user-oauth', 'user-secret'], defaultType: 'user-oauth' };
}

function connectionOf(
  system: string,
  mock: MockConnection,
  base: Connection | null | undefined,
  now: number,
): Connection {
  return {
    system,
    type: mock.type,
    status: mock.status,
    backendUser: mock.verified === false ? null : (base?.backendUser ?? MOCK_BACKEND_USER),
    verified: mock.verified ?? base?.verified ?? true,
    expiresAt: mock.expiresAt,
    connectedAt: base?.connectedAt ?? iso(now),
    lastUsedAt: base?.lastUsedAt ?? null,
  };
}

/** A tool or server that an emergency switch turned off is `disabled` with `disabledBy: kill_switch` (CC-194). */
function withKillSwitches(
  server: PortalCatalogServer,
  switches: readonly KillSwitch[],
): CatalogTool[] {
  return server.tools.map((candidate) => {
    const off = switches.some(
      (entry) =>
        entry.serverId === server.serverId &&
        (entry.scope === 'server' || `${server.system}__${entry.tool}` === candidate.name),
    );
    return off ? { ...candidate, disabled: true, disabledBy: 'kill_switch' } : candidate;
  });
}

/** The status and action table of C12 `getPortalCatalog` (CC-021, CC-083, CC-113). */
export function deriveRow(
  server: PortalCatalogServer,
  connection: Connection | null,
  pendingEntitlements: ReadonlySet<string>,
): { status: CatalogStatus; actions: CatalogAction[] } {
  const granted = server.tools.some((candidate) => candidate.access === 'granted');
  const someDenied = server.tools.some((candidate) => candidate.access === 'denied');
  // request_access needs entitlements to ask for; a pending request for one of them turns it into view_request.
  const askable = server.tools.filter(
    (candidate) => candidate.access === 'denied' && candidate.requiredEntitlements.length > 0,
  );
  const requestPending = askable.some((candidate) =>
    candidate.requiredEntitlements.some((entitlement) => pendingEntitlements.has(entitlement)),
  );
  const requestAction: CatalogAction[] = askable.length
    ? [requestPending ? 'view_request' : 'request_access']
    : [];
  if (!granted) {
    return requestPending
      ? { status: 'request_pending', actions: ['view_request'] }
      : { status: 'no_access', actions: requestAction };
  }
  const credential = server.credential;
  const nothingToConnect =
    credential?.defaultType === 'service-account' || credential?.defaultType === 'token-exchange';
  const extra: CatalogAction[] = someDenied ? requestAction : [];
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
  const pending = new Set(
    mockRequests(state, now)
      .filter((request) => request.status === 'pending')
      .map((request) => request.entitlement),
  );
  const servers = baseCatalog(state.scenario, now, state.basicLogin, state.unverified).map(
    (server): PortalCatalogServer => {
      const override = state.connections[server.system];
      const connection =
        override === undefined
          ? (server.connection ?? null)
          : override && connectionOf(server.system, override, server.connection, now);
      const row = deriveRow(server, connection, pending);
      return { ...server, connection, ...row, tools: withKillSwitches(server, state.killSwitches) };
    },
  );
  return { servers };
}

const IGA_BASE = 'https://iga.internal';

/** Requests the user has in the IGA: a seed per scenario, then what the mock creates. */
export function mockRequests(state: Readonly<MockState>, now: number = Date.now()): MockRequest[] {
  if (state.requests) {
    return state.requests;
  }
  if (state.scenario === 'empty') {
    return [];
  }
  const days = (count: number) => iso(now - count * DAY_MS);
  const seed: MockRequest[] = [
    {
      requestId: 'REQ-2026-0040',
      entitlement: 'mcp-jira-write',
      status: 'approved',
      createdAt: days(9),
      decidedAt: days(8),
    },
    {
      requestId: 'REQ-2026-0038',
      entitlement: 'mcp-gitlab-write',
      status: 'rejected',
      createdAt: days(17),
      decidedAt: days(16),
    },
    {
      requestId: 'REQ-2026-0031',
      entitlement: 'mcp-jira-write',
      status: 'cancelled',
      createdAt: days(27),
      decidedAt: days(27),
    },
  ];
  return state.scenario === 'mixed'
    ? [
        {
          requestId: 'REQ-2026-0042',
          entitlement: 'mcp-confluence-read',
          status: 'pending',
          createdAt: days(4),
        },
        ...seed,
      ]
    : seed;
}

function isSystem(value: string | null): value is string {
  return value !== null && /^[a-z][a-z0-9]{1,30}$/.test(value);
}

function toAccessRequest(request: MockRequest): AccessRequest {
  return {
    ...request,
    ...(request.status === 'pending'
      ? { requestUrl: `${IGA_BASE}/requests/${request.requestId}` }
      : {}),
  };
}

/**
 * What the IGA offers per system (C13 `catalog`); descriptions are the IGA's own text, so the mock answers in the language
 * of the page the way a real IGA would answer in its own. English matches dev/iga-mock.yaml of the BFF.
 */
const IGA_DESCRIPTIONS: Record<'en' | 'pl', Record<string, string>> = {
  en: {
    'mcp-jira-read': 'Read access to Jira issues and projects',
    'mcp-jira-write': 'Create and update Jira issues',
    'mcp-jira-destructive':
      'Grants irreversible Jira tools such as jira__delete_issue. Every use needs a code from the Authenticator.',
    'mcp-confluence-read': 'Read access to Confluence spaces',
    'mcp-gitlab-read': 'Read access to GitLab projects',
    'mcp-gitlab-write': 'Push and merge request access to GitLab projects',
    'mcp-servicedesk-read': 'Read access to Service Desk tickets',
    'mcp-opensearch-read': 'Search access to OpenSearch indexes',
  },
  pl: {
    'mcp-jira-read': 'Odczyt zgłoszeń w Jirze.',
    'mcp-jira-write': 'Tworzenie i zmiana zgłoszeń oraz komentarze w Jirze.',
    'mcp-jira-destructive':
      'Daje dostęp do narzędzi nieodwracalnych w Jirze, np. jira__delete_issue. Każde użycie wymaga kodu z Authenticatora.',
    'mcp-confluence-read': 'Odczyt stron Confluence.',
    'mcp-gitlab-read': 'Odczyt projektów i merge requestów.',
    'mcp-gitlab-write': 'Komentarze i zmiany w merge requestach.',
    'mcp-servicedesk-read': 'Odczyt zgłoszeń serwisowych.',
    'mcp-opensearch-read': 'Odczyt logów w OpenSearch.',
  },
};

/** The groups of a system follow the C9 convention `mcp-<system>-<level>`; the IGA of the mock offers all three for any system. */
const ENTITLEMENT_LEVELS = ['read', 'write', 'destructive'] as const;
const ENTITLEMENT = /^mcp-[a-z][a-z0-9]{1,30}-(?:read|write|destructive)$/;

function igaCatalog(system: string): RequestableEntitlement[] | undefined {
  const language =
    typeof document !== 'undefined' && document.documentElement.lang === 'pl' ? 'pl' : 'en';
  return ENTITLEMENT_LEVELS.map((level) => `mcp-${system}-${level}`).map((entitlement) => {
    const description = IGA_DESCRIPTIONS[language][entitlement];
    return description === undefined ? { entitlement } : { entitlement, description };
  });
}

function csrfValid(request: Request, cookies: Record<string, string>): boolean {
  const header = request.headers.get('X-XSRF-TOKEN');
  return Boolean(header) && header === cookies['__Host-XSRF-TOKEN'];
}

function failure(error: string, status: number, extra: Record<string, unknown> = {}): Response {
  return HttpResponse.json(
    { error, requestId: MOCK_REQUEST_ID, ...extra },
    { status, headers: { 'X-Request-Id': MOCK_REQUEST_ID } },
  );
}

const unavailable = () => failure('upstream_unavailable', 503);

export function createMockHandlers(store: MockStore, baseUrl = ''): HttpHandler[] {
  const at = (path: string) => `${baseUrl}${path}`;
  const guarded = (handler: () => Response | Promise<Response> | undefined) => () =>
    store.state.session ? handler() : portalBffExample('getMe', 'unauthenticated');

  const stateful: HttpHandler[] = [
    http.get(at('/api/v1/me'), async () => {
      if (!store.state.session) {
        return portalBffExample('getMe', 'unauthenticated');
      }
      if (!store.state.admin) {
        return undefined;
      }
      // The contract handler sets the CSRF cookie on GET /me; answering instead of it must do the same.
      const me = portalBffExample('getMe', 'admin');
      return HttpResponse.json(await me.json(), {
        headers: {
          'Set-Cookie': `${XSRF_COOKIE}=${MOCK_XSRF_TOKEN}; Path=/; Secure; SameSite=Strict`,
          'X-Request-Id': MOCK_REQUEST_ID,
        },
      });
    }),
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
      const system = params['system'] as string;
      // Basic needs the login and a single token must not carry one (CC-222): the broker answers 400 either way.
      const basic =
        baseCatalog(
          store.state.scenario,
          Date.now(),
          store.state.basicLogin,
          store.state.unverified,
        ).find((server) => server.system === system)?.credential?.userSecretScheme === 'Basic';
      if (basic !== (body.username !== undefined)) {
        return failure('invalid_request', 400);
      }
      const expiresAt = body.expiresAt ?? null;
      const soon =
        expiresAt !== null && Date.parse(expiresAt) - Date.now() < EXPIRING_WITHIN_DAYS * DAY_MS;
      const status: Connection['status'] = soon ? 'expiring' : 'connected';
      // A system without whoami stores the token as it is: no backend user, `verified` false (CC-247).
      const verified = !(store.state.unverified && system === 'notes');
      store.update({
        connections: {
          ...store.state.connections,
          [system]: { type: 'user-secret', status, expiresAt, verified },
        },
      });
      return HttpResponse.json(
        { status, backendUser: verified ? MOCK_BACKEND_USER : null, verified, expiresAt },
        { headers: { 'X-Request-Id': MOCK_REQUEST_ID } },
      );
    }),
    http.delete(at('/api/v1/connections/:system'), ({ request, cookies, params }) => {
      if (!csrfValid(request, cookies)) {
        return undefined;
      }
      store.update({
        connections: { ...store.state.connections, [params['system'] as string]: null },
      });
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(at('/api/v1/connections/:system/oauth'), async ({ request, cookies, params }) => {
      if (!csrfValid(request, cookies)) {
        return undefined;
      }
      const system = params['system'] as string;
      const body = (await request.json().catch(() => ({}))) as { returnPath?: string };
      store.update({ pendingOAuth: { system, returnPath: body.returnPath ?? '/' } });
      const { authorizeUrl } = exampleBody<{ authorizeUrl: string }>('startConnectOAuth', 'gitlab');
      return HttpResponse.json(
        { authorizeUrl: authorizeUrl.replace('gitlab.internal', `${system}.internal`) },
        { headers: { 'X-Request-Id': MOCK_REQUEST_ID } },
      );
    }),
    http.get(
      at('/api/v1/access-requests'),
      guarded(() =>
        store.state.iga === 'down' || store.state.scenario === 'errors'
          ? unavailable()
          : HttpResponse.json(mockRequests(store.state).map(toAccessRequest), {
              headers: { 'X-Request-Id': MOCK_REQUEST_ID },
            }),
      ),
    ),
    http.get(at('/api/v1/access-requests/entitlements'), ({ request }) => {
      if (!store.state.session) {
        return portalBffExample('getMe', 'unauthenticated');
      }
      const system = new URL(request.url).searchParams.get('system');
      if (!isSystem(system)) {
        return failure('invalid_request', 400);
      }
      if (store.state.iga === 'down') {
        return unavailable();
      }
      if (store.state.iga === 'groups') {
        return failure('not_requestable', 422);
      }
      const offered = igaCatalog(system) ?? [];
      return HttpResponse.json(offered, { headers: { 'X-Request-Id': MOCK_REQUEST_ID } });
    }),
    http.post(at('/api/v1/access-requests'), async ({ request, cookies }) => {
      if (!csrfValid(request, cookies)) {
        return undefined;
      }
      if (!store.state.session) {
        return portalBffExample('createAccessRequest', 'unauthenticated');
      }
      const { entitlement } = (await request.json()) as { entitlement: string };
      const iga = store.state.iga;
      if (iga === 'down') {
        return unavailable();
      }
      const known = ENTITLEMENT.test(entitlement);
      if (iga === 'groups' || !known) {
        return failure('not_requestable', 422);
      }
      const requests = mockRequests(store.state);
      const existing = requests.find(
        (candidate) => candidate.entitlement === entitlement && candidate.status === 'pending',
      );
      if (existing) {
        return HttpResponse.json(
          { requestId: existing.requestId },
          { headers: { 'X-Request-Id': MOCK_REQUEST_ID } },
        );
      }
      const created: MockRequest = {
        requestId: `REQ-2026-${String(43 + requests.length).padStart(4, '0')}`,
        entitlement,
        status: 'pending',
        createdAt: iso(Date.now()),
      };
      store.update({ requests: [created, ...requests] });
      return HttpResponse.json(
        iga === 'redirect'
          ? { requestUrl: `${IGA_BASE}/catalog/request?entitlement=${entitlement}` }
          : { requestId: created.requestId },
        { headers: { 'X-Request-Id': MOCK_REQUEST_ID } },
      );
    }),
    http.get(at('/api/v1/me/mcp-endpoint'), ({ request }) => {
      if (!store.state.session) {
        return portalBffExample('getMcpEndpoint', 'unauthenticated');
      }
      if (store.state.scenario === 'errors') {
        return unavailable();
      }
      const answer = mcpEndpointAnswer(
        new URL(request.url).searchParams,
        mockCatalog(store.state).servers.flatMap((server) => server.tools),
      );
      return HttpResponse.json(answer.body, {
        status: answer.status,
        headers: { 'X-Request-Id': MOCK_REQUEST_ID },
      });
    }),
  ];
  const m3 = createM3Handlers(store, {
    at,
    csrfValid,
    failure,
    unauthenticated: () =>
      store.state.session ? undefined : portalBffExample('getMe', 'unauthenticated'),
    requestId: MOCK_REQUEST_ID,
  });
  const adminHandlers = createAdminHandlers(store, {
    at,
    csrfValid,
    failure,
    unauthenticated: () =>
      store.state.session ? undefined : portalBffExample('getMe', 'unauthenticated'),
    requestId: MOCK_REQUEST_ID,
  });
  const dynamicHandlers = createDynamicAdminHandlers(store, {
    at,
    csrfValid,
    failure,
    unauthenticated: () =>
      store.state.session ? undefined : portalBffExample('getMe', 'unauthenticated'),
    requestId: MOCK_REQUEST_ID,
  });
  return [
    ...stateful,
    ...m3,
    ...adminHandlers,
    ...dynamicHandlers,
    ...createPortalBffHandlers({ baseUrl }),
  ];
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
    : `${pending.returnPath}${separator}connectError=${outcome}&system=${pending.system}`;
}
