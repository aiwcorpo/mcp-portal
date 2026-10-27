import { HttpResponse, http } from 'msw';
import { useMockApi } from '../../../testing/mock-api';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';

describe('ConnectionsPage', () => {
  const { server, store } = useMockApi();

  it('lists connections with type, account, dates and no secret value', async () => {
    configureTestApp();
    await openRoute('/connections');
    await until(() => expect(document.querySelector('tbody tr')).toBeTruthy());

    const row = text(document.querySelector('tbody tr')!);
    expect(row).toContain('Jira');
    expect(row).toContain('Token');
    expect(row).toContain('jkowalski');
    expect(row).toContain('Aktywne');
    expect(row).toContain('31 sty 2027');
    expect(button('Odłącz (Jira)')).toBeTruthy();
  });

  it('shows an empty state with a way to the catalog', async () => {
    store.update({ connections: [] });
    configureTestApp();
    await openRoute('/connections');
    await until(() => expect(text()).toContain('Nie masz połączonych kont.'));
    expect(document.querySelector('a[href="/catalog"]')).toBeTruthy();
  });

  it('shows a C10 error with retry', async () => {
    server.use(
      http.get(
        '/api/v1/connections',
        () => HttpResponse.json({ error: 'rate_limited', retryAfterSeconds: 30 }, { status: 429 }),
        {
          once: true,
        },
      ),
    );
    configureTestApp();
    await openRoute('/connections');
    await until(() => expect(text()).toContain('Spróbuj ponownie za 30 s.'));
    button('Spróbuj ponownie').click();
    await until(() => expect(document.querySelector('tbody tr')).toBeTruthy());
  });

  it('disconnects after confirmation', async () => {
    configureTestApp();
    const harness = await openRoute('/connections');
    await until(() => expect(document.querySelector('tbody tr')).toBeTruthy());

    button('Odłącz (Jira)').click();
    await harness.fixture.whenStable();
    button('Odłącz', document.querySelector('mat-dialog-container')!).click();

    await until(() => expect(text()).toContain('Odłączono konto Jira.'));
    await until(() => expect(text()).toContain('Nie masz połączonych kont.'));
    expect(store.state.connections).toEqual([]);
  });

  it('keeps the connection when the dialog is cancelled', async () => {
    configureTestApp();
    const harness = await openRoute('/connections');
    await until(() => expect(document.querySelector('tbody tr')).toBeTruthy());

    button('Odłącz (Jira)').click();
    await harness.fixture.whenStable();
    button('Anuluj', document.querySelector('mat-dialog-container')!).click();
    await harness.fixture.whenStable();

    expect(store.state.connections).toHaveLength(1);
  });
});
