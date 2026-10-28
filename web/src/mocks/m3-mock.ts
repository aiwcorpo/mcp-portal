import { http, HttpResponse, type HttpHandler } from 'msw';
import type {
  ActivityCall,
  AuthenticatorEnrollmentConfirm,
  AuthenticatorStatus,
  ConfirmationView,
} from '../app/api/generated';
import type { MockStore } from './portal-mock';
import { codeAccepted } from './totp';

/** Mock layer for contracts 3.0.x: Authenticator registration, the confirmation preview and the call log. */

/** Seed of the mock broker. A test value: the mock accepts the code computed from it. */
export const MOCK_TOTP_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
export const MOCK_ACCOUNT = 'jkowalski';
export const ENROLLMENT_TTL_MS = 600_000;
export const ENROLLMENT_MAX_WRONG_CODES = 3;
/** Broker limit on enrollment starts; the mock never resets it, so the sixth start shows the 429 state. */
export const ENROLLMENT_START_LIMIT = 5;
export const CONFIRMATION_TTL_MS = 120_000;
/** Id of the pending Confluence delete shown by the preview (the id of the C12 example). */
export const DEMO_CONFIRMATION_ID = 'cnf_4k9Qe2LxW7tB3mZp';
/** Pending operation whose argument carries a right-to-left override, a line break and a control character. */
export const BIDI_CONFIRMATION_ID = 'cnf_Zb3Qm8TnR5vKd2Wy';
const KNOWN_CONFIRMATIONS: readonly string[] = [DEMO_CONFIRMATION_ID, BIDI_CONFIRMATION_ID];

export interface MockEnrollment {
  id: string;
  expiresAt: number;
  wrong: number;
}

export interface MockConfirmation {
  seenAt: number;
  viewed?: boolean;
  cancelled?: boolean;
  superseded?: boolean;
}

export interface M3State {
  authenticator: AuthenticatorStatus;
  enrollment: MockEnrollment | null;
  enrollStarts: number;
  /** A fresh MFA at the IdP, consumed by the next enrollment start or removal. */
  mfaFresh: boolean;
  confirmations: Record<string, MockConfirmation>;
}

export function initialM3State(): M3State {
  return {
    authenticator: { state: 'none' },
    enrollment: null,
    enrollStarts: 0,
    mfaFresh: false,
    confirmations: {},
  };
}

export interface MockContext {
  at: (path: string) => string;
  csrfValid: (request: Request, cookies: Record<string, string>) => boolean;
  failure: (error: string, status: number, extra?: Record<string, unknown>) => Response;
  /** Answers 401 `unauthenticated` when the mock session is gone. */
  unauthenticated: () => Response | undefined;
  requestId: string;
}

const iso = (time: number): string => new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function demoConfirmation(
  seenAt: number,
  id: string = DEMO_CONFIRMATION_ID,
): ConfirmationView {
  if (id === BIDI_CONFIRMATION_ID) {
    return {
      confirmationId: id,
      tool: 'jira__delete_issue',
      system: 'jira',
      resource: { type: 'Jira::Issue', id: 'ABC-123', parent: 'Jira::Project::ABC' },
      arguments: [
        { name: 'issueKey', value: '"ABC-123"', truncated: false },
        {
          name: 'reason',
          value: '"cleanup\u202Egnp.exe\u2066 first line\nsecond line\u0007"',
          truncated: false,
        },
      ],
      expiresAt: iso(seenAt + CONFIRMATION_TTL_MS),
    };
  }
  return {
    confirmationId: DEMO_CONFIRMATION_ID,
    tool: 'confluence__delete_page',
    system: 'confluence',
    resource: { type: 'Confluence::Page', id: '48213', parent: 'Confluence::Space::DEV' },
    arguments: [
      { name: 'pageId', value: '"48213"', truncated: false },
      { name: 'spaceKey', value: '"DEV"', truncated: false },
      { name: 'title', value: '"Release notes 2025 (archiwum)"', truncated: false },
      {
        name: 'versionComment',
        value:
          '"Archiwizacja zgodnie z polityką retencji dokumentacji projektowej; treść przeniesiona do przestrzeni ARCH, strona źródłowa do usunięcia po weryfikacji przez właściciela przestrzeni i',
        truncated: true,
      },
    ],
    expiresAt: iso(seenAt + CONFIRMATION_TTL_MS),
  };
}

