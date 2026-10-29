import { HttpResponse, http } from 'msw';
import { AuthenticatorStatus } from '../../api/generated';
import { connectionFixture, serverFixture, toolFixture } from '../../../testing/fixtures';
import { useMockApi } from '../../../testing/mock-api';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';
import { PortalCatalogServer } from '../../api/generated';

function row(name: string): HTMLElement {
  const header = Array.from(document.querySelectorAll('tbody th')).find(
    (th) => th.textContent?.trim() === name,
  );
  const tr = header?.closest('tr');
  if (!tr) {
    throw new Error(`no row ${name}`);
  }
  return tr;
}

function serve(servers: PortalCatalogServer[]) {
  return http.get('/api/v1/catalog', () => HttpResponse.json({ servers }));
}

describe('ConnectionsPage', () => {
  const { server, store } = useMockApi();

  it('lists every system from the catalog with account, validity and last use', async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
    server.use(
      serve([
        serverFixture('jira', {
          status: 'expiring',
          actions: ['copy_link', 'add_secret', 'disconnect'],
          connection: connectionFixture('jira', {
            type: 'user-secret',
            status: 'expiring',
            expiresAt: soon,
            lastUsedAt: new Date().toISOString(),
          }),
        }),
        serverFixture('gitlab', {
          status: 'connected',
          actions: ['copy_link', 'disconnect'],
          connection: connectionFixture('gitlab', {
            backendUser: 'anna.nowak',
            lastUsedAt: '2026-10-20T08:00:00Z',
          }),
        }),
        serverFixture('confluence', {
          status: 'reconnect_required',
          actions: ['reconnect', 'disconnect'],
          connection: connectionFixture('confluence', { status: 'revoked' }),
        }),
        serverFixture('servicedesk', {
          credential: { supportedTypes: ['service-account'], defaultType: 'service-account' },
        }),
        serverFixture('opensearch', {
          status: 'no_access',
          actions: ['request_access'],
          tools: [toolFixture('opensearch__q', { access: 'denied' })],
        }),
      ]),
    );
    configureTestApp();
    await openRoute('/connections');
    await until(() => expect(text()).toContain('Service Desk'));

    expect(text(row('Jira'))).toContain('Token PAT');
    expect(text(row('Jira'))).toContain('jkowalski');
    expect(text(row('Jira'))).toMatch(/\d{2}\.\d{2}\.\d{4} · za 5 dni/);
    expect(text(row('Jira'))).toMatch(/dziś \d{2}:\d{2}/);
    expect(button('Odnów (Jira)', row('Jira'))).toBeTruthy();
    expect(button('Rozłącz (Jira)', row('Jira'))).toBeTruthy();
    expect(text(row('GitLab'))).toContain('odświeżane automatycznie');
    expect(text(row('GitLab'))).toContain('20.10.2026');
    expect(text(row('Confluence'))).toContain('wymaga ponownego połączenia');
    expect(button('Połącz (Confluence)', row('Confluence'))).toBeTruthy();
    expect(text(row('Service Desk'))).toContain('Konto serwisowe');
    expect(row('Service Desk').querySelector('button')).toBeNull();
    expect(text(row('OpenSearch'))).toContain('brak uprawnienia');
    expect(button('Złóż wniosek (OpenSearch)', row('OpenSearch'))).toBeTruthy();
    expect(text(row('OpenSearch'))).not.toContain('Dodaj token');
    expect(text()).toContain('Ostatnie użycie');
  });

  it('disconnects after confirmation and reloads', async () => {
    configureTestApp();
    const harness = await openRoute('/connections');
    await until(() => expect(text()).toContain('Jira'));

    button('Rozłącz (Jira)').click();
    await harness.fixture.whenStable();
    const dialog = document.querySelector('mat-dialog-container')!;
    expect(text(dialog)).toContain('Rozłączyć konto Jira?');
    button('Rozłącz', dialog).click();

    await until(() => expect(text()).toContain('Rozłączono konto Jira.'));
    await until(() => expect(text(row('Jira'))).toContain('Dodaj token'));
  });

  it('keeps the connection when the dialog is cancelled', async () => {
    configureTestApp();
    const harness = await openRoute('/connections');
    await until(() => expect(text()).toContain('Jira'));

    button('Rozłącz (Jira)').click();
    await harness.fixture.whenStable();
    button('Anuluj', document.querySelector('mat-dialog-container')!).click();

    await until(() => expect(document.querySelector('mat-dialog-container')).toBeNull());
    expect(text()).not.toContain('Rozłączono');
  });

  it('shows the C10 message, the request id, and retries', async () => {
    server.use(
      http.get(
        '/api/v1/catalog',
        () =>
          HttpResponse.json(
            { error: 'upstream_unavailable', requestId: 'abcdef12-0000-0000-0000-000000000000' },
            { status: 503 },
          ),
        { once: true },
      ),
    );
    configureTestApp();
    await openRoute('/connections');
    await until(() => expect(text()).toContain('Usługa jest chwilowo niedostępna.'));
    expect(text()).toContain('abcdef12');

    button('Odśwież').click();
    await until(() => expect(text()).toContain('Jira'));
  });

  it('shows an empty state', async () => {
    server.use(serve([]));
    configureTestApp();
    await openRoute('/connections');
    await until(() => expect(text()).toContain('Nie masz jeszcze żadnych połączeń'));
  });

  describe('last use of a service account', () => {
    function lastUseCell(): string {
      return row('Service Desk').querySelectorAll('td')[3].textContent!.trim();
    }

    it('comes from the newest call in the activity log', async () => {
      const queries: URLSearchParams[] = [];
      server.events.on('request:start', ({ request }) => {
        const url = new URL(request.url);
        if (url.pathname === '/api/v1/activity/calls') {
          queries.push(url.searchParams);
        }
      });
      configureTestApp();
      await openRoute('/connections');
      await until(() => expect(text()).toContain('Service Desk'));
      await until(() => expect(lastUseCell()).toMatch(/\d{2}\.\d{2}\.\d{4}|dziś \d{2}:\d{2}/));
      expect(queries.map((query) => query.get('q'))).toEqual(['servicedesk__']);
      expect(queries[0].get('limit')).toBe('20');
    });

    it('skips calls of other systems that only match by resource id, and calls refused before the system', async () => {
      server.use(
        http.get('/api/v1/activity/calls', () =>
          HttpResponse.json([
            {
              requestId: '0192d1b2-7c3a-7d4e-8f10-000000000001',
              ts: '2026-10-28T10:00:00.000Z',
              tool: 'gitlab__get_project',
              result: 'ok',
              resource: { type: 'GitLab::Project', id: 'group/servicedesk__tools' },
            },
            {
              requestId: '0192d1b2-7c3a-7d4e-8f10-000000000002',
              ts: '2026-10-28T09:00:00.000Z',
              tool: 'servicedesk__get_ticket',
              result: 'denied_not_granted',
            },
            {
              requestId: '0192d1b2-7c3a-7d4e-8f10-000000000003',
              ts: '2026-10-20T08:00:00.000Z',
              tool: 'servicedesk__get_ticket',
              result: 'ok',
            },
          ]),
        ),
      );
      configureTestApp();
      await openRoute('/connections');
      await until(() => expect(text()).toContain('Service Desk'));
      await until(() => expect(lastUseCell()).toBe('20.10.2026'));
    });

    it('stays empty, without an error, when the log cannot be read', async () => {
      server.use(
        http.get('/api/v1/activity/calls', () =>
          HttpResponse.json({ error: 'upstream_unavailable' }, { status: 503 }),
        ),
      );
      configureTestApp();
      await openRoute('/connections');
      await until(() => expect(text()).toContain('Service Desk'));
      expect(lastUseCell()).toBe('—');
      expect(text()).not.toContain('Nie udało się pobrać danych');
    });
  });

  describe('Authenticator section', () => {
    async function open(status: AuthenticatorStatus) {
      store.update({ authenticator: status });
      const navigation = configureTestApp();
      const harness = await openRoute('/connections');
      await until(() => expect(text()).toContain('MCP Platform'));
      return { navigation, harness };
    }

    it('offers registration when there is none', async () => {
      await open({ state: 'none' });
      expect(text()).toContain('Konto "MCP Platform" w Microsoft Authenticator.');
      expect(text()).toContain('Nie zarejestrowano');
      expect(document.querySelector('app-authenticator-section a')?.getAttribute('href')).toBe(
        '/authenticator/register',
      );
      expect(text()).not.toContain('Usuń');
    });

    it('shows an active registration with its dates and a removal button', async () => {
      await open({
        state: 'active',
        registeredAt: '2026-10-27T09:00:00Z',
        lastUsedAt: new Date().toISOString(),
      });
      expect(text()).toMatch(/Aktywny · od 27\.10\.2026 · ostatnie użycie dziś \d{2}:\d{2}/);
      expect(button('Usuń')).toBeTruthy();
    });

    it('says when an active registration was never used', async () => {
      await open({ state: 'active', registeredAt: '2026-10-27T09:00:00Z' });
      expect(text()).toContain('jeszcze nieużywany');
    });

    it('shows the end of a block, without an unlock action', async () => {
      await open({
        state: 'active',
        registeredAt: '2026-10-27T09:00:00Z',
        lockedUntil: new Date(Date.now() + 600_000).toISOString(),
      });
      expect(text()).toMatch(/Zablokowany do \d{2}:\d{2} · 5 błędnych kodów w 15 minut/);
      expect(text()).toContain('Blokadę zdejmuje tylko upływ czasu.');
      expect(text()).not.toMatch(/Odblokuj/);
      expect(button('Usuń')).toBeTruthy();
    });

    it('shows a switched-off authenticator with the banner and the single action', async () => {
      await open({
        state: 'disabled',
        registeredAt: '2026-10-27T09:00:00Z',
        disabledAt: '2026-10-28T11:00:00Z',
        disabledReason: 'daily_failure_limit',
      });
      expect(text()).toContain(
        'Authenticator został wyłączony po 20 błędnych kodach w ciągu doby.',
      );
      expect(text()).toContain('Wyłączony · 28.10.2026');
      expect(document.querySelector('app-authenticator-section a')?.textContent).toContain(
        'Zarejestruj ponownie',
      );
      expect(text()).not.toContain('Usuń');
    });

    it('removes the registration after a warning and a fresh MFA', async () => {
      store.update({ mfaFresh: true });
      const { harness } = await open({ state: 'active', registeredAt: '2026-10-27T09:00:00Z' });
      button('Usuń').click();
      await harness.fixture.whenStable();
      const dialog = document.querySelector('mat-dialog-container')!;
      expect(text(dialog)).toContain('Usunąć Authenticator?');
      expect(text(dialog)).toContain(
        'Bez Authenticatora agent nie wykona operacji nieodwracalnych.',
      );
      expect(text(dialog)).toContain('Usunięcie wymaga potwierdzenia tożsamości (MFA).');
      button('Usuń', dialog).click();

      await until(() => expect(text()).toContain('Authenticator usunięty.'));
      await until(() => expect(text()).toContain('Nie zarejestrowano'));
      expect(store.state.authenticator.state).toBe('none');
    });

    it('keeps the registration when the warning is cancelled', async () => {
      const { harness } = await open({ state: 'active', registeredAt: '2026-10-27T09:00:00Z' });
      button('Usuń').click();
      await harness.fixture.whenStable();
      button('Anuluj', document.querySelector('mat-dialog-container')!).click();
      await until(() => expect(document.querySelector('mat-dialog-container')).toBeNull());
      expect(store.state.authenticator.state).toBe('active');
    });

    it('asks the IdP for a fresh MFA first and returns to this page', async () => {
      const { navigation, harness } = await open({
        state: 'active',
        registeredAt: '2026-10-27T09:00:00Z',
      });
      button('Usuń').click();
      await harness.fixture.whenStable();
      button('Usuń', document.querySelector('mat-dialog-container')!).click();

      await until(() => expect(navigation.assign).toHaveBeenCalled());
      const target = new URL(navigation.assign.mock.calls[0][0], location.origin);
      expect(target.searchParams.get('stepUp')).toBe('true');
      expect(target.searchParams.get('returnPath')).toBe('/connections?mfa=ok');
      expect(store.state.authenticator.state).toBe('active');
    });

    it('tells the user the MFA counted after the return', async () => {
      store.update({ authenticator: { state: 'active', registeredAt: '2026-10-27T09:00:00Z' } });
      configureTestApp();
      await openRoute('/connections?mfa=ok');
      await until(() => expect(text()).toContain('Tożsamość potwierdzona.'));
    });

    it('shows one error for the whole page when the registration cannot be read', async () => {
      server.use(
        http.get('/api/v1/authenticator', () =>
          HttpResponse.json({ error: 'upstream_unavailable' }, { status: 503 }),
        ),
      );
      configureTestApp();
      await openRoute('/connections');
      await until(() => expect(text()).toContain('Usługa jest chwilowo niedostępna.'));
      expect(document.querySelector('table')).toBeNull();
    });
  });
});
