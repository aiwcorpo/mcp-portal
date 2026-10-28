import { EnvironmentProviders, Injectable, Provider } from '@angular/core';
import { setupWorker } from 'msw/browser';
import type { AuthenticatorStatus } from '../app/api/generated';
import { LOGIN_PATH, safeReturnPath } from '../app/core/auth-urls';
import { BrowserNavigation } from '../app/core/browser-navigation';
import {
  MockOAuthOutcome,
  MockScenario,
  MockState,
  MockStore,
  completeMockLogin,
  completeMockOAuth,
  createMockHandlers,
  initialMockState,
} from './portal-mock';
import { DEMO_CONFIRMATION_ID } from './m3-mock';

/**
 * Mock build only (angular.json fileReplacements for `mocks` and `e2e`). Mock state lives in a cookie
 * because login and OAuth are full page loads, as with the real BFF; it never holds a secret.
 */
const STATE_COOKIE = 'mcp-portal-mock';
const SCENARIOS: readonly MockScenario[] = ['default', 'mixed', 'empty', 'nolinks', 'errors'];
const OAUTH_OUTCOMES: readonly MockOAuthOutcome[] = [
  'ok',
  'cancelled',
  'flow_invalid',
  'provider_error',
];

const AUTHENTICATOR_STATES = ['none', 'active', 'locked', 'disabled'] as const;
type AuthenticatorScenario = (typeof AUTHENTICATOR_STATES)[number];

function authenticatorFor(scenario: AuthenticatorScenario, now = Date.now()): AuthenticatorStatus {
  const iso = (time: number) => new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const registeredAt = iso(now - 2 * 86_400_000);
  switch (scenario) {
    case 'none':
      return { state: 'none' };
    case 'active':
      return { state: 'active', registeredAt, lastUsedAt: iso(now - 3_600_000) };
    case 'locked':
      return {
        state: 'active',
        registeredAt,
        lastUsedAt: iso(now - 3_600_000),
        lockedUntil: iso(now + 900_000),
      };
    case 'disabled':
      return {
        state: 'disabled',
        registeredAt,
        lastUsedAt: iso(now - 86_400_000),
        disabledAt: iso(now - 3_600_000),
        disabledReason: 'daily_failure_limit',
      };
  }
}

function readState(): MockState {
  const raw = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);
  if (!raw) {
    return initialMockState();
  }
  try {
    return {
      ...initialMockState(),
      ...(JSON.parse(decodeURIComponent(raw)) as Partial<MockState>),
    };
  } catch {
    return initialMockState();
  }
}

function writeState(state: MockState): void {
  document.cookie = `${STATE_COOKIE}=${encodeURIComponent(JSON.stringify(state))}; Path=/; SameSite=Strict`;
}

const store = new MockStore(readState(), writeState);

/**
 * ?mockScenario=default|mixed|empty|nolinks|errors switches the data set, ?mockOAuth=<outcome> the result
 * of the next OAuth provider round trip, ?mockSession=in|out starts with or without a session and
 * ?mockAuthenticator=none|active|locked|disabled sets the Authenticator registration, all for the rest
 * of the browser session. The preview of the pending operation is /confirm/cnf_4k9Qe2LxW7tB3mZp.
 */
function applyScenarioFromUrl(): void {
  const params = new URLSearchParams(location.search);
  const scenario = params.get('mockScenario');
  if (scenario && (SCENARIOS as readonly string[]).includes(scenario)) {
    store.reset({
      ...initialMockState(),
      session: store.state.session,
      scenario: scenario as MockScenario,
    });
  }
  const session = params.get('mockSession');
  if (session === 'out' || session === 'in') {
    store.update({ session: session === 'in' });
  }
  const authenticator = params.get('mockAuthenticator');
  if (authenticator && (AUTHENTICATOR_STATES as readonly string[]).includes(authenticator)) {
    store.update({
      authenticator: authenticatorFor(authenticator as AuthenticatorScenario),
      enrollment: null,
    });
  }
  const outcome = params.get('mockOAuth');
  if (outcome && (OAUTH_OUTCOMES as readonly string[]).includes(outcome)) {
    store.update({ oauthOutcome: outcome as MockOAuthOutcome });
  }
}

/** Plays the IdP and the OAuth provider, which a service worker cannot do for top-level navigations. */
@Injectable()
class MockBrowserNavigation extends BrowserNavigation {
  override assign(url: string): void {
    const target = new URL(url, location.origin);
    if (target.origin === location.origin && target.pathname === LOGIN_PATH) {
      completeMockLogin(store);
      if (target.searchParams.get('stepUp') === 'true') {
        store.update({ mfaFresh: true });
      }
      super.assign(safeReturnPath(target.searchParams.get('returnPath')));
      return;
    }
    if (/^[a-z]+\.internal$/.test(target.hostname) && target.pathname === '/oauth/authorize') {
      super.assign(completeMockOAuth(store));
      return;
    }
    super.assign(url);
  }
}

/**
 * Test hook of the mock build (e2e): what the gateway does when another DESTRUCTIVE operation replaces
 * the pending one. Not part of the production bundle, like the rest of this file.
 */
function exposeTestHooks(): void {
  Object.assign(window, {
    __portalMock: {
      supersedeConfirmation: (id: string = DEMO_CONFIRMATION_ID) =>
        store.update({
          confirmations: {
            ...store.state.confirmations,
            [id]: {
              ...(store.state.confirmations[id] ?? { seenAt: Date.now() }),
              superseded: true,
            },
          },
        }),
    },
  });
}

export async function startMockApi(): Promise<(Provider | EnvironmentProviders)[]> {
  applyScenarioFromUrl();
  exposeTestHooks();
  await setupWorker(...createMockHandlers(store)).start({
    serviceWorker: { url: '/mockServiceWorker.js' },
    onUnhandledFrame: 'bypass',
    quiet: true,
  });
  return [{ provide: BrowserNavigation, useClass: MockBrowserNavigation }];
}
