import { http, HttpResponse, type HttpHandler, type JsonBodyType } from 'msw';
import type {
  Override,
  PendingPolicies,
  ResourceTypeDeclaration,
  ScopeMappingEntry,
  ServerConfig,
  SystemAdminView,
} from '../app/api/generated';
import type { MockContext } from './m3-mock';
import type { MockStore } from './portal-mock';

/**
 * Mock layer of the 7.0.0 administration (CC-234, CC-235, CC-238, CC-239, CC-240): servers, systems, scope mapping,
 * overrides and the approval of policies. It knows no list of systems: every row is data that the mock starts with and the
 * administrator changes, as the gateway and the broker would keep it. The data lives in this module and in
 * sessionStorage (not in the cookie of the mock state, which has 4 KB), and `MockStore.reset` puts the seed back.
 */

export const RESERVED_SYSTEMS = [
  'gateway',
  'offboarding',
  'portal',
  'broker',
  'prometheus',
  'platform',
  'admin',
  'registry',
  'adapter',
  'internal',
  'ci',
];

const STORAGE_KEY = 'mcp-portal-mock-registry';
const MOCK_ADMIN_SUB = '3c1d6b7e-5a43-4f49-9d4f-0a7b1a1f2c11';

interface Versioned<T> {
  value: T;
  version: number;
}

interface Data {
  servers: Versioned<ServerConfig>[];
  systems: Versioned<SystemAdminView>[];
  mapping: Versioned<ScopeMappingEntry[]>;
  overrides: Versioned<Override>[];
}

function seedServer(
  serverId: string,
  system: string,
  extra: Partial<ServerConfig> = {},
): ServerConfig {
  return {
    serverId,
    system,
    internalUrl: `https://${serverId}.internal:8443/mcp`,
    credential: {
      required: true,
      acceptedTypes: ['user-oauth', 'user-secret'],
      type: 'user-oauth',
    },
    enabled: true,
    adapter: false,
    ...extra,
  };
}

function seedData(): Data {
  const oauth = (system: string, clientId: string) => ({
    clientId,
    authorizeUrl: `https://${system}.internal/oauth/authorize`,
    tokenUrl: `https://${system}.internal/oauth/token`,
    scopes: [`${system}.read`, `${system}.write`],
    clientSecretSet: true,
  });
  return {
    servers: [
      seedServer('mcp-confluence', 'confluence'),
      seedServer('mcp-jira', 'jira'),
      seedServer('mcp-gitlab', 'gitlab'),
      seedServer('mcp-servicedesk', 'servicedesk', {
        credential: { required: true, acceptedTypes: ['service-account'], type: 'service-account' },
      }),
      seedServer('mcp-opensearch', 'opensearch', {
        credential: { required: true, acceptedTypes: ['token-exchange'], type: 'token-exchange' },
        enabled: false,
      }),
    ].map((value) => ({ value, version: 1 })),
    systems: (
      [
        {
          system: 'confluence',
          displayName: 'Confluence',
          baseUrl: 'https://confluence.internal',
          adapter: 'atlassian-dc',
          product: 'confluence',
          supportedTypes: ['user-oauth', 'user-secret'],
          defaultType: 'user-oauth',
          secretScheme: 'Bearer',
          oauth: oauth('confluence', 'mcp-broker-confluence'),
        },
        {
          system: 'jira',
          displayName: 'Jira',
          baseUrl: 'https://jira.internal',
          adapter: 'atlassian-dc',
          product: 'jira',
          supportedTypes: ['user-oauth', 'user-secret'],
          defaultType: 'user-oauth',
          secretScheme: 'Bearer',
          oauth: oauth('jira', 'mcp-broker-jira'),
        },
        {
          system: 'gitlab',
          displayName: 'GitLab',
          baseUrl: 'https://gitlab.internal',
          adapter: 'gitlab',
          supportedTypes: ['user-oauth', 'user-secret'],
          defaultType: 'user-oauth',
          secretScheme: 'Bearer',
          oauth: oauth('gitlab', 'mcp-broker-gitlab'),
        },
        {
          system: 'servicedesk',
          displayName: 'Service Desk',
          baseUrl: 'https://servicedesk.internal/api',
          adapter: 'generic-rest',
          supportedTypes: ['service-account'],
          defaultType: 'service-account',
          secretScheme: 'Bearer',
        },
        {
          system: 'opensearch',
          displayName: 'OpenSearch',
          baseUrl: 'https://opensearch.internal',
          adapter: 'opensearch',
          supportedTypes: ['token-exchange'],
          defaultType: 'token-exchange',
          secretScheme: 'Bearer',
          exchangeAudience: 'opensearch',
          oauth: { clientId: 'mcp-broker-opensearch', scopes: ['search'], clientSecretSet: true },
        },
      ] satisfies SystemAdminView[]
    ).map((value) => ({ value, version: 1 })),
    mapping: {
      value: [
        { group: 'mcp-jira-proj-ABC', scopes: ['Jira::Project/ABC'] },
        {
          group: 'mcp-team-platform',
          scopes: ['Jira::Project/PLAT', 'Confluence::Space/PLATFORM'],
        },
      ],
      version: 1,
    },
    overrides: [
      {
        value: {
          id: 'override-block-drop-table',
          target: 'gateway',
          text: '@id("override-block-drop-table")\nforbid (principal, action == Action::"call", resource is Tool)\nwhen { resource.name == "drop_table" };',
          setBy: MOCK_ADMIN_SUB,
          setAt: '2026-11-06T09:30:00Z',
        },
        version: 1,
      },
    ],
  };
}