interface CallSeed {
  minutesAgo: number;
  client?: string;
  tool: string;
  risk: ActivityCall['risk'];
  resource?: ActivityCall['resource'];
  result: string;
  wrongCodeCount?: number;
  errorCode?: ActivityCall['errorCode'];
  virtualServer?: string;
}

const CALL_SEEDS: CallSeed[] = [
  {
    minutesAgo: 1,
    client: 'claude-code',
    tool: 'confluence__delete_page',
    risk: 'DESTRUCTIVE',
    resource: { type: 'Confluence::Page', id: '48213', parent: 'Confluence::Space::DEV' },
    result: 'confirmation_pending',
    wrongCodeCount: 0,
    virtualServer: 'przeglad-zgloszen',
  },
  {
    minutesAgo: 4,
    client: 'claude-code',
    tool: 'confluence__search',
    risk: 'READ_ONLY',
    resource: { type: 'Confluence::Space', id: 'DEV' },
    result: 'ok',
  },
  {
    minutesAgo: 25,
    client: 'copilot',
    tool: 'jira__search_issues',
    risk: 'READ_ONLY',
    resource: { type: 'Jira::Project', id: 'PAY' },
    result: 'ok',
  },
  {
    minutesAgo: 26,
    client: 'copilot',
    tool: 'jira__create_issue',
    risk: 'UPDATE',
    resource: { type: 'Jira::Project', id: 'PAY' },
    result: 'denied_not_granted',
    errorCode: 'access_denied',
  },
  {
    minutesAgo: 120,
    client: 'claude-code',
    tool: 'opensearch__search',
    risk: 'READ_ONLY',
    resource: { type: 'OpenSearch::Index', id: 'logs-app' },
    result: 'denied_link_scope',
    errorCode: 'access_denied',
    virtualServer: 'przeglad-zgloszen',
  },
  {
    minutesAgo: 240,
    client: 'claude-code',
    tool: 'jira__delete_issue',
    risk: 'DESTRUCTIVE',
    resource: { type: 'Jira::Issue', id: 'ABC-1182' },
    result: 'confirmed',
    wrongCodeCount: 1,
  },
  {
    minutesAgo: 260,
    client: 'claude-code',
    tool: 'jira__delete_issue',
    risk: 'DESTRUCTIVE',
    resource: { type: 'Jira::Issue', id: 'ABC-1190' },
    result: 'expired',
    wrongCodeCount: 0,
    errorCode: 'confirmation_failed',
  },
  {
    minutesAgo: 300,
    client: 'codex',
    tool: 'gitlab__comment_mr',
    risk: 'UPDATE',
    resource: { type: 'GitLab::Project', id: 'payments/api' },
    result: 'ok',
  },
  {
    minutesAgo: 400,
    client: 'claude-code',
    tool: 'jira__delete_issue',
    risk: 'DESTRUCTIVE',
    resource: { type: 'Jira::Issue', id: 'ABC-1201' },
    result: 'superseded',
    wrongCodeCount: 0,
    errorCode: 'confirmation_superseded',
  },
  {
    minutesAgo: 420,
    client: 'claude-code',
    tool: 'jira__delete_issue',
    risk: 'DESTRUCTIVE',
    resource: { type: 'Jira::Issue', id: 'ABC-1204' },
    result: 'cancelled',
    wrongCodeCount: 0,
    errorCode: 'confirmation_cancelled',
  },
  {
    minutesAgo: 421,
    client: 'claude-code',
    tool: 'jira__delete_issue',
    risk: 'DESTRUCTIVE',
    resource: { type: 'Jira::Issue', id: 'ABC-1207' },
    result: 'blocked_by_pending',
    errorCode: 'confirmation_blocked',
  },
  {
    minutesAgo: 500,
    client: 'claude-code',
    tool: 'jira__delete_issue',
    risk: 'DESTRUCTIVE',
    resource: { type: 'Jira::Issue', id: 'ABC-1210' },
    result: 'confirmation_failed',
    wrongCodeCount: 3,
    errorCode: 'confirmation_failed',
  },
  {
    minutesAgo: 600,
    client: 'codex',
    tool: 'servicedesk__get_ticket',
    risk: 'READ_ONLY',
    resource: { type: 'ServiceDesk::Ticket', id: 'SD-77' },
    result: 'error',
    errorCode: 'upstream_unavailable',
  },
  {
    minutesAgo: 700,
    client: 'copilot',
    tool: 'confluence__move_page',
    risk: 'UPDATE',
    result: 'tool_disabled',
    errorCode: 'tool_disabled',
  },
  {
    minutesAgo: 800,
    client: 'claude-code',
    tool: 'jira__get_issue',
    risk: 'READ_ONLY',
    resource: { type: 'Jira::Issue', id: 'PAY-9' },
    result: 'rate_limited',
    errorCode: 'rate_limited',
  },
  {
    minutesAgo: 900,
    client: 'claude-code',
    tool: 'jira__get_issue',
    risk: 'READ_ONLY',
    resource: { type: 'Jira::Issue', id: 'PAY-10' },
    result: 'result_from_a_newer_gateway',
  },
];

