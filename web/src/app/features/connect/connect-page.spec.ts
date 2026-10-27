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

  it('offers OAuth and a token form for GitLab, with token instructions', async () => {
    configureTestApp();
    await openRoute('/connect/gitlab');
    await until(() => expect(text()).toContain('Połącz konto: GitLab'));

    expect(text()).toContain('Połącz przez OAuth');
    expect(text()).toContain('Jak utworzyć możliwie wąski token');
    expect(text()).toContain('read_api');
    expect(tokenInput().type).toBe('password');
    expect(tokenInput().getAttribute('autocomplete')).toBe('new-password');
    expect(tokenInput().hasAttribute('maxlength')).toBe(false);
    expect(tokenInput().hasAttribute('data-1p-ignore')).toBe(true);
    expect(tokenInput().getAttribute('data-lpignore')).toBe('true');
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(dateInput().min).toBe(tomorrow);
  });

  it('on step_up_required clears the token and sends the user to MFA with a way back to the form', async () => {
    const navigation = configureTestApp();
    const harness = await openRoute('/connect/gitlab');
    await until(() => expect(tokenInput()).toBeTruthy());

    type(tokenInput(), 'glpat-test-value-0001');
    type(dateInput(), '2099-01-31');
    button('Zapisz token').click();

    await until(() => expect(text()).toContain('wymaga świeżego uwierzytelnienia (MFA)'));
    expect(tokenInput().value).toBe('');
    expect(text()).not.toContain('glpat-test-value-0001');

    button('Uwierzytelnij ponownie').click();
    const target = new URL(navigation.assign.mock.calls[0][0], location.origin);
    expect(target.pathname).toBe('/api/v1/auth/login');
    expect(target.searchParams.get('stepUp')).toBe('true');
    expect(target.searchParams.get('returnPath')).toBe(
      '/connect/gitlab?stepUp=done&expiresAt=2099-01-31',
    );
    harness.fixture.destroy();
  });

  it('after step-up keeps the date, asks for the token again and saves it', async () => {
    store.update({ mfaFresh: true });
    configureTestApp();
    await openRoute('/connect/gitlab?stepUp=done&expiresAt=2099-01-31');
    await until(() => expect(text()).toContain('Uwierzytelnienie odświeżone.'));
    expect(dateInput().value).toBe('2099-01-31');
    expect(tokenInput().value).toBe('');

    type(tokenInput(), 'glpat-test-value-0002');
    button('Zapisz token').click();

    await until(() => expect(text()).toContain('Połączono jako jkowalski.'));
    expect(text()).toContain('Token ważny do 31 stycznia 2099.');
    expect(tokenInput().value).toBe('');
    expect(store.state.connections.find((c) => c.system === 'gitlab')?.expiresAt).toBe(
      '2099-01-31T00:00:00Z',
    );
  });

  it('shows the system rejection without echoing the token', async () => {
    store.update({ mfaFresh: true });
    configureTestApp();
    await openRoute('/connect/gitlab');
    await until(() => expect(tokenInput()).toBeTruthy());

    type(tokenInput(), 'invalid-token-value');
    button('Zapisz token').click();

    await until(() => expect(text()).toContain('System odrzucił token.'));
    expect(tokenInput().value).toBe('');
    expect(text()).not.toContain('invalid-token-value');
  });

  it('validates required token and a future expiry date before sending', async () => {
    let requests = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PUT') {
        requests++;
      }
    });
    configureTestApp();
    await openRoute('/connect/gitlab');
    await until(() => expect(tokenInput()).toBeTruthy());

    type(dateInput(), '2001-01-01');
    button('Zapisz token').click();

    await until(() => expect(text()).toContain('Wklej token.'));
    expect(text()).toContain('Data musi być w przyszłości.');
    expect(requests).toBe(0);
  });

  it('trims the pasted token and rejects one made of whitespace or longer than 4096 characters', async () => {
    store.update({ mfaFresh: true });
    const bodies: string[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'PUT') {
        bodies.push(await request.clone().text());
      }
    });
    configureTestApp();
    await openRoute('/connect/gitlab');
    await until(() => expect(tokenInput()).toBeTruthy());

    type(tokenInput(), '   ');
    button('Zapisz token').click();
    await until(() => expect(text()).toContain('Wklej token.'));

    type(tokenInput(), 'x'.repeat(4097));
    button('Zapisz token').click();
    await until(() => expect(text()).toContain('Token jest za długi'));
    expect(tokenInput().value).toHaveLength(4097);
    expect(bodies).toEqual([]);

    type(tokenInput(), '  glpat-trimmed-0003\n');
    button('Zapisz token').click();
    await until(() => expect(text()).toContain('Połączono jako jkowalski.'));
    expect(JSON.parse(bodies[0]).secret).toBe('glpat-trimmed-0003');
  });

  it('maps a CSRF rejection to its message', async () => {
    store.update({ mfaFresh: true });
    configureTestApp();
    await openRoute('/connect/gitlab');
    await until(() => expect(tokenInput()).toBeTruthy());
    document.cookie = 'XSRF-TOKEN=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';

    type(tokenInput(), 'some-token');
    button('Zapisz token').click();

    await until(() => expect(text()).toContain('Formularz stracił ważność.'));
  });

  it('says there is nothing to connect when the catalog offers no way to connect', async () => {
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(text()).toContain('Tego systemu nie trzeba łączyć'));
    expect(tokenInput()).toBeNull();
  });

  it('reports an unknown system as not found', async () => {
    configureTestApp();
    await openRoute('/connect/sharepoint');
    await until(() =>
      expect(text()).toContain('Nie znaleziono zasobu albo nie masz do niego dostępu.'),
    );
  });
});

describe('connectOptions', () => {
  const server = (actions: PortalCatalogServer['actions']): PortalCatalogServer => ({
    serverId: 'mcp-jira',
    system: 'jira',
    version: '1.0.0',
    url: 'https://mcp-gateway.internal/s/mcp-jira/mcp',
    status: 'reconnect_required',
    actions,
    tools: [],
  });
  const connection = (type: 'user-oauth' | 'user-secret') => ({
    system: 'jira' as const,
    type,
    status: 'expired' as const,
    backendUser: 'jkowalski',
    expiresAt: null,
    connectedAt: '2026-10-01T08:00:00Z',
    lastUsedAt: null,
  });

  it('follows the catalog actions', () => {
    expect(connectOptions(server(['connect_oauth', 'add_secret']), undefined)).toEqual({
      oauth: true,
      token: true,
    });
    expect(connectOptions(server(['add_secret']), undefined)).toEqual({
      oauth: false,
      token: true,
    });
  });

  it('reconnects the same way the existing connection was made', () => {
    expect(connectOptions(server(['reconnect']), connection('user-oauth'))).toEqual({
      oauth: true,
      token: false,
    });
    expect(connectOptions(server(['reconnect']), connection('user-secret'))).toEqual({
      oauth: false,
      token: true,
    });
  });
});