const registries = new WeakMap<MockStore, Data>();

function load(): Data {
  try {
    const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as Data;
    }
  } catch {
    // Storage blocked or damaged: start from the seed.
  }
  return seedData();
}

function save(data: Data): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // The data stays in memory for this page.
  }
}

export interface PolicyFixture {
  approved: PendingPolicies['approvedPolicies'];
  approvedTypes: ResourceTypeDeclaration[] | null;
  pending: PendingPolicies['pendingPolicies'];
  pendingTypes: ResourceTypeDeclaration[];
  hash: string;
  version: string;
  source: 'ci' | 'server';
}

const JIRA_SCHEMA = (extra: string) => `namespace Jira {
  entity Project { key: String, category: String, scopes: Set<ResourceScope> };
  entity Issue in [Project] { key: String, project: Project, scopes: Set<ResourceScope> };
  action "read", "update"${extra} appliesTo { principal: [User], resource: [Project, Issue], context: RequestContext };
}`;

const JIRA_READ = `@id("jira-read")
permit (principal in UserGroup::"mcp-jira-read", action == Jira::Action::"read", resource);
`;

/** The pending declarations narrow the scope pattern of a Jira project: approving them can invalidate mapping entries. */
const APPROVED_JIRA_SCOPE = '^[A-Z]{2,10}$';
const PENDING_JIRA_SCOPE = '^[A-Z]{2,3}$';

const JIRA_TYPES: ResourceTypeDeclaration[] = [
  {
    type: 'Jira::Project',
    attributes: ['key', 'category'],
    idPattern: '^[A-Z][A-Z0-9_]{1,9}$',
    scopePattern: PENDING_JIRA_SCOPE,
    earlyScopeCheck: true,
    classification: { attribute: 'category', kind: 'string', required: true },
  },
  {
    type: 'Jira::Issue',
    attributes: ['key'],
    parent: 'Jira::Project',
    parentAttribute: 'project',
    idPattern: '^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]{0,9}$',
  },
];

/** Not hashes of anything: values of the right shape that differ per fixture, as the other mock hashes do. */
const HASH_JIRA = 'sha256:12573bd466924c3e35d2a79ca0c6257f4c7663c9d188510593b08dd3867220f8';
const HASH_NOTES = 'sha256:7d0e3c1b5a9f4e2d8c6b1a0f3e5d7c9b2a4f6e8d0c1b3a5f7e9d2c4b6a8f0e1d';