/** 16 hand-written rows and then a steady stream of reads, so that "Pokaż więcej" has pages to show. */
export function mockCalls(now: number): ActivityCall[] {
  const day = 86_400_000;
  const seeded = CALL_SEEDS.map((seed, index) =>
    toCall(seed, now - seed.minutesAgo * 60_000, index),
  );
  const tail: ActivityCall[] = [];
  for (let index = 0; index < 70; index += 1) {
    tail.push(
      toCall(
        {
          minutesAgo: 0,
          client: index % 3 === 0 ? 'copilot' : 'claude-code',
          tool: 'jira__get_issue',
          risk: 'READ_ONLY',
          resource: { type: 'Jira::Issue', id: `PAY-${100 + index}` },
          result: 'ok',
        },
        now - 1_000 * 60 * 60 * 16 - index * (day / 3),
        100 + index,
      ),
    );
  }
  return [...seeded, ...tail].filter((call) => Date.parse(call.ts) >= now - 30 * day);
}

function toCall(seed: CallSeed, time: number, index: number): ActivityCall {
  const call: ActivityCall = {
    requestId: `0192d1b2-7c3a-7d4e-8f10-${String(index).padStart(12, '0')}`,
    ts: new Date(time).toISOString(),
    tool: seed.tool,
    risk: seed.risk,
    result: seed.result,
    errorCode: seed.errorCode ?? null,
  };
  if (seed.client) {
    call.client = seed.client;
  }
  if (seed.virtualServer) {
    call.virtualServer = seed.virtualServer;
  }
  if (seed.resource) {
    call.resource = seed.resource;
  }
  if (seed.wrongCodeCount !== undefined) {
    call.wrongCodeCount = seed.wrongCodeCount;
  }
  return call;
}

const RESULT_GROUPS: Record<string, readonly string[]> = {
  ok: ['ok'],
  denied: [
    'denied_not_granted',
    'denied_link_scope',
    'denied_policy',
    'tool_disabled',
    'credential_required',
    'rate_limited',
  ],
  error: ['error', 'step_up_required'],
  confirmation: [
    'confirmation_pending',
    'confirmed',
    'expired',
    'confirmation_failed',
    'superseded',
    'blocked_by_pending',
    'cancelled',
  ],
};

function stepUp(): Response {
  return HttpResponse.json(
    {
      error: 'step_up_required',
      stepUpUrl: '/api/v1/auth/login?stepUp=true&returnPath=/catalog',
    },
    { status: 401 },
  );
}

