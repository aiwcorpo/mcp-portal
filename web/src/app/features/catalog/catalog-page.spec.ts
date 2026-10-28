import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HttpResponse, http } from 'msw';
import { connectionFixture, serverFixture, toolFixture } from '../../../testing/fixtures';
import { useMockApi } from '../../../testing/mock-api';
import {
  button,
  configureTestApp,
  labelled,
  openRoute,
  text,
  until,
} from '../../../testing/test-app';
import { CatalogStatus, PortalCatalogServer } from '../../api/generated';

function row(name: string): HTMLElement {
  const header = Array.from(document.querySelectorAll('tbody th')).find(
    (th) => th.textContent?.trim() === name,
  );
  const body = header?.closest('tbody');
  if (!body) {
    throw new Error(`no row ${name}`);
  }
  return body;
}

function serve(servers: PortalCatalogServer[]) {
  return http.get('/api/v1/catalog', () => HttpResponse.json({ servers }));
}

describe('CatalogPage', () => {
  const { server, store } = useMockApi();

  it('shows the example rows of the contract with status text and actions', async () => {
    configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('GitLab'));

    expect(text(row('Jira'))).toContain('Token wygasa za 5 dni');
    expect(text(row('Jira'))).toContain('Token PAT');
    expect(text(row('Jira'))).toContain('5 narz.');
    expect(button('Odnów (Jira)', row('Jira')).classList).toContain('mat-mdc-unelevated-button');
    expect(button('Kopiuj link (Jira)', row('Jira'))).toBeTruthy();
    expect(text(row('GitLab'))).toContain('Wymaga ponownego połączenia');
    expect(button('Połącz (GitLab)', row('GitLab'))).toBeTruthy();
    expect(text(row('Confluence'))).toContain('Brak uprawnienia');
    expect(text(row('Confluence'))).not.toContain('Złóż wniosek');
    expect(text(row('Service Desk'))).toContain('Konto serwisowe');
    expect(text(row('Service Desk'))).toContain('Połączone');
    expect(document.body.textContent).not.toContain('Rozłącz');
  });

  describe('Authenticator banner', () => {
    const destructive = serverFixture('jira', {
      tools: [
        toolFixture('jira__delete_issue', {
          risk: 'DESTRUCTIVE',
          action: 'delete',
          requiresConfirmation: true,
        }),
      ],
    });

    it('asks to register when a tool needs a code and there is no registration', async () => {
      server.use(serve([destructive]));
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text()).toContain('Zarejestruj Authenticator'));
      expect(text()).toContain(
        'Narzędzia "Usuwanie" wymagają kodu z Authenticatora, a nie masz go jeszcze zarejestrowanego.',
      );
      const link = Array.from(document.querySelectorAll('app-authenticator-banner a')).find(
        (candidate) => candidate.textContent?.includes('Zarejestruj Authenticator'),
      );
      expect(link?.getAttribute('href')).toBe('/authenticator/register');
    });

    it('offers to register again when the daily limit switched it off', async () => {
      store.update({
        authenticator: {
          state: 'disabled',
          registeredAt: '2026-10-27T09:00:00Z',
          disabledAt: '2026-10-28T11:00:00Z',
          disabledReason: 'daily_failure_limit',
        },
      });
      server.use(serve([destructive]));
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text()).toContain('Zarejestruj ponownie'));
      expect(text()).toContain('wyłączony po 20 błędnych kodach w ciągu doby');
    });

    it('names the end of a block and offers no unlock', async () => {
      store.update({
        authenticator: {
          state: 'active',
          registeredAt: '2026-10-27T09:00:00Z',
          lockedUntil: '2026-10-28T14:35:00Z',
        },
      });
      server.use(serve([destructive]));
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text()).toMatch(/zablokowany do \d{2}:\d{2} po 5 błędnych kodach/));
      expect(text()).not.toContain('Zarejestruj');
      expect(text()).not.toContain('Odblokuj');
    });

    it('stays away when the registration is active or no tool needs a code', async () => {
      store.update({ authenticator: { state: 'active', registeredAt: '2026-10-27T09:00:00Z' } });
      server.use(serve([destructive]));
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text()).toContain('Jira'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(text()).not.toContain('Authenticator jest');
      expect(text()).not.toContain('Zarejestruj');
    });

    it('stays away when no tool needs a code', async () => {
      server.use(serve([serverFixture('jira')]));
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text()).toContain('Jira'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(text()).not.toContain('Zarejestruj');
    });

    it('does not break the catalog when the registration cannot be read', async () => {
      server.use(
        serve([destructive]),
        http.get('/api/v1/authenticator', () =>
          HttpResponse.json({ error: 'upstream_unavailable' }, { status: 503 }),
        ),
      );
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text()).toContain('Jira'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(text()).not.toContain('Zarejestruj');
      expect(text()).not.toContain('Nie udało się pobrać danych');
    });
  });

  describe('every status of a row', () => {
    const cases: [CatalogStatus, PortalCatalogServer, string, string[]][] = [
      [
        'connected',
        serverFixture('jira', {
          status: 'connected',
          actions: ['copy_link', 'disconnect'],
          connection: connectionFixture('jira'),
        }),
        'Połączone',
        ['Kopiuj link (Jira)'],
      ],
      [
        'expiring',
        serverFixture('jira', {
          status: 'expiring',
          actions: ['copy_link', 'reconnect', 'disconnect'],
          connection: connectionFixture('jira', {
            status: 'expiring',
            expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          }),
        }),
        'Połączenie wygasa za 3 dni',
        ['Połącz (Jira)', 'Kopiuj link (Jira)'],
      ],
      [
        'reconnect_required',
        serverFixture('jira', {
          status: 'reconnect_required',
          actions: ['add_secret', 'disconnect'],
          connection: connectionFixture('jira', { type: 'user-secret', status: 'expired' }),
        }),
        'Wymaga ponownego połączenia',
        ['Odnów (Jira)'],
      ],
      [
        'not_connected',
        serverFixture('jira', {
          status: 'not_connected',
          actions: ['connect_oauth', 'add_secret'],
        }),
        'Niepołączone',
        ['Połącz przez OAuth (Jira)', 'Dodaj token (Jira)'],
      ],
      [
        'request_pending',
        serverFixture('jira', {
          status: 'request_pending',
          actions: ['view_request'],
          tools: [toolFixture('jira__get', { access: 'denied' })],
        }),
        'Wniosek oczekuje',
        [],
      ],
      [
        'no_access',
        serverFixture('jira', {
          status: 'no_access',
          actions: ['request_access'],
          tools: [toolFixture('jira__get', { access: 'denied' })],
        }),
        'Brak uprawnienia',
        [],
      ],
    ];

    it.each(cases)('%s', async (_status, catalogServer, statusText, buttons) => {
      server.use(serve([catalogServer]));
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text(row('Jira'))).toContain(statusText));

      const labels = Array.from(row('Jira').querySelectorAll('td button.mat-mdc-button-base')).map(
        (candidate) => text(candidate).trim(),
      );
      expect(labels).toEqual(buttons);
    });
  });

  it('expands the tools of a server: id, title, entitlement, risk and notes', async () => {
    server.use(
      serve([
        serverFixture('jira', {
          tools: [
            toolFixture('jira__search_issues', {
              title: 'Wyszukiwanie zgłoszeń (JQL)',
              requiredEntitlements: ['mcp-jira-read'],
            }),
            toolFixture('jira__delete_issue', {
              title: 'Usunięcie zgłoszenia',
              risk: 'DESTRUCTIVE',
              action: 'delete',
              requiresConfirmation: true,
              requiredEntitlements: ['mcp-jira-destructive'],
            }),
            toolFixture('jira__move', { disabled: true, title: 'Przeniesienie' }),
          ],
        }),
      ]),
    );
    configureTestApp();
    const harness = await openRoute('/catalog');
    await until(() => expect(text()).toContain('Jira'));

    const toggle = labelled('Pokaż narzędzia (Jira)', row('Jira'));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    toggle.click();
    await harness.fixture.whenStable();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).toBeTruthy();
    const body = text(row('Jira'));
    expect(body).toContain('jira__search_issues');
    expect(body).toContain('Wyszukiwanie zgłoszeń (JQL)');
    expect(body).toContain('mcp-jira-read · Odczyt');
    expect(body).toContain('mcp-jira-destructive · Usuwanie');
    expect(body).toContain('Wymaga kodu z Authenticatora.');
    expect(body).toContain('Wyłączone przez administratora.');
    expect(row('Jira').querySelector('code.tool-name')?.tagName).toBe('CODE');
  });

  it('filters by server or tool and opens the matching server', async () => {
    server.use(
      serve([
        serverFixture('jira', { tools: [toolFixture('jira__search_issues')] }),
        serverFixture('gitlab', { tools: [toolFixture('gitlab__list_merge_requests')] }),
      ]),
    );
    configureTestApp();
    const harness = await openRoute('/catalog');
    await until(() => expect(text()).toContain('GitLab'));

    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'merge';
    search.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();

    expect(text()).not.toContain('Jira');
    expect(text(row('GitLab'))).toContain('gitlab__list_merge_requests');

    search.value = 'brak takiego';
    search.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
    expect(text()).toContain('Żaden serwer ani narzędzie nie pasuje do wyszukiwania.');
  });

  it('copies the server URL from the catalog', async () => {
    configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('Jira'));
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);

    button('Kopiuj link (Jira)').click();

    expect(copy).toHaveBeenCalledWith('https://mcp.aiwcorpo.pl/s/mcp-jira/mcp');
    await until(() => expect(text()).toContain('Skopiowano adres serwera Jira.'));
  });

  it('reconnects an OAuth connection through the provider, naming the system in the return path', async () => {
    const navigation = configureTestApp();
    const bodies: unknown[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.url.endsWith('/api/v1/connections/gitlab/oauth')) {
        bodies.push(await request.clone().json());
      }
    });
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('GitLab'));

    button('Połącz (GitLab)').click();

    await until(() => expect(navigation.assign).toHaveBeenCalledOnce());
    expect(navigation.assign.mock.calls[0][0]).toMatch(
      /^https:\/\/gitlab\.internal\/oauth\/authorize\?/,
    );
    expect(bodies).toEqual([{ returnPath: '/catalog' }]);
  });

  it('opens the token form to renew a token', async () => {
    configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('Jira'));

    button('Odnów (Jira)').click();

    await until(() => expect(TestBed.inject(Router).url).toBe('/connect/jira'));
  });

  it('does not offer access requests while the BFF has none (M4), even when it lists them', async () => {
    configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('Confluence'));

    expect(text()).not.toContain('Złóż wniosek');
  });

  describe('return from the OAuth provider', () => {
    it('names the system and the account on success, and clears the URL', async () => {
      server.use(
        serve([
          serverFixture('gitlab', {
            connection: connectionFixture('gitlab', { backendUser: 'anna.nowak' }),
          }),
        ]),
      );
      configureTestApp();
      await openRoute('/catalog?system=gitlab&connected=gitlab');
      await until(() => expect(text()).toContain('Połączono z GitLab jako anna.nowak.'));
      await until(() => expect(location.search).not.toContain('connected'));
      expect(location.search).not.toContain('system');
    });

    it.each([
      ['flow_invalid', 'Link połączenia wygasł albo był już użyty. Zacznij od nowa.'],
      ['provider_error', 'GitLab nie odpowiedział poprawnie. Spróbuj za chwilę.'],
      ['identity_mismatch', 'GitLab nie odpowiedział poprawnie. Spróbuj za chwilę.'],
      ['cancelled', 'Łączenie z GitLab anulowane.'],
    ])('connectError=%s', async (code, message) => {
      configureTestApp();
      await openRoute(`/catalog?connectError=${code}&system=gitlab`);
      await until(() => expect(text()).toContain(message));
      expect(document.querySelector('[role="alert"]')).toBeTruthy();
    });

    it('says nothing about a success the catalog does not show', async () => {
      server.use(
        serve([
          serverFixture('gitlab', {
            status: 'not_connected',
            actions: ['connect_oauth'],
          }),
        ]),
      );
      configureTestApp();
      await openRoute('/catalog?system=gitlab&connected=gitlab');
      await until(() => expect(text(row('GitLab'))).toContain('Niepołączone'));

      expect(text()).not.toContain('Połączono z GitLab');
      await until(() => expect(location.search).not.toContain('connected'));
    });

    it('does not trust an unknown connectError or system name', async () => {
      configureTestApp();
      await openRoute('/catalog?system=<img>&connectError=<script>');
      await until(() => expect(text()).toContain('System nie odpowiedział poprawnie.'));
      expect(document.querySelector('img')).toBeNull();
      expect(text()).not.toContain('<script>');
    });

    it('can be dismissed', async () => {
      configureTestApp();
      await openRoute('/catalog?connectError=cancelled&system=gitlab');
      await until(() => expect(text()).toContain('anulowane'));
      labelled('Zamknij komunikat').click();
      await until(() => expect(text()).not.toContain('Łączenie z GitLab anulowane.'));
    });
  });

  it('shows the empty state of mockup 02', async () => {
    server.use(serve([]));
    configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('Nie masz jeszcze dostępu do żadnego serwera MCP'));
    expect(text()).toContain('Po akceptacji wniosku serwery pojawią się tutaj.');
  });

  it('shows a C10 message, the short request id and never the backend text, and retries', async () => {
    server.use(
      http.get(
        '/api/v1/catalog',
        () =>
          HttpResponse.json(
            {
              error: 'upstream_unavailable',
              message: 'java.net.ConnectException: broker:8443',
              requestId: '7f3a9c21-aaaa-bbbb-cccc-000000000000',
            },
            { status: 503 },
          ),
        { once: true },
      ),
    );
    configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('Nie udało się pobrać danych.'));
    expect(text()).toContain('Usługa jest chwilowo niedostępna.');
    expect(text()).toMatch(/Identyfikator do zgłoszenia:\s*7f3a9c21/);
    expect(text()).not.toContain('7f3a9c21-aaaa');
    expect(text()).not.toContain('ConnectException');

    button('Odśwież').click();
    await until(() => expect(text()).toContain('Jira'));
  });

  it('renders text from the API as text', async () => {
    server.use(
      serve([
        serverFixture('jira', {
          tools: [toolFixture('jira__x', { title: '<img src=x onerror=alert(1)>' })],
        }),
      ]),
    );
    configureTestApp();
    const harness = await openRoute('/catalog');
    await until(() => expect(text()).toContain('Jira'));
    labelled('Pokaż narzędzia (Jira)').click();
    await harness.fixture.whenStable();

    expect(text(row('Jira'))).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
  });
});
