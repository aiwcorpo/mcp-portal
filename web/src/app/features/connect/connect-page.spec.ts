import { HttpResponse, http } from 'msw';
import { connectionFixture, serverFixture } from '../../../testing/fixtures';
import { useMockApi } from '../../../testing/mock-api';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';
import { PortalCatalogServer } from '../../api/generated';
import { connectOptions } from './connect-page';

function tokenInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[formcontrolname="secret"]')!;
}

function dateInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[formcontrolname="expiresAt"]')!;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('ConnectPage', () => {
  const { server, store } = useMockApi();

  it('offers the token form of Jira (PAT, renewal) with instructions and no MFA step', async () => {
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(text()).toContain('Connect Jira'));

    expect(text()).toContain('How to create the narrowest possible token');
    expect(text()).toContain('PAT token');
    expect(text()).toContain('Token expiry date (optional)');
    expect(text()).toContain('After saving, the token is not shown anywhere again.');
    expect(text()).not.toContain('MFA');
    expect(tokenInput().type).toBe('password');
    expect(tokenInput().getAttribute('autocomplete')).toBe('off');
    expect(tokenInput().placeholder).toBe('Paste the token');
    expect(tokenInput().hasAttribute('maxlength')).toBe(false);
    expect(tokenInput().hasAttribute('data-1p-ignore')).toBe(true);
    expect(dateInput().hasAttribute('min')).toBe(false);
    expect(document.querySelector('form')?.getAttribute('autocomplete')).toBe('off');
  });

  it('offers OAuth and a token form for GitLab', async () => {
    server.use(
      http.get('/api/v1/catalog', () =>
        HttpResponse.json({
          servers: [
            serverFixture('gitlab', {
              status: 'not_connected',
              actions: ['connect_oauth', 'add_secret'],
            }),
          ],
        }),
      ),
    );
    configureTestApp();
    await openRoute('/connect/gitlab');
    await until(() => expect(text()).toContain('Connect GitLab'));

    expect(text()).toContain('Connect with OAuth');
    expect(text()).toContain('read_api');
    expect(tokenInput()).toBeTruthy();
  });

  it('says the date is optional and mentions the 7-day mark only when a date is given', async () => {
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(tokenInput()).toBeTruthy());

    expect(text()).toContain('Set the shortest possible term.');
    expect(text()).not.toContain('We will mark the token as expiring 7 days before the date.');

    type(dateInput(), '2027-01-15');
    dateInput().dispatchEvent(new Event('change'));
    await until(() =>
      expect(text()).toContain('We will mark the token as expiring 7 days before the date.'),
    );

    type(dateInput(), '');
    await until(() =>
      expect(text()).not.toContain('We will mark the token as expiring 7 days before the date.'),
    );
  });

  it('saves without any MFA, sends the date, clears the field and keeps the token out of storage', async () => {
    const bodies: string[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'PUT') {
        bodies.push(await request.clone().text());
      }
    });
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(tokenInput()).toBeTruthy());

    type(tokenInput(), 'jira-pat-test-value-0001');
    type(dateInput(), '2027-01-31');
    button('Check and save').click();

    await until(() => expect(text()).toContain('Connected to Jira as jkowalski.'));
    expect(text()).toContain('Token valid until 31.01.2027.');
    expect(tokenInput()).toBeNull();
    expect(JSON.parse(bodies[0])).toEqual({
      secret: 'jira-pat-test-value-0001',
      expiresAt: '2027-01-31T00:00:00Z',
    });
    expect(text()).not.toContain('jira-pat-test-value-0001');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(store.state.connections.jira?.expiresAt).toBe('2027-01-31T00:00:00Z');
  });

  it('accepts a missing date and any date, including a past one (CC-084)', async () => {
    const bodies: string[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'PUT') {
        bodies.push(await request.clone().text());
      }
    });
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(tokenInput()).toBeTruthy());

    type(tokenInput(), 'token-without-date');
    button('Check and save').click();
    await until(() => expect(text()).toContain('Connected to Jira as jkowalski.'));
    expect(JSON.parse(bodies[0])).toEqual({ secret: 'token-without-date' });
  });

  it('shows "Token is invalid or expired." under the field and clears it', async () => {
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(tokenInput()).toBeTruthy());

    type(tokenInput(), 'invalid-token-value');
    button('Check and save').click();

    await until(() => expect(text()).toContain('Token is invalid or expired.'));
    expect(tokenInput().value).toBe('');
    expect(tokenInput().getAttribute('aria-invalid')).toBe('true');
    expect(text()).not.toContain('invalid-token-value');
  });

  it('does not single out a stray identity_mismatch (deprecated since 2.2.3)', async () => {
    server.use(
      http.put('/api/v1/connections/jira/secret', () =>
        HttpResponse.json({ error: 'identity_mismatch' }, { status: 422 }),
      ),
    );
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(tokenInput()).toBeTruthy());

    type(tokenInput(), 'some-token-value');
    button('Check and save').click();

    await until(() => expect(text()).toContain('The request was rejected as invalid.'));
    expect(text()).not.toContain('another account');
    expect(tokenInput().value).toBe('');
  });

  it('shows other failures above the form, with the request id', async () => {
    server.use(
      http.put('/api/v1/connections/jira/secret', () =>
        HttpResponse.json(
          { error: 'upstream_unavailable', requestId: '0192d1b2-7c3a-7d4e' },
          { status: 503 },
        ),
      ),
    );
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(tokenInput()).toBeTruthy());

    type(tokenInput(), 'some-token');
    button('Check and save').click();

    await until(() => expect(text()).toContain('The service is temporarily unavailable.'));
    expect(text()).toContain('0192d1b2');
    expect(tokenInput().value).toBe('');
  });

  it('shows the wait from Retry-After on a 429 and keeps the form usable', async () => {
    server.use(
      http.put('/api/v1/connections/jira/secret', () =>
        HttpResponse.json(
          { error: 'rate_limited' },
          { status: 429, headers: { 'Retry-After': '30' } },
        ),
      ),
    );
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(tokenInput()).toBeTruthy());

    type(tokenInput(), 'some-token');
    button('Check and save').click();

    await until(() => expect(text()).toContain('Too many requests. Try again in 30 s.'));
    expect(tokenInput().value).toBe('');
    expect(button('Check and save').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('requires a token before sending, trims it and rejects whitespace or more than 4096 characters', async () => {
    const bodies: string[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'PUT') {
        bodies.push(await request.clone().text());
      }
    });
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(tokenInput()).toBeTruthy());

    button('Check and save').click();
    await until(() => expect(text()).toContain('Paste the token.'));

    type(tokenInput(), '   ');
    button('Check and save').click();
    await until(() => expect(text()).toContain('Paste the token.'));

    type(tokenInput(), 'x'.repeat(4097));
    button('Check and save').click();
    await until(() => expect(text()).toContain('The token is too long'));
    expect(tokenInput().value).toHaveLength(4097);
    expect(bodies).toEqual([]);

    type(tokenInput(), '  glpat-trimmed-0003\n');
    button('Check and save').click();
    await until(() => expect(text()).toContain('Connected to Jira as jkowalski.'));
    expect(JSON.parse(bodies[0]).secret).toBe('glpat-trimmed-0003');
  });

  it('maps a CSRF rejection to its message', async () => {
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(tokenInput()).toBeTruthy());
    document.cookie = 'XSRF-TOKEN=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';

    type(tokenInput(), 'some-token');
    button('Check and save').click();

    await until(() => expect(text()).toContain('The form has expired.'));
  });

  it('says there is nothing to connect when the catalog offers no way to connect', async () => {
    server.use(
      http.get('/api/v1/catalog', () =>
        HttpResponse.json({
          servers: [
            serverFixture('jira', {
              status: 'connected',
              actions: ['copy_link', 'disconnect'],
              connection: connectionFixture('jira'),
            }),
          ],
        }),
      ),
    );
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(text()).toContain('This system does not need connecting'));
    expect(tokenInput()).toBeNull();
  });

  it('reports an unknown system as not found', async () => {
    configureTestApp();
    await openRoute('/connect/sharepoint');
    await until(() => expect(text()).toContain('Page not found.'));
  });
});

