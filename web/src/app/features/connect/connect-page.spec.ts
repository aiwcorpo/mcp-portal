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
    await until(() => expect(text()).toContain('Połącz Jira'));

    expect(text()).toContain('Jak utworzyć możliwie wąski token');
    expect(text()).toContain('Token PAT');
    expect(text()).toContain('Data wygaśnięcia tokenu (opcjonalnie)');
    expect(text()).toContain('Po zapisie token nie jest już nigdzie wyświetlany.');
    expect(text()).not.toContain('MFA');
    expect(tokenInput().type).toBe('password');
    expect(tokenInput().getAttribute('autocomplete')).toBe('off');
    expect(tokenInput().placeholder).toBe('Wklej token');
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
    await until(() => expect(text()).toContain('Połącz GitLab'));

    expect(text()).toContain('Połącz przez OAuth');
    expect(text()).toContain('read_api');
    expect(tokenInput()).toBeTruthy();
  });

  it('says the date is optional and mentions the 7-day mark only when a date is given', async () => {
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(tokenInput()).toBeTruthy());

    expect(text()).toContain('Ustaw najkrótszy możliwy termin.');
    expect(text()).not.toContain('Oznaczymy token jako wygasający 7 dni przed terminem.');

    type(dateInput(), '2027-01-15');
    dateInput().dispatchEvent(new Event('change'));
    await until(() =>
      expect(text()).toContain('Oznaczymy token jako wygasający 7 dni przed terminem.'),
    );

    type(dateInput(), '');
    await until(() =>
      expect(text()).not.toContain('Oznaczymy token jako wygasający 7 dni przed terminem.'),
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
    button('Sprawdź i zapisz').click();

    await until(() => expect(text()).toContain('Połączono z Jira jako jkowalski.'));
    expect(text()).toContain('Token ważny do 31.01.2027.');
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
    button('Sprawdź i zapisz').click();
    await until(() => expect(text()).toContain('Połączono z Jira jako jkowalski.'));
    expect(JSON.parse(bodies[0])).toEqual({ secret: 'token-without-date' });
  });

  it('shows "Token nieprawidłowy albo wygasł." under the field and clears it', async () => {
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(tokenInput()).toBeTruthy());

    type(tokenInput(), 'invalid-token-value');
    button('Sprawdź i zapisz').click();

    await until(() => expect(text()).toContain('Token nieprawidłowy albo wygasł.'));
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
    button('Sprawdź i zapisz').click();

    await until(() => expect(text()).toContain('Żądanie zostało odrzucone jako niepoprawne.'));
    expect(text()).not.toContain('innego konta');
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
    button('Sprawdź i zapisz').click();

    await until(() => expect(text()).toContain('Usługa jest chwilowo niedostępna.'));
    expect(text()).toContain('0192d1b2');
    expect(tokenInput().value).toBe('');
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

    button('Sprawdź i zapisz').click();
    await until(() => expect(text()).toContain('Wklej token.'));

    type(tokenInput(), '   ');
    button('Sprawdź i zapisz').click();
    await until(() => expect(text()).toContain('Wklej token.'));

    type(tokenInput(), 'x'.repeat(4097));
    button('Sprawdź i zapisz').click();
    await until(() => expect(text()).toContain('Token jest za długi'));
    expect(tokenInput().value).toHaveLength(4097);
    expect(bodies).toEqual([]);

    type(tokenInput(), '  glpat-trimmed-0003\n');
    button('Sprawdź i zapisz').click();
    await until(() => expect(text()).toContain('Połączono z Jira jako jkowalski.'));
    expect(JSON.parse(bodies[0]).secret).toBe('glpat-trimmed-0003');
  });

  it('maps a CSRF rejection to its message', async () => {
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(tokenInput()).toBeTruthy());
    document.cookie = 'XSRF-TOKEN=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';

    type(tokenInput(), 'some-token');
    button('Sprawdź i zapisz').click();

    await until(() => expect(text()).toContain('Formularz stracił ważność.'));
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
    await until(() => expect(text()).toContain('Tego systemu nie trzeba łączyć'));
    expect(tokenInput()).toBeNull();
  });

  it('reports an unknown system as not found', async () => {
    configureTestApp();
    await openRoute('/connect/sharepoint');
    await until(() => expect(text()).toContain('Nie ma takiej strony.'));
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
