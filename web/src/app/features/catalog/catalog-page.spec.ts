import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed } from '@angular/core/testing';
import { HttpResponse, http } from 'msw';
import { useMockApi } from '../../../testing/mock-api';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';
import { PortalCatalog } from '../../api/generated';

describe('CatalogPage', () => {
  const { server } = useMockApi();

  function card(name: string): HTMLElement {
    const heading = Array.from(document.querySelectorAll('h2')).find(
      (h) => h.textContent?.trim() === name,
    );
    const article = heading?.closest('article');
    if (!article) {
      throw new Error(`no card ${name}`);
    }
    return article;
  }

  it('shows each server with its status and main action from the contract example', async () => {
    configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('GitLab'));

    expect(text(card('Jira'))).toContain('Połączono');
    expect(button('Kopiuj link (Jira)', card('Jira')).classList).toContain(
      'mat-mdc-unelevated-button',
    );
    expect(text(card('GitLab'))).toContain('Niepołączone');
    expect(button('Połącz przez OAuth (GitLab)', card('GitLab')).classList).toContain(
      'mat-mdc-unelevated-button',
    );
    expect(button('Dodaj token (GitLab)', card('GitLab'))).toBeTruthy();
    expect(text(card('Confluence'))).toContain('Wniosek w toku');
  });

  it('expands the tool list with risk, access and required entitlement', async () => {
    configureTestApp();
    const harness = await openRoute('/catalog');
    await until(() => expect(text()).toContain('Jira'));

    const toggle = button(/^Pokaż narzędzia \(1\/2\) \(Jira\)$/, card('Jira'));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await harness.fixture.whenStable();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const list = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(text(list!)).toContain('jira__delete_issue');
    expect(text(list!)).toContain('Ryzyko: Destrukcyjne');
    expect(text(list!)).toContain('Dostęp: Brak');
    expect(text(list!)).toContain('mcp-jira-destructive');
  });

  it('copies the server URL from the catalog', async () => {
    configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('Jira'));
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);

    button('Kopiuj link (Jira)').click();

    expect(copy).toHaveBeenCalledWith('https://mcp-gateway.internal/s/mcp-jira/mcp');
    await until(() => expect(text()).toContain('Skopiowano adres serwera Jira.'));
  });

  it('starts OAuth and sends the browser to the provider', async () => {
    const navigation = configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('GitLab'));

    button('Połącz przez OAuth (GitLab)').click();

    await until(() => expect(navigation.assign).toHaveBeenCalledOnce());
    expect(navigation.assign.mock.calls[0][0]).toMatch(
      /^https:\/\/gitlab\.internal\/oauth\/authorize\?/,
    );
  });

  it('shows the OAuth callback result and removes it from the URL', async () => {
    configureTestApp();
    const harness = await openRoute('/catalog?connected=gitlab');
    await until(() => expect(text()).toContain('Połączono konto GitLab.'));
    await until(() => expect(harness.routeNativeElement).toBeTruthy());
    expect(location.search).not.toContain('connected');
  });

  it('maps ?connectError= to a fixed message', async () => {
    configureTestApp();
    await openRoute('/catalog?connectError=identity_mismatch');
    await until(() =>
      expect(text()).toContain('Token należy do innego użytkownika niż zalogowany w portalu.'),
    );
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('shows an empty state when there are no servers', async () => {
    server.use(
      http.get('/api/v1/catalog', () => HttpResponse.json({ servers: [] } satisfies PortalCatalog)),
    );
    configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('Nie ma serwerów MCP do wyświetlenia.'));
  });

  it('shows a C10 message and never the backend text, and retries', async () => {
    server.use(
      http.get(
        '/api/v1/catalog',
        () =>
          HttpResponse.json(
            { error: 'upstream_unavailable', message: 'java.net.ConnectException: broker:8443' },
            { status: 503 },
          ),
        { once: true },
      ),
    );
    configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('Usługa jest chwilowo niedostępna.'));
    expect(text()).not.toContain('ConnectException');

    button('Spróbuj ponownie').click();
    await until(() => expect(text()).toContain('Jira'));
  });

  it('disconnects after confirmation and reloads the catalog', async () => {
    configureTestApp();
    const harness = await openRoute('/catalog');
    await until(() => expect(text()).toContain('Jira'));

    button('Odłącz (Jira)').click();
    await harness.fixture.whenStable();
    button('Odłącz', document.querySelector('mat-dialog-container')!).click();

    await until(() => expect(text()).toContain('Odłączono konto Jira.'));
    await until(() => expect(text(card('Jira'))).toContain('Niepołączone'));
  });
});