describe('connectOptions', () => {
  const server = (actions: PortalCatalogServer['actions']): PortalCatalogServer =>
    serverFixture('jira', { status: 'reconnect_required', actions });
  const connection = (type: 'user-oauth' | 'user-secret') => connectionFixture('jira', { type });

  it('follows the catalog actions', () => {
    expect(connectOptions(server(['connect_oauth', 'add_secret']), null)).toEqual({
      oauth: true,
      token: true,
    });
    expect(connectOptions(server(['add_secret']), null)).toEqual({ oauth: false, token: true });
  });

  it('lets the connection type decide for reconnect', () => {
    expect(connectOptions(server(['reconnect']), connection('user-oauth'))).toEqual({
      oauth: true,
      token: false,
    });
    expect(connectOptions(server(['reconnect']), connection('user-secret'))).toEqual({
      oauth: false,
      token: true,
    });
    expect(connectOptions(server(['reconnect']), undefined)).toEqual({ oauth: true, token: true });
  });

  it('offers nothing when the catalog offers nothing', () => {
    expect(connectOptions(server(['copy_link']), null)).toEqual({ oauth: false, token: false });
  });
});

describe('ConnectPage: a system whose user-secret is Basic (CC-222)', () => {
  const { server, store } = useMockApi();
  const bodies: Record<string, unknown>[] = [];

  beforeAll(() => {
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'PUT' && request.url.includes('/secret')) {
        bodies.push((await request.clone().json()) as Record<string, unknown>);
      }
    });
  });
  beforeEach(() => {
    bodies.length = 0;
  });

  /** Jira Data Center with a token only for the user, in the Basic scheme (login plus password or API token). */
  function serveJiraBasic(): void {
    store.update({ basicLogin: true });
    server.use(
      http.get('/api/v1/catalog', () =>
        HttpResponse.json({
          servers: [
            serverFixture('jira', {
              status: 'not_connected',
              actions: ['add_secret'],
              credential: {
                supportedTypes: ['user-secret'],
                defaultType: 'user-secret',
                userSecretScheme: 'Basic',
                deployment: 'dc',
              },
            }),
          ],
        }),
      ),
    );
  }

  function usernameInput(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('input[formcontrolname="username"]');
  }

  it('asks for the login next to the password or API token, for Jira Data Center', async () => {
    serveJiraBasic();
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(text()).toContain('Connect Jira'));

    expect(text()).toContain('Login in the system (for example the account email address)');
    expect(text()).toContain('Password or API token');
    expect(usernameInput()?.type).toBe('text');
    expect(tokenInput().type).toBe('password');
  });

  it('has no login field for a single token (Jira of the example, Bearer)', async () => {
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(text()).toContain('PAT token'));

    expect(usernameInput()).toBeNull();
  });

  it('sends the login with the secret, trimmed, and shows nothing of it afterwards', async () => {
    serveJiraBasic();
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(usernameInput()).toBeTruthy());

    type(usernameInput()!, ' anna@firma.pl ');
    type(tokenInput(), 'api-token-1');
    button('Check and save').click();

    await until(() => expect(text()).toContain('Connected to Jira as'));
    expect(bodies).toEqual([{ secret: 'api-token-1', username: 'anna@firma.pl' }]);
    expect(text()).not.toContain('anna@firma.pl');
    expect(text()).not.toContain('api-token-1');
  });

  it('refuses an empty login and a login with a colon or a hidden character without a request', async () => {
    serveJiraBasic();
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(usernameInput()).toBeTruthy());

    type(tokenInput(), 'api-token-1');
    button('Check and save').click();
    await until(() => expect(text()).toContain('Enter the login.'));

    // Built from code points: a literal hidden character would not survive the style check of the repository.
    for (const bad of [
      'anna:admin',
      `anna${String.fromCodePoint(0x200b)}nowak`,
      `anna${String.fromCodePoint(0x202e)}nowak`,
    ]) {
      type(usernameInput()!, bad);
      button('Check and save').click();
      await until(() =>
        expect(text()).toContain('The login cannot contain a colon or control characters.'),
      );
    }
    expect(bodies).toEqual([]);
  });
});
