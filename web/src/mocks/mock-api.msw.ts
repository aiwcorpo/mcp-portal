import { EnvironmentProviders, Injectable, Provider } from '@angular/core';
import { setupWorker } from 'msw/browser';
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
 * of the next OAuth provider round trip and ?mockSession=in|out starts with or without a session, all for the rest
 * of the browser session.
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

export async function startMockApi(): Promise<(Provider | EnvironmentProviders)[]> {
  applyScenarioFromUrl();
  await setupWorker(...createMockHandlers(store)).start({
    serviceWorker: { url: '/mockServiceWorker.js' },
    onUnhandledFrame: 'bypass',
    quiet: true,
  });
  return [{ provide: BrowserNavigation, useClass: MockBrowserNavigation }];
}
