import { MOCK_XSRF_TOKEN } from '@aiwcorpo/mcp-contracts/msw';
import { setupServer } from 'msw/node';
import { MockStore, createMockHandlers } from '../mocks/portal-mock';

/**
 * MSW in unit tests: the same stateful handlers as the dev mock, over the contract handlers, with the
 * CSRF rule enforced. jsdom gets the XSRF-TOKEN cookie the BFF would set on GET /me.
 */
export function useMockApi() {
  const store = new MockStore();
  const server = setupServer(...createMockHandlers(store));

  // jsdom's XHR adds cookies after MSW intercepts, so hand the cookie jar to the handlers explicitly.
  server.events.on('request:start', ({ request }) => {
    if (!request.headers.has('cookie') && document.cookie) {
      request.headers.set('cookie', document.cookie);
    }
  });
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  beforeEach(() => {
    store.reset();
    document.cookie = `XSRF-TOKEN=${MOCK_XSRF_TOKEN}; path=/`;
  });
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  return { server, store };
}
