import { MOCK_XSRF_TOKEN } from '@aiwcorpo/mcp-contracts/msw';
import { setupServer } from 'msw/node';
import { MockStore, createMockHandlers } from '../mocks/portal-mock';

/**
 * MSW in unit tests: the same stateful handlers as the dev mock, over the contract handlers, with the
 * CSRF rule enforced. jsdom gets the XSRF-TOKEN cookie (the name the BFF used up to M1); the contract
 * handlers look for __Host-XSRF-TOKEN, so the cookie header is renamed on the way, which also checks that
 * the interceptor accepts the older name.
 */
export function useMockApi() {
  // The first test of a file starts the app cold; in a container on a busy host that exceeds the 5 s default.
  vi.setConfig({ testTimeout: 20_000 });
  const store = new MockStore();
  const server = setupServer(...createMockHandlers(store));

  // jsdom's XHR adds cookies after MSW intercepts, so hand the cookie jar to the handlers explicitly.
  server.events.on('request:start', ({ request }) => {
    if (!request.headers.has('cookie') && document.cookie) {
      request.headers.set(
        'cookie',
        document.cookie.replace(/(^|;\s*)XSRF-TOKEN=/, '$1__Host-XSRF-TOKEN='),
      );
    }
  });
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  beforeEach(() => {
    store.reset();
    sessionStorage.clear();
    document.cookie = `XSRF-TOKEN=${MOCK_XSRF_TOKEN}; path=/`;
  });
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  return { server, store };
}