/** The servers whose policies wait for approval when `?mockPolicies=in`: one changed (Jira), one new (Notes). */
export const POLICY_FIXTURES: Record<string, PolicyFixture> = {
  'mcp-jira': {
    approved: {
      namespace: 'Jira',
      schema: JIRA_SCHEMA(''),
      files: [{ name: 'read.cedar', text: JIRA_READ }],
    },
    approvedTypes: JIRA_TYPES.map((type) =>
      type.type === 'Jira::Project' ? { ...type, scopePattern: APPROVED_JIRA_SCOPE } : type,
    ),
    pending: {
      namespace: 'Jira',
      schema: JIRA_SCHEMA(', "delete"'),
      files: [
        {
          name: 'delete.cedar',
          text: '@id("jira-delete")\npermit (principal in UserGroup::"mcp-jira-destructive", action == Jira::Action::"delete", resource);\n',
        },
        { name: 'read.cedar', text: JIRA_READ },
      ],
    },
    pendingTypes: JIRA_TYPES,
    hash: HASH_JIRA,
    version: '1.4.0',
    source: 'ci',
  },
  'mcp-notes': {
    approved: null,
    approvedTypes: null,
    pending: {
      namespace: 'Notes',
      schema: `namespace Notes {
  entity Folder { name: String, scopes: Set<ResourceScope> };
  action "read" appliesTo { principal: [User], resource: [Folder], context: RequestContext };
}`,
      files: [
        {
          name: 'read.cedar',
          text: '@id("notes-read")\npermit (principal in UserGroup::"mcp-notes-read", action == Notes::Action::"read", resource);\n',
        },
      ],
    },
    pendingTypes: [
      {
        type: 'Notes::Folder',
        attributes: ['name'],
        idPattern: '^[a-z][a-z0-9-]{0,40}$',
        scopePattern: '^[a-z][a-z0-9-]{0,40}$',
      },
    ],
    hash: HASH_NOTES,
    version: '0.1.0',
    source: 'server',
  },
};

/** What the registered servers of the mock have declared and had approved before this scenario's pending policies. */
const BASE_APPROVED: Record<string, ResourceTypeDeclaration[]> = {
  'mcp-jira': POLICY_FIXTURES['mcp-jira'].approvedTypes ?? [],
  'mcp-confluence': [
    {
      type: 'Confluence::Space',
      attributes: ['key'],
      idPattern: '^[A-Z][A-Z0-9]{1,9}$',
      scopePattern: '^[A-Z][A-Z0-9]{1,9}$',
    },
  ],
  'mcp-gitlab': [
    {
      type: 'GitLab::Project',
      attributes: ['path'],
      idPattern: '^[a-z0-9][a-z0-9._/-]{0,200}$',
      scopePattern: '^[a-z0-9][a-z0-9._/-]{0,200}$',
    },
  ],
};

/** The approved declarations of a server, or null while nothing is approved (CC-243 getAdminServerPolicies). */
function approvedTypesOf(
  serverId: string,
  approvedPolicies: readonly string[],
): ResourceTypeDeclaration[] | null {
  const fixture = POLICY_FIXTURES[serverId];
  if (fixture && approvedPolicies.includes(serverId)) {
    return fixture.pendingTypes;
  }
  return BASE_APPROVED[serverId] ?? null;
}

/** What the gateway has registered as grantable, by type, for the validation of the scope mapping. */
function grantable(approvedPolicies: readonly string[]): Map<string, string | null> {
  const types = new Map<string, string | null>();
  for (const serverId of new Set([
    ...Object.keys(BASE_APPROVED),
    ...Object.keys(POLICY_FIXTURES),
  ])) {
    for (const declaration of approvedTypesOf(serverId, approvedPolicies) ?? []) {
      types.set(declaration.type, declaration.scopePattern ?? null);
    }
  }
  return types;
}

const SERVER_PATTERN =
  /^mcp-(?!(?:gateway|offboarding|portal|broker|prometheus|platform|admin|registry|adapter|internal|ci)$)[a-z][a-z0-9]{1,30}$/;
const SYSTEM_PATTERN =
  /^(?!(?:gateway|offboarding|portal|broker|prometheus|platform|admin|registry|adapter|internal|ci)$)[a-z][a-z0-9]{1,30}$/;
const OVERRIDE_PATTERN = /^override-[a-z0-9][a-z0-9-]{0,54}$/;
/** `displayName` of a system: 1 to 64 characters without control or format characters (CC-243). */
const DISPLAY_NAME = /^(?!.*[\p{Cc}\p{Cf}]).{1,64}$/su;

const etagOf = (version: number): string => `"v${version}"`;