export function createM3Handlers(store: MockStore, ctx: MockContext): HttpHandler[] {
  const { at } = ctx;
  const headers = { 'X-Request-Id': ctx.requestId };
  const m3 = (): M3State => store.state;
  const isUnavailable = () => store.state.scenario === 'errors';
  const unavailable = () => ctx.failure('upstream_unavailable', 503);
  /** A known operation counts as pending from the first call that mentions it, as the gateway's record would. */
  const knownConfirmation = (id: string): MockConfirmation | undefined =>
    m3().confirmations[id] ??
    (KNOWN_CONFIRMATIONS.includes(id) ? { seenAt: Date.now() } : undefined);

  return [
    http.get(at('/api/v1/authenticator'), () => {
      const gone = ctx.unauthenticated();
      if (gone) {
        return gone;
      }
      if (isUnavailable()) {
        return unavailable();
      }
      return HttpResponse.json(m3().authenticator, { headers });
    }),
    http.post(at('/api/v1/authenticator/enrollment'), ({ request, cookies }) => {
      if (!ctx.csrfValid(request, cookies)) {
        return undefined;
      }
      const gone = ctx.unauthenticated();
      if (gone) {
        return gone;
      }
      if (isUnavailable()) {
        return unavailable();
      }
      if (!m3().mfaFresh) {
        return stepUp();
      }
      if (m3().authenticator.state === 'active') {
        return ctx.failure('already_registered', 409);
      }
      if (m3().enrollStarts >= ENROLLMENT_START_LIMIT) {
        return ctx.failure('rate_limited', 429);
      }
      const now = Date.now();
      const id = `enr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      store.update({
        mfaFresh: false,
        enrollStarts: m3().enrollStarts + 1,
        enrollment: { id, expiresAt: now + ENROLLMENT_TTL_MS, wrong: 0 },
      });
      const issuer = 'MCP%20Platform';
      return HttpResponse.json(
        {
          enrollmentId: id,
          otpauthUri: `otpauth://totp/${issuer}:${MOCK_ACCOUNT}?secret=${MOCK_TOTP_SEED}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
          secret: MOCK_TOTP_SEED,
          expiresAt: iso(now + ENROLLMENT_TTL_MS),
        },
        {
          status: 201,
          headers: { ...headers, 'Cache-Control': 'no-store', Pragma: 'no-cache' },
        },
      );
    }),
    http.post(at('/api/v1/authenticator/enrollment/confirm'), async ({ request, cookies }) => {
      if (!ctx.csrfValid(request, cookies)) {
        return undefined;
      }
      const gone = ctx.unauthenticated();
      if (gone) {
        return gone;
      }
      if (isUnavailable()) {
        return unavailable();
      }
      const body = (await request
        .json()
        .catch(() => null)) as AuthenticatorEnrollmentConfirm | null;
      if (!body || typeof body.code !== 'string' || !/^[0-9]{6}$/.test(body.code)) {
        return ctx.failure('invalid_request', 400);
      }
      const enrollment = m3().enrollment;
      if (!enrollment || enrollment.id !== body.enrollmentId) {
        return ctx.failure('not_found_or_denied', 404);
      }
      const now = Date.now();
      if (now > enrollment.expiresAt) {
        store.update({ enrollment: null });
        return ctx.failure('enrollment_invalid', 422);
      }
      if (await codeAccepted(MOCK_TOTP_SEED, body.code, now)) {
        store.update({
          enrollment: null,
          authenticator: { state: 'active', registeredAt: iso(now) },
        });
        return HttpResponse.json({ state: 'active', registeredAt: iso(now) }, { headers });
      }
      const wrong = enrollment.wrong + 1;
      if (wrong >= ENROLLMENT_MAX_WRONG_CODES) {
        store.update({ enrollment: null });
        return ctx.failure('enrollment_invalid', 422);
      }
      store.update({ enrollment: { ...enrollment, wrong } });
      return ctx.failure('invalid_code', 422);
    }),
    http.delete(at('/api/v1/authenticator'), ({ request, cookies }) => {
      if (!ctx.csrfValid(request, cookies)) {
        return undefined;
      }
      const gone = ctx.unauthenticated();
      if (gone) {
        return gone;
      }
      if (isUnavailable()) {
        return unavailable();
      }
      if (!m3().mfaFresh) {
        return stepUp();
      }
      store.update({ mfaFresh: false, authenticator: { state: 'none' }, enrollment: null });
      return new HttpResponse(null, { status: 204, headers });
    }),
    http.get(at('/api/v1/confirmations/:id'), ({ params }) => {
      const gone = ctx.unauthenticated();
      if (gone) {
        return gone;
      }
      if (isUnavailable()) {
        return unavailable();
      }
      const id = String(params['id']);
      const known = m3().confirmations[id];
      if (!KNOWN_CONFIRMATIONS.includes(id) || known?.cancelled || known?.superseded) {
        return ctx.failure('not_found_or_denied', 404);
      }
      const seenAt = known?.seenAt ?? Date.now();
      if (!known) {
        store.update({ confirmations: { ...m3().confirmations, [id]: { seenAt } } });
      }
      if (Date.now() > seenAt + CONFIRMATION_TTL_MS) {
        return ctx.failure('not_found_or_denied', 404);
      }
      return HttpResponse.json(demoConfirmation(seenAt, id), {
        headers: { ...headers, 'Cache-Control': 'no-store', Pragma: 'no-cache' },
      });
    }),
    http.post(at('/api/v1/confirmations/:id/viewed'), ({ request, cookies, params }) => {
      if (!ctx.csrfValid(request, cookies)) {
        return undefined;
      }
      const gone = ctx.unauthenticated();
      if (gone) {
        return gone;
      }
      const id = String(params['id']);
      const known = knownConfirmation(id);
      if (!known || known.cancelled || known.superseded) {
        return ctx.failure('not_found_or_denied', 404);
      }
      store.update({ confirmations: { ...m3().confirmations, [id]: { ...known, viewed: true } } });
      return new HttpResponse(null, { status: 204, headers });
    }),
    http.post(at('/api/v1/confirmations/:id/cancel'), ({ request, cookies, params }) => {
      if (!ctx.csrfValid(request, cookies)) {
        return undefined;
      }
      const gone = ctx.unauthenticated();
      if (gone) {
        return gone;
      }
      if (isUnavailable()) {
        return unavailable();
      }
      const id = String(params['id']);
      const known = knownConfirmation(id);
      if (!known || known.superseded || Date.now() > known.seenAt + CONFIRMATION_TTL_MS) {
        return ctx.failure('not_found_or_denied', 404);
      }
      store.update({
        confirmations: { ...m3().confirmations, [id]: { ...known, cancelled: true } },
      });
      return new HttpResponse(null, { status: 204, headers });
    }),
    http.get(at('/api/v1/activity/calls'), ({ request }) => {
      const gone = ctx.unauthenticated();
      if (gone) {
        return gone;
      }
      if (isUnavailable()) {
        return unavailable();
      }
      const query = new URL(request.url).searchParams;
      const limit = Math.min(200, Math.max(1, Number(query.get('limit') ?? 50) || 50));
      const group = query.get('result');
      if (group !== null && !(group in RESULT_GROUPS)) {
        return ctx.failure('invalid_request', 400);
      }
      const from = query.get('from');
      const to = query.get('to');
      const needle = query.get('q')?.toLowerCase() ?? '';
      const offsetText = query.get('cursor');
      const offset = offsetText === null ? 0 : Number(/^c(\d{1,6})$/.exec(offsetText)?.[1] ?? NaN);
      if (Number.isNaN(offset)) {
        return ctx.failure('invalid_request', 400);
      }
      const rows = mockCalls(Date.now())
        .filter((call) => !from || Date.parse(call.ts) >= Date.parse(from))
        .filter((call) => !to || Date.parse(call.ts) <= Date.parse(to))
        .filter((call) => !group || RESULT_GROUPS[group].includes(call.result))
        .filter(
          (call) =>
            !needle ||
            call.tool.toLowerCase().includes(needle) ||
            (call.resource?.id.toLowerCase().includes(needle) ?? false),
        );
      const page = rows.slice(offset, offset + limit);
      const next: Record<string, string> =
        offset + limit < rows.length ? { 'X-Next-Cursor': `c${offset + limit}` } : {};
      return HttpResponse.json(page, { headers: { ...headers, ...next } });
    }),
  ];
}
