import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HttpResponse, http } from 'msw';
import { FOREIGN_SLUG } from '../../../mocks/portal-mock';
import { useMockApi } from '../../../testing/mock-api';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';
import { toolBlock } from './link-wizard-page';
import { serverFixture, toolFixture } from '../../../testing/fixtures';

function input(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function type(field: HTMLInputElement, value: string): void {
  field.value = value;
  field.dispatchEvent(new Event('input'));
}

function checkbox(toolName: string): HTMLInputElement {
  const label = Array.from(document.querySelectorAll('mat-checkbox')).find((candidate) =>
    candidate.textContent?.includes(toolName),
  );
  return label!.querySelector('input')!;
}

async function toToolsStep(name: string, slug?: string): Promise<void> {
  await until(() => expect(input('link-name')).toBeTruthy());
  type(input('link-name'), name);
  if (slug !== undefined) {
    type(input('link-slug'), slug);
  }
  button('Dalej').click();
  await until(() => expect(text()).toContain('Wybierz narzędzia'));
}

describe('LinkWizardPage', () => {
  const { server, store } = useMockApi();

  it('suggests the identifier from the name until it is edited by hand', async () => {
    configureTestApp();
    await openRoute('/links/new');
    await until(() => expect(input('link-name')).toBeTruthy());

    type(input('link-name'), 'Mój zestaw');
    expect(input('link-slug').value).toBe('moj-zestaw');

    type(input('link-slug'), 'wlasny-id');
    type(input('link-name'), 'Inna nazwa');
    expect(input('link-slug').value).toBe('wlasny-id');
    expect(text()).toContain(
      'Małe litery, cyfry i myślnik. Podpowiadany z nazwy, będzie częścią adresu.',
    );
  });

  it('shows three steps, no narrowing step', async () => {
    configureTestApp();
    await openRoute('/links/new');
    await until(() => expect(text()).toContain('1. Nazwa'));
    expect(text()).toContain('2. Narzędzia');
    expect(text()).toContain('3. Gotowe');
    expect(text()).not.toContain('Zawężenie');
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('Nazwa');
  });

  it('rejects an identifier the user already has, before calling the API', async () => {
    configureTestApp();
    await openRoute('/links/new');
    await until(() => expect(input('link-name')).toBeTruthy());

    type(input('link-name'), 'Przegląd zgłoszeń');
    button('Dalej').click();

    await until(() => expect(text()).toContain('Ten identyfikator jest już zajęty. Wybierz inny.'));
    expect(input('link-slug').getAttribute('aria-invalid')).toBe('true');
    expect(text()).not.toContain('Wybierz narzędzia');
  });

  it('rejects an identifier that breaks the contract pattern', async () => {
    configureTestApp();
    await openRoute('/links/new');
    await until(() => expect(input('link-name')).toBeTruthy());

    type(input('link-name'), 'Nazwa');
    type(input('link-slug'), '-zly-');
    button('Dalej').click();

    await until(() => expect(text()).toContain('Dozwolone są małe litery, cyfry i myślnik'));
  });

  it('requires a name', async () => {
    configureTestApp();
    await openRoute('/links/new');
    await until(() => expect(input('link-name')).toBeTruthy());

    button('Dalej').click();

    await until(() => expect(text()).toContain('Podaj nazwę'));
    expect(text()).not.toContain('Wybierz narzędzia');
  });

  it('goes back to the name step with the message when the API answers 409', async () => {
    configureTestApp();
    await openRoute('/links/new');
    await toToolsStep('Cudzy link', FOREIGN_SLUG);
    checkbox('jira__get_issue').click();

    button('Utwórz link').click();

    await until(() => expect(text()).toContain('Nowy link'));
    expect(text()).toContain('Ten identyfikator jest już zajęty. Wybierz inny.');
    expect(input('link-slug').value).toBe(FOREIGN_SLUG);
  });

  describe('tool list', () => {
    it('lets the user choose usable tools and explains the others', async () => {
      configureTestApp();
      await openRoute('/links/new');
      await toToolsStep('Zestaw');

      expect(checkbox('jira__search_issues').disabled).toBe(false);
      expect(text()).toContain('Wymaga kodu z Authenticatora.');
      expect(checkbox('gitlab__get_project').disabled).toBe(true);
      expect(text()).toContain('Narzędzie wyłączone przez administratora.');
      expect(checkbox('gitlab__list_merge_requests').disabled).toBe(true);
      expect(text()).toContain('Wymaga ponownego połączenia');
      expect(checkbox('confluence__get_page').disabled).toBe(true);
      expect(text()).toContain('Brak uprawnienia');
      expect(text()).toContain('Wybrano: 0');

      checkbox('jira__get_issue').click();
      await until(() => expect(text()).toContain('Wybrano: 1'));
    });

    it('needs at least one tool', async () => {
      configureTestApp();
      await openRoute('/links/new');
      await toToolsStep('Zestaw');

      button('Utwórz link').click();

      await until(() => expect(text()).toContain('Wybierz co najmniej jedno narzędzie.'));
    });

    it('filters tools by name or title', async () => {
      configureTestApp();
      const harness = await openRoute('/links/new');
      await toToolsStep('Zestaw');

      const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
      type(search, 'komentarza');
      await harness.fixture.whenStable();

      expect(text()).toContain('jira__add_comment');
      expect(text()).not.toContain('jira__get_issue');
    });

    it('leads to the connect page from a not-connected row and offers no access request in M2', async () => {
      configureTestApp();
      await openRoute('/links/new');
      await toToolsStep('Zestaw');

      const connect = Array.from(document.querySelectorAll('a')).find((a) =>
        a.getAttribute('href')?.startsWith('/connect/gitlab'),
      );
      expect(connect).toBeTruthy();

      expect(text()).toContain('Brak uprawnienia');
      expect(text()).not.toContain('Złóż wniosek');
    });
  });

  it('creates the link without resourceDefaults and shows URL, configs and summary', async () => {
    const bodies: unknown[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/api/v1/virtual-servers')) {
        bodies.push(await request.clone().json());
      }
    });
    configureTestApp();
    await openRoute('/links/new');
    await toToolsStep('Mój zestaw');
    checkbox('jira__search_issues').click();
    checkbox('jira__get_issue').click();

    button('Utwórz link').click();

    await until(() => expect(text()).toContain('Link "Mój zestaw" jest gotowy'));
    expect(bodies).toEqual([
      {
        slug: 'moj-zestaw',
        displayName: 'Mój zestaw',
        tools: ['jira__search_issues', 'jira__get_issue'],
      },
    ]);
    expect(input('link-url').value).toBe('https://mcp.aiwcorpo.pl/v/moj-zestaw/mcp');
    expect(text()).toContain(
      'claude mcp add --transport http moj-zestaw https://mcp.aiwcorpo.pl/v/moj-zestaw/mcp',
    );
    expect(text()).toContain('jira__search_issues, jira__get_issue');
    expect(text()).toContain('Konfiguracja nie zawiera tokenu ani hasła.');
    expect(store.state.links?.some((link) => link.slug === 'moj-zestaw')).toBe(true);
  });

  it('refuses a name made of spaces', async () => {
    configureTestApp();
    await openRoute('/links/new');
    await until(() => expect(input('link-name')).toBeTruthy());

    type(input('link-name'), '   ');
    type(input('link-slug'), 'zestaw');
    button('Dalej').click();

    await until(() => expect(text()).toContain('Podaj nazwę'));
    expect(text()).not.toContain('Wybierz narzędzia');
  });

  it('drops a tool that became blocked while the wizard was open, instead of failing again', async () => {
    const bodies: { tools: string[] }[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/api/v1/virtual-servers')) {
        bodies.push((await request.clone().json()) as { tools: string[] });
      }
    });
    const jira = (second: 'granted' | 'denied') =>
      serverFixture('jira', {
        tools: [
          toolFixture('jira__get_issue'),
          toolFixture('jira__delete_issue', { access: second }),
        ],
      });
    server.use(
      http.get('/api/v1/catalog', () => HttpResponse.json({ servers: [jira('granted')] })),
      http.post(
        '/api/v1/virtual-servers',
        () => HttpResponse.json({ error: 'access_denied' }, { status: 403 }),
        { once: true },
      ),
    );
    configureTestApp();
    await openRoute('/links/new');
    await toToolsStep('Zestaw');
    checkbox('jira__get_issue').click();
    checkbox('jira__delete_issue').click();

    server.use(http.get('/api/v1/catalog', () => HttpResponse.json({ servers: [jira('denied')] })));
    button('Utwórz link').click();
    await until(() => expect(checkbox('jira__delete_issue').disabled).toBe(true));

    button('Utwórz link').click();

    await until(() => expect(text()).toContain('jest gotowy'));
    expect(bodies.at(-1)?.tools).toEqual(['jira__get_issue']);
  });

  it('explains a 400 on create (link limit of the gateway) next to the request id', async () => {
    server.use(
      http.post('/api/v1/virtual-servers', () =>
        HttpResponse.json(
          { error: 'invalid_request', requestId: '0192d1b2-7c3a' },
          { status: 400 },
        ),
      ),
    );
    configureTestApp();
    await openRoute('/links/new');
    await toToolsStep('Zestaw');
    checkbox('jira__get_issue').click();

    button('Utwórz link').click();

    await until(() => expect(text()).toContain('limit 50 linków na użytkownika'));
    expect(text()).toContain('0192d1b2');
  });

  it('switches between Claude Code, Copilot and Codex and copies the visible one', async () => {
    configureTestApp();
    const harness = await openRoute('/links/new');
    await toToolsStep('Mój zestaw');
    checkbox('jira__get_issue').click();
    button('Utwórz link').click();
    await until(() => expect(text()).toContain('jest gotowy'));
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);

    const tab = (name: string) =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find((t) =>
        t.textContent?.includes(name),
      )!;
    tab('Copilot').click();
    await harness.fixture.whenStable();
    await until(() => expect(text()).toContain('.vscode/mcp.json'));
    expect(text()).toContain('"servers"');
    button('Kopiuj (Copilot)').click();
    expect(copy).toHaveBeenLastCalledWith(
      JSON.stringify({
        servers: {
          'moj-zestaw': { type: 'http', url: 'https://mcp.aiwcorpo.pl/v/moj-zestaw/mcp' },
        },
      }),
    );

    tab('Codex').click();
    await harness.fixture.whenStable();
    await until(() => expect(text()).toContain('[mcp_servers.moj-zestaw]'));

    button('Kopiuj adres linku').click();
    expect(copy).toHaveBeenLastCalledWith('https://mcp.aiwcorpo.pl/v/moj-zestaw/mcp');

    button('Wróć do listy').click();
    await until(() => expect(TestBed.inject(Router).url).toBe('/links'));
  });

  it('shows access_denied from the API on the tools step and reloads the catalog', async () => {
    server.use(
      http.post(
        '/api/v1/virtual-servers',
        () => HttpResponse.json({ error: 'access_denied' }, { status: 403 }),
        { once: true },
      ),
    );
    configureTestApp();
    await openRoute('/links/new');
    await toToolsStep('Zestaw');
    checkbox('jira__get_issue').click();

    button('Utwórz link').click();

    await until(() => expect(text()).toContain('Nie masz uprawnień do tej operacji.'));
    expect(text()).toContain('Wybierz narzędzia');
  });

  it('shows a load failure of the catalog', async () => {
    store.update({ scenario: 'errors' });
    configureTestApp();
    await openRoute('/links/new');
    await until(() => expect(text()).toContain('Nie udało się pobrać danych.'));
  });
});

describe('toolBlock', () => {
  const tool = toolFixture('jira__x');
  it('names the first reason a tool cannot be chosen', () => {
    const connected = serverFixture('jira', { status: 'connected' });
    expect(toolBlock(connected, tool)).toBeNull();
    expect(toolBlock(connected, { ...tool, disabled: true, access: 'denied' })).toBe('disabled');
    expect(toolBlock(connected, { ...tool, access: 'denied' })).toBe('denied');
    expect(toolBlock(serverFixture('jira', { status: 'expiring' }), tool)).toBeNull();
    expect(toolBlock(serverFixture('jira', { status: 'not_connected' }), tool)).toBe(
      'not_connected',
    );
    expect(toolBlock(serverFixture('jira', { status: 'reconnect_required' }), tool)).toBe(
      'reconnect_required',
    );
  });
});