/** Handlers of the administrator's registry screens; the registry view itself is in admin-mock. */
export function createDynamicAdminHandlers(store: MockStore, ctx: MockContext): HttpHandler[] {
  const { at } = ctx;
  let data = load();
  registries.set(store, data);
  store.onReset.push(() => {
    data = seedData();
    registries.set(store, data);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to remove.
    }
  });

  const baseHeaders = { 'X-Request-Id': ctx.requestId };
  const refused = (): Response | undefined => {
    const gone = ctx.unauthenticated();
    if (gone) {
      return gone;
    }
    return store.state.admin ? undefined : ctx.failure('access_denied', 403);
  };
  const unavailable = (): Response | undefined =>
    store.state.scenario === 'errors' ? ctx.failure('upstream_unavailable', 503) : undefined;
  const reject = (error: string, reason: string, message: string): Response =>
    HttpResponse.json({ error, reason, message }, { status: 422, headers: baseHeaders });
  const json = (body: JsonBodyType, status: number, version?: number): Response =>
    HttpResponse.json(body, {
      status,
      headers: version === undefined ? baseHeaders : { ...baseHeaders, ETag: etagOf(version) },
    });
  const stepUp = (page: string): Response =>
    HttpResponse.json(
      {
        error: 'step_up_required',
        stepUpUrl: `/api/v1/auth/login?stepUp=true&returnPath=${page}`,
        requestId: ctx.requestId,
      },
      { status: 401, headers: baseHeaders },
    );
  /** One fresh MFA covers one operation, like the other mock operations that need it. */
  const needsMfa = (page: string): Response | undefined => {
    if (!store.state.mfaFresh) {
      return stepUp(page);
    }
    store.update({ mfaFresh: false });
    return undefined;
  };
  const commit = (): void => save(data);
  /** If-Match: absent is 428, different from the stored ETag is 412. */
  const precondition = (request: Request, version: number): Response | undefined => {
    const header = request.headers.get('If-Match');
    if (!header) {
      return ctx.failure('precondition_required', 428);
    }
    // A header that is no entity tag is a malformed request, not a stale one (CC-243).
    if (!/^(?:W\/)?"[^"]*"$/.test(header)) {
      return ctx.failure('invalid_request', 400);
    }
    return header === etagOf(version) ? undefined : ctx.failure('precondition_failed', 412);
  };
  /** A path identifier that does not fit its pattern is 400 invalid_request, never 404 (CC-243). */
  const invalidPathId = (request: Request): Response | undefined => {
    const path = new URL(request.url).pathname;
    const checks: [RegExp, RegExp][] = [
      [/\/admin\/servers\/([^/]+)$/, SERVER_PATTERN],
      [/\/admin\/systems\/([^/]+)$/, SYSTEM_PATTERN],
      [/\/admin\/policy\/overrides\/([^/]+)$/, OVERRIDE_PATTERN],
      [/\/admin\/registry\/servers\/([^/]+)\/policies(?:\/pending|\/approve)?$/, SERVER_PATTERN],
    ];
    for (const [route, pattern] of checks) {
      const id = route.exec(path)?.[1];
      if (id !== undefined && !pattern.test(decodeURIComponent(id))) {
        return ctx.failure('invalid_request', 400);
      }
    }
    return undefined;
  };
  const guard = (
    request: Request,
    cookies: Record<string, string>,
    write: boolean,
  ): Response | undefined => {
    if (write && !ctx.csrfValid(request, cookies)) {
      return HttpResponse.json(
        { error: 'csrf_invalid', requestId: ctx.requestId },
        { status: 403, headers: baseHeaders },
      );
    }
    return refused() ?? invalidPathId(request) ?? unavailable();
  };

  const serverOf = (id: string) => data.servers.find((entry) => entry.value.serverId === id);
  const systemOf = (id: string) => data.systems.find((entry) => entry.value.system === id);
  const overrideOf = (id: string) => data.overrides.find((entry) => entry.value.id === id);

  const credentialProblem = (credential: ServerConfig['credential']): Response | undefined => {
    if (!credential.acceptedTypes.includes(credential.type)) {
      return reject(
        'server_rejected',
        'credential_type_not_accepted',
        'type must be one of acceptedTypes',
      );
    }
    const service = credential.acceptedTypes.includes('service-account');
    if (
      service &&
      credential.acceptedTypes.some((type) => type === 'user-oauth' || type === 'user-secret')
    ) {
      return reject(
        'server_rejected',
        'credential_types_mixed',
        'service-account cannot be mixed with user types',
      );
    }
    return undefined;
  };

  return [
    http.get(at('/api/v1/admin/servers'), ({ request, cookies }) => {
      const denied = guard(request, cookies, false);
      return (
        denied ??
        json(
          data.servers.map((entry) => entry.value),
          200,
        )
      );
    }),
    http.post(at('/api/v1/admin/servers'), async ({ request, cookies }) => {
      const denied = guard(request, cookies, true);
      if (denied) {
        return denied;
      }
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || 'tlsName' in body) {
        return ctx.failure('invalid_request', 400);
      }
      const created = body as unknown as ServerConfig;
      if (created.serverId !== `mcp-${created.system}`) {
        return reject('server_rejected', 'server_id_mismatch', 'serverId must be mcp-<system>');
      }
      if (RESERVED_SYSTEMS.includes(created.system)) {
        return reject('server_rejected', 'system_reserved', `${created.system} is reserved`);
      }
      const problem = credentialProblem(created.credential);
      if (problem) {
        return problem;
      }
      if (serverOf(created.serverId)) {
        return ctx.failure('server_exists', 409);
      }
      const mfa = needsMfa('/admin/servers');
      if (mfa) {
        return mfa;
      }
      const value: ServerConfig = {
        ...created,
        enabled: created.enabled ?? true,
        adapter: created.adapter ?? false,
      };
      data.servers.push({ value, version: 1 });
      commit();
      return json(value, 201, 1);
    }),
    http.get(at('/api/v1/admin/servers/:serverId'), ({ request, cookies, params }) => {
      const denied = guard(request, cookies, false);
      const entry = serverOf(String(params['serverId']));
      return (
        denied ??
        (entry ? json(entry.value, 200, entry.version) : ctx.failure('not_found_or_denied', 404))
      );
    }),
    http.patch(at('/api/v1/admin/servers/:serverId'), async ({ request, cookies, params }) => {
      const denied = guard(request, cookies, true);
      if (denied) {
        return denied;
      }
      const entry = serverOf(String(params['serverId']));
      if (!entry) {
        return ctx.failure('not_found_or_denied', 404);
      }
      const missing = precondition(request, entry.version);
      if (missing) {
        return missing;
      }
      const patch = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!patch || 'tlsName' in patch || 'adapter' in patch) {
        return ctx.failure('invalid_request', 400);
      }
      const onlyDisable = Object.keys(patch).length === 1 && patch['enabled'] === false;
      if (!onlyDisable) {
        const mfa = needsMfa('/admin/servers');
        if (mfa) {
          return mfa;
        }
      }
      const value = { ...entry.value, ...patch } as ServerConfig;
      const problem = credentialProblem(value.credential);
      if (problem) {
        return problem;
      }
      entry.value = value;
      entry.version += 1;
      commit();
      return json(value, 200, entry.version);
    }),
    http.delete(at('/api/v1/admin/servers/:serverId'), ({ request, cookies, params }) => {
      const denied = guard(request, cookies, true);
      if (denied) {
        return denied;
      }
      const id = String(params['serverId']);
      if (!serverOf(id)) {
        return ctx.failure('not_found_or_denied', 404);
      }
      const mfa = needsMfa('/admin/servers');
      if (mfa) {
        return mfa;
      }
      data.servers = data.servers.filter((entry) => entry.value.serverId !== id);
      commit();
      return new HttpResponse(null, { status: 204, headers: baseHeaders });
    }),

    http.get(at('/api/v1/admin/policy/scope-mapping'), ({ request, cookies }) => {
      const denied = guard(request, cookies, false);
      return denied ?? json({ scopeMapping: data.mapping.value }, 200, data.mapping.version);
    }),
    http.put(at('/api/v1/admin/policy/scope-mapping'), async ({ request, cookies }) => {
      const denied = guard(request, cookies, true);
      if (denied) {
        return denied;
      }
      const missing = precondition(request, data.mapping.version);
      if (missing) {
        return missing;
      }
      const body = (await request.json().catch(() => null)) as {
        scopeMapping?: ScopeMappingEntry[];
      } | null;
      if (!body || !Array.isArray(body.scopeMapping)) {
        return ctx.failure('invalid_request', 400);
      }
      const types = grantable(store.state.policiesApproved);
      const groups = new Set<string>();
      for (const entry of body.scopeMapping) {
        if (groups.has(entry.group)) {
          return reject(
            'scope_mapping_rejected',
            'group_duplicate',
            `${entry.group} appears twice`,
          );
        }
        groups.add(entry.group);
        for (const scope of entry.scopes) {
          const slash = scope.indexOf('/');
          const type = scope.slice(0, slash);
          const local = scope.slice(slash + 1);
          if (!types.has(type)) {
            return reject(
              'scope_mapping_rejected',
              'unknown_resource_type',
              `${scope} names a type that no registered server declares`,
            );
          }
          const pattern = types.get(type);
          if (!pattern) {
            return reject(
              'scope_mapping_rejected',
              'scope_not_grantable',
              `${type} has no scopePattern`,
            );
          }
          if (!new RegExp(pattern).test(local)) {
            return reject(
              'scope_mapping_rejected',
              'scope_invalid',
              `${local} does not match ${pattern}`,
            );
          }
        }
      }
      const mfa = needsMfa('/admin/scope-mapping');
      if (mfa) {
        return mfa;
      }
      data.mapping.value = body.scopeMapping;
      data.mapping.version += 1;
      commit();
      return json({ scopeMapping: data.mapping.value }, 200, data.mapping.version);
    }),

    http.get(at('/api/v1/admin/policy/overrides'), ({ request, cookies }) => {
      const denied = guard(request, cookies, false);
      return (
        denied ??
        json(
          data.overrides.map((entry) => entry.value),
          200,
        )
      );
    }),
    http.get(at('/api/v1/admin/policy/overrides/:id'), ({ request, cookies, params }) => {
      const denied = guard(request, cookies, false);
      const entry = overrideOf(String(params['id']));
      return (
        denied ??
        (entry ? json(entry.value, 200, entry.version) : ctx.failure('not_found_or_denied', 404))
      );
    }),
    http.put(at('/api/v1/admin/policy/overrides/:id'), async ({ request, cookies, params }) => {
      const denied = guard(request, cookies, true);
      if (denied) {
        return denied;
      }
      const id = String(params['id']);
      const body = (await request.json().catch(() => null)) as {
        target?: string;
        text?: string;
      } | null;
      if (!body || typeof body.target !== 'string' || typeof body.text !== 'string') {
        return ctx.failure('invalid_request', 400);
      }
      const existing = overrideOf(id);
      if (existing) {
        const missing = precondition(request, existing.version);
        if (missing) {
          return missing;
        }
      } else if (request.headers.get('If-None-Match') !== '*') {
        return ctx.failure('precondition_required', 428);
      }
      if (!/^\s*@id\("[^"]*"\)\s*forbid\b/.test(body.text) && /\bpermit\b/.test(body.text)) {
        return reject('override_rejected', 'not_forbid', 'an override is forbid only');
      }
      if (!body.text.includes(`@id("${id}")`)) {
        return reject('override_rejected', 'id_mismatch', `the @id of the text is not ${id}`);
      }
      if (body.target.startsWith('mcp-') && !serverOf(body.target)) {
        return reject(
          'override_rejected',
          'target_unknown',
          `${body.target} is not in the registry`,
        );
      }
      if (body.target === 'gateway' && !body.text.includes('Action::"call"')) {
        return reject(
          'override_rejected',
          'target_mismatch',
          'a gateway override decides the call action on Tool',
        );
      }
      // A weaker text widens access like a removal: replacing needs a fresh MFA, creating does not (CC-243).
      if (existing) {
        const mfa = needsMfa('/admin/overrides');
        if (mfa) {
          return mfa;
        }
      }
      const value: Override = {
        id,
        target: body.target,
        text: body.text,
        setBy: MOCK_ADMIN_SUB,
        setAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
      if (existing) {
        existing.value = value;
        existing.version += 1;
      } else {
        data.overrides.push({ value, version: 1 });
      }
      commit();
      return json(value, 200, (existing ?? overrideOf(id))!.version);
    }),
    http.delete(at('/api/v1/admin/policy/overrides/:id'), ({ request, cookies, params }) => {
      const denied = guard(request, cookies, true);
      if (denied) {
        return denied;
      }
      const entry = overrideOf(String(params['id']));
      if (!entry) {
        return ctx.failure('not_found_or_denied', 404);
      }
      const missing = precondition(request, entry.version);
      if (missing) {
        return missing;
      }
      const mfa = needsMfa('/admin/overrides');
      if (mfa) {
        return mfa;
      }
      data.overrides = data.overrides.filter((candidate) => candidate !== entry);
      commit();
      return new HttpResponse(null, { status: 204, headers: baseHeaders });
    }),

    http.get(
      at('/api/v1/admin/registry/servers/:serverId/policies'),
      ({ request, cookies, params }) => {
        const denied = guard(request, cookies, false);
        if (denied) {
          return denied;
        }
        const id = String(params['serverId']);
        const known =
          data.servers.some((entry) => entry.value.serverId === id) || id in POLICY_FIXTURES;
        if (!known) {
          return ctx.failure('not_found_or_denied', 404);
        }
        const types = approvedTypesOf(id, store.state.policiesApproved);
        const fixture = POLICY_FIXTURES[id];
        const namespace = types?.[0]?.type.split('::')[0];
        const policies: PendingPolicies['approvedPolicies'] =
          types === null
            ? null
            : fixture && store.state.policiesApproved.includes(id)
              ? fixture.pending
              : (fixture?.approved ?? {
                  namespace: namespace ?? 'Notes',
                  schema: `namespace ${namespace ?? 'Notes'} {}`,
                  files: [],
                });
        return json(
          {
            approvedHash:
              types === null
                ? null
                : 'sha256:0f3a9c5b7d1e4a6c8b0d2f4e6a8c0b1d3f5a7c9e1b3d5f7a9c0e2b4d6f8a1c3e',
            approvedPolicies: policies,
            approvedResourceTypes: types,
          },
          200,
        );
      },
    ),
    http.get(
      at('/api/v1/admin/registry/servers/:serverId/policies/pending'),
      ({ request, cookies, params }) => {
        const denied = guard(request, cookies, false);
        if (denied) {
          return denied;
        }
        const id = String(params['serverId']);
        const fixture = POLICY_FIXTURES[id];
        if (!store.state.policies || !fixture || store.state.policiesApproved.includes(id)) {
          return ctx.failure('not_found_or_denied', 404);
        }
        const body: PendingPolicies = {
          approvedHash: fixture.approved
            ? 'sha256:0f3a9c5b7d1e4a6c8b0d2f4e6a8c0b1d3f5a7c9e1b3d5f7a9c0e2b4d6f8a1c3e'
            : null,
          approvedPolicies: fixture.approved,
          approvedResourceTypes: fixture.approvedTypes,
          pendingHash: fixture.hash,
          pendingPolicies: fixture.pending,
          pendingResourceTypes: fixture.pendingTypes,
          pendingVersion: fixture.version,
          source: fixture.source,
        };
        return json(body, 200);
      },
    ),
    http.post(
      at('/api/v1/admin/registry/servers/:serverId/policies/approve'),
      async ({ request, cookies, params }) => {
        const denied = guard(request, cookies, true);
        if (denied) {
          return denied;
        }
        const id = String(params['serverId']);
        const fixture = POLICY_FIXTURES[id];
        if (!store.state.policies || !fixture || store.state.policiesApproved.includes(id)) {
          return ctx.failure('not_found_or_denied', 404);
        }
        const body = (await request.json().catch(() => null)) as { policiesHash?: string } | null;
        if (!body || typeof body.policiesHash !== 'string') {
          return ctx.failure('invalid_request', 400);
        }
        if (body.policiesHash !== fixture.hash) {
          return ctx.failure('hash_mismatch', 409);
        }
        const mfa = needsMfa('/admin');
        if (mfa) {
          return mfa;
        }
        store.update({ policiesApproved: [...store.state.policiesApproved, id] });
        // A declaration with a narrower scope pattern makes the mapping entries that no longer fit invalid (CC-237 A7).
        const pattern = fixture.pendingTypes.find((type) => type.scopePattern)?.scopePattern;
        const type = fixture.pendingTypes.find((candidate) => candidate.scopePattern)?.type;
        const ignored =
          pattern && type
            ? data.mapping.value.flatMap((entry) =>
                entry.scopes
                  .filter(
                    (scope) =>
                      scope.startsWith(`${type}/`) &&
                      !new RegExp(pattern).test(scope.slice(type.length + 1)),
                  )
                  .map((scope) => ({ group: entry.group, scope, reason: 'invalid_scope' })),
              )
            : [];
        return json({ ignoredMappingEntries: ignored }, 200);
      },
    ),

    http.get(at('/api/v1/admin/systems'), ({ request, cookies }) => {
      const denied = guard(request, cookies, false);
      return (
        denied ??
        json(
          data.systems.map((entry) => entry.value),
          200,
        )
      );
    }),
    http.get(at('/api/v1/admin/systems/:system'), ({ request, cookies, params }) => {
      const denied = guard(request, cookies, false);
      const entry = systemOf(String(params['system']));
      return (
        denied ??
        (entry ? json(entry.value, 200, entry.version) : ctx.failure('not_found_or_denied', 404))
      );
    }),
    http.put(at('/api/v1/admin/systems/:system'), async ({ request, cookies, params }) => {
      const denied = guard(request, cookies, true);
      if (denied) {
        return denied;
      }
      const id = String(params['system']);
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body['baseUrl'] !== 'string') {
        return ctx.failure('invalid_request', 400);
      }
      if (RESERVED_SYSTEMS.includes(id)) {
        return reject('system_rejected', 'system_reserved', `${id} is reserved`);
      }
      const existing = systemOf(id);
      if (existing) {
        const missing = precondition(request, existing.version);
        if (missing) {
          return missing;
        }
      } else if (request.headers.get('If-None-Match') !== '*') {
        return ctx.failure('precondition_required', 428);
      }
      const request_ = body as unknown as {
        displayName?: string;
        baseUrl: string;
        whoami?: { path: string; usernameField: string };
        adapter: string;
        product?: string;
        supportedTypes: string[];
        defaultType: string;
        oauth?: {
          clientId: string;
          clientSecret?: string;
          authorizeUrl?: string;
          tokenUrl?: string;
          scopes?: string[];
        };
        revokeUrl?: string;
      };
      if (
        request_.displayName !== undefined &&
        (typeof request_.displayName !== 'string' || !DISPLAY_NAME.test(request_.displayName))
      ) {
        return ctx.failure('invalid_request', 400);
      }
      if (request_.whoami !== undefined && request_.adapter !== 'generic-rest') {
        return ctx.failure('invalid_request', 400);
      }
      if (request_.adapter === 'generic-rest') {
        const types = request_.supportedTypes;
        // A generic-rest system takes user-secret or service-account, never both and never OAuth (CC-247).
        if (
          types.includes('user-oauth') ||
          types.includes('token-exchange') ||
          types.length !== 1
        ) {
          return reject(
            'system_rejected',
            'credential_type_not_supported_by_adapter',
            'generic-rest takes user-secret or service-account',
          );
        }
      }
      if (request_.adapter === 'atlassian-dc' && !request_.product) {
        return reject('system_rejected', 'product_required', 'atlassian-dc needs product');
      }
      if (!request_.supportedTypes.includes(request_.defaultType)) {
        return reject(
          'system_rejected',
          'default_type_not_supported',
          'defaultType must be one of supportedTypes',
        );
      }
      const needsOauth = request_.supportedTypes.some(
        (type) => type === 'user-oauth' || type === 'token-exchange',
      );
      if (needsOauth && !request_.oauth) {
        return reject('system_rejected', 'oauth_required', 'oauth is required');
      }
      const before = existing?.value;
      const moved =
        !before ||
        before.baseUrl !== request_.baseUrl ||
        (before.revokeUrl ?? '') !== (request_.revokeUrl ?? '') ||
        (before.oauth?.clientId ?? '') !== (request_.oauth?.clientId ?? '') ||
        (before.oauth?.authorizeUrl ?? '') !== (request_.oauth?.authorizeUrl ?? '') ||
        (before.oauth?.tokenUrl ?? '') !== (request_.oauth?.tokenUrl ?? '');
      if (needsOauth && moved && !request_.oauth?.clientSecret) {
        return reject('system_rejected', 'client_secret_required', 'enter the client secret again');
      }
      const mfa = needsMfa('/admin/systems');
      if (mfa) {
        return mfa;
      }
      const { clientSecret, ...oauth } = request_.oauth ?? { clientId: '' };
      const value = {
        ...(body as object),
        system: id,
        displayName: request_.displayName ?? id,
        ...(request_.oauth
          ? {
              oauth: {
                ...oauth,
                clientSecretSet:
                  clientSecret !== undefined || before?.oauth?.clientSecretSet === true,
              },
            }
          : {}),
      } as SystemAdminView;
      if (existing) {
        existing.value = value;
        existing.version += 1;
        if (before && moved) {
          // The broker deletes the connections of the users of a system whose addresses changed: needs_reconnect (CC-238).
          const type = value.supportedTypes.includes('user-oauth') ? 'user-oauth' : 'user-secret';
          const connection = store.state.connections[id] ?? {
            type,
            status: 'connected',
            expiresAt: null,
          };
          store.update({
            connections: {
              ...store.state.connections,
              [id]: { ...connection, status: 'needs_reconnect' },
            },
          });
        }
      } else {
        data.systems.push({ value, version: 1 });
      }
      commit();
      return json(value, 200, (existing ?? systemOf(id))!.version);
    }),
    http.delete(at('/api/v1/admin/systems/:system'), ({ request, cookies, params }) => {
      const denied = guard(request, cookies, true);
      if (denied) {
        return denied;
      }
      const id = String(params['system']);
      const entry = systemOf(id);
      if (!entry) {
        return new HttpResponse(null, { status: 204, headers: baseHeaders });
      }
      const missing = precondition(request, entry.version);
      if (missing) {
        return missing;
      }
      const mfa = needsMfa('/admin/systems');
      if (mfa) {
        return mfa;
      }
      data.systems = data.systems.filter((candidate) => candidate !== entry);
      commit();
      return new HttpResponse(null, { status: 204, headers: baseHeaders });
    }),
  ];
}
