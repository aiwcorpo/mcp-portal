import { HttpResponse, http } from 'msw';
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
  const { server } = useMockApi();

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
    expect(row('OpenSearch').querySelector('button')).toBeNull();
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
});
