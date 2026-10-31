import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HttpResponse, http } from 'msw';
import { mockCatalog } from '../../../mocks/portal-mock';
import { useMockApi } from '../../../testing/mock-api';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';
import { serverFixture, toolFixture } from '../../../testing/fixtures';
import { TOOL_LIST_WARNING_THRESHOLD } from '../../core/tool-list-warning';
import { toolBlock } from './endpoint-page';

function addressField(): HTMLInputElement {
  return document.getElementById('endpoint-url') as HTMLInputElement;
}

function checkbox(label: string | RegExp): HTMLInputElement {
  const found = Array.from(document.querySelectorAll('mat-checkbox')).find((candidate) =>
    typeof label === 'string'
      ? candidate.textContent?.trim() === label || candidate.textContent?.includes(label)
      : label.test(candidate.textContent ?? ''),
  );
  if (!found) {
    throw new Error(`no checkbox ${String(label)}`);
  }
  return found.querySelector('input')!;
}

function radio(name: string, value: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(
    `input[type="radio"][name="${name}"][value="${value}"]`,
  )!;
}

async function whenAddress(url: string): Promise<void> {
  await until(() => expect(addressField()?.value).toBe(url));
}

describe('EndpointPage', () => {
  const { server, store } = useMockApi();

  function recordEndpointQueries(): URLSearchParams[] {
    const queries: URLSearchParams[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname === '/api/v1/me/mcp-endpoint') {
        queries.push(url.searchParams);
      }
    });
    return queries;
  }

  function usableTools(): number {
    return mockCatalog(store.state)
      .servers.flatMap((candidate) => candidate.tools)
      .filter((tool) => tool.access === 'granted' && !tool.disabled).length;
  }

  it('opens with the address of the whole platform and no saved link anywhere', async () => {
    const paths: string[] = [];
    server.events.on('request:start', ({ request }) => paths.push(new URL(request.url).pathname));
    configureTestApp();
    await openRoute('/endpoint');

    await whenAddress('https://mcp.aiwcorpo.pl/mcp');
    expect(text()).toContain('Adres MCP');
    expect(text()).not.toContain('Moje linki');
    expect(text()).toContain(`Na liście będzie około ${usableTools()} narzędzi`);
    expect(paths.some((path) => path.includes('virtual-servers'))).toBe(false);
  });

  it('warns briefly about prompt injection across systems', async () => {
    configureTestApp();
    await openRoute('/endpoint');
    await whenAddress('https://mcp.aiwcorpo.pl/mcp');
    expect(text()).toContain('Jedna sesja sięga do wszystkich wybranych systemów.');
    expect(text()).toContain('Tylko odczyt');
  });

  it('sends the chosen systems as a typed parameter and shows the canonical address', async () => {
    const queries = recordEndpointQueries();
    configureTestApp();
    await openRoute('/endpoint');
    await whenAddress('https://mcp.aiwcorpo.pl/mcp');

    checkbox('Jira').click();
    checkbox('GitLab').click();

    await whenAddress('https://mcp.aiwcorpo.pl/mcp?systems=gitlab,jira');
    expect(queries.at(-1)?.get('systems')).toBe('gitlab,jira');
    expect(queries.at(-1)?.has('tools')).toBe(false);
    expect(text()).toContain('Filtr w adresie: 19 z 512 bajtów');
  });

  it('narrows to read-only and to write-only tools', async () => {
    configureTestApp();
    await openRoute('/endpoint');
    await whenAddress('https://mcp.aiwcorpo.pl/mcp');

    radio('access', 'read').click();
    await whenAddress('https://mcp.aiwcorpo.pl/mcp?access=read');
    const readTools = mockCatalog(store.state)
      .servers.flatMap((candidate) => candidate.tools)
      .filter(
        (tool) => tool.access === 'granted' && !tool.disabled && tool.risk === 'READ_ONLY',
      ).length;
    await until(() => expect(text()).toContain(`około ${readTools} narzędzi`));

    radio('access', 'write').click();
    await whenAddress('https://mcp.aiwcorpo.pl/mcp?access=write');
  });

  it('picks single tools, or excludes them', async () => {
    const queries = recordEndpointQueries();
    configureTestApp();
    await openRoute('/endpoint');
    await whenAddress('https://mcp.aiwcorpo.pl/mcp');

    checkbox('jira__get_issue').click();
    checkbox('jira__search_issues').click();
    await whenAddress('https://mcp.aiwcorpo.pl/mcp?tools=jira__get_issue,jira__search_issues');
    expect(queries.at(-1)?.get('tools')).toBe('jira__get_issue,jira__search_issues');

    radio('tool-mode', 'except').click();
    await whenAddress('https://mcp.aiwcorpo.pl/mcp');
    checkbox('jira__delete_issue').click();
    await whenAddress('https://mcp.aiwcorpo.pl/mcp?exclude=jira__delete_issue');
    expect(queries.at(-1)?.get('exclude')).toBe('jira__delete_issue');
    expect(queries.at(-1)?.has('tools')).toBe(false);
  });

  it('combines all four parts of the filter in the canonical order', async () => {
    configureTestApp();
    await openRoute('/endpoint');
    await whenAddress('https://mcp.aiwcorpo.pl/mcp');

    checkbox('Jira').click();
    radio('access', 'write').click();
    radio('tool-mode', 'except').click();
    checkbox('jira__delete_issue').click();

    await whenAddress(
      'https://mcp.aiwcorpo.pl/mcp?systems=jira&access=write&exclude=jira__delete_issue',
    );
  });

  it('drops a ticked tool when its system is no longer on the list', async () => {
    configureTestApp();
    await openRoute('/endpoint');
    await whenAddress('https://mcp.aiwcorpo.pl/mcp');

    checkbox('jira__get_issue').click();
    await whenAddress('https://mcp.aiwcorpo.pl/mcp?tools=jira__get_issue');
    checkbox('GitLab').click();
    await whenAddress('https://mcp.aiwcorpo.pl/mcp?systems=gitlab');
  });

  it('goes back to the whole platform with "Bez filtra"', async () => {
    configureTestApp();
    await openRoute('/endpoint');
    await whenAddress('https://mcp.aiwcorpo.pl/mcp');
    checkbox('Jira').click();
    radio('access', 'read').click();
    await whenAddress('https://mcp.aiwcorpo.pl/mcp?systems=jira&access=read');

    button('Bez filtra').click();

    await whenAddress('https://mcp.aiwcorpo.pl/mcp');
    expect(radio('access', 'all').checked).toBe(true);
  });

  it('explains the disabled, denied and not connected tools', async () => {
    configureTestApp();
    await openRoute('/endpoint');
    await whenAddress('https://mcp.aiwcorpo.pl/mcp');

    expect(checkbox('jira__search_issues').disabled).toBe(false);
    expect(text()).toContain('Wymaga kodu z Authenticatora.');
    expect(checkbox('gitlab__get_project').disabled).toBe(true);
    expect(text()).toContain('Wyłączone przez administratora.');
    expect(text()).toContain('Brak uprawnienia, nie pojawi się na liście.');
    expect(text()).toContain('Wymaga ponownego połączenia.');
  });

  it('says that a not connected system stays on the list and points to the connection', async () => {
    server.use(
      http.get('/api/v1/catalog', () =>
        HttpResponse.json({ servers: [serverFixture('jira', { status: 'not_connected' })] }),
      ),
    );
    configureTestApp();
    await openRoute('/endpoint');
    await until(() =>
      expect(text()).toContain('Konto niepołączone, wywołanie poprosi o połączenie.'),
    );
    expect(document.querySelector('a[href="/connect/jira"]')).toBeTruthy();
    expect(checkbox('jira__get').disabled).toBe(true);
  });

  it('filters the tool list by name or title', async () => {
    configureTestApp();
    await openRoute('/endpoint');
    await whenAddress('https://mcp.aiwcorpo.pl/mcp');

    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'komentarza';
    search.dispatchEvent(new Event('input'));

    await until(() => expect(text()).not.toContain('jira__search_issues'));
    expect(text()).toContain('jira__add_comment');
  });

  describe('limit of 512 bytes (CC-185)', () => {
    function manyTools(): void {
      const tools = Array.from({ length: 30 }, (_, index) =>
        toolFixture(`jira__operation_number_${String(index).padStart(2, '0')}`),
      );
      server.use(
        http.get('/api/v1/catalog', () =>
          HttpResponse.json({ servers: [serverFixture('jira', { tools })] }),
        ),
      );
    }

    it('counts the bytes and does not ask for an address that cannot be built', async () => {
      manyTools();
      const queries = recordEndpointQueries();
      configureTestApp();
      await openRoute('/endpoint');
      await whenAddress('https://mcp.aiwcorpo.pl/mcp');
      const before = queries.length;

      for (let index = 0; index < 20; index += 1) {
        checkbox(`jira__operation_number_${String(index).padStart(2, '0')}`).click();
      }

      await until(() => expect(text()).toContain('bajtów. Zamiast wielu narzędzi'));
      const counter = document.querySelector('[data-testid="query-bytes"]')!.textContent!;
      expect(Number(/(\d+) z 512/.exec(counter)![1])).toBeGreaterThan(512);
      expect(addressField()).toBeNull();
      expect(text()).toContain('Adres pojawi się, gdy wybór zmieści się w limicie.');
      await new Promise((resolve) => setTimeout(resolve, 400));
      // The series of clicks produced no request for the part that does not fit; at most the ones that did.
      for (const query of queries.slice(before)) {
        expect(`tools=${query.get('tools')}`.length).toBeLessThanOrEqual(512);
      }
    });

    it('allows far fewer than 100 tools and says what to do instead', async () => {
      manyTools();
      configureTestApp();
      await openRoute('/endpoint');
      await whenAddress('https://mcp.aiwcorpo.pl/mcp');

      for (let index = 0; index < 20; index += 1) {
        checkbox(`jira__operation_number_${String(index).padStart(2, '0')}`).click();
      }
      await until(() => expect(text()).toContain('wyklucz kilka narzędzi'));

      radio('tool-mode', 'except').click();
      await whenAddress('https://mcp.aiwcorpo.pl/mcp');
    });
  });

  describe('warning about the size of the list', () => {
    it('shows when toolCount reaches the configurable threshold and goes away after narrowing', async () => {
      configureTestApp();
      TestBed.overrideProvider(TOOL_LIST_WARNING_THRESHOLD, { useValue: usableTools() });
      await openRoute('/endpoint');
      await whenAddress('https://mcp.aiwcorpo.pl/mcp');
      await until(() =>
        expect(document.querySelector('[data-testid="size-warning"]')).toBeTruthy(),
      );
      expect(text()).toContain(
        'zawęź adres do systemów, które są potrzebne, albo do samego odczytu',
      );
      expect(document.querySelector('[data-testid="paging-note"]')).toBeNull();

      radio('access', 'read').click();
      await whenAddress('https://mcp.aiwcorpo.pl/mcp?access=read');
      expect(document.querySelector('[data-testid="size-warning"]')).toBeNull();
    });

    it('is quiet below the default threshold of 50 tools', async () => {
      configureTestApp();
      await openRoute('/endpoint');
      await whenAddress('https://mcp.aiwcorpo.pl/mcp');
      expect(TestBed.inject(TOOL_LIST_WARNING_THRESHOLD)).toBe(50);
      expect(document.querySelector('[data-testid="size-warning"]')).toBeNull();
    });

    it('reminds that the client has to follow nextCursor above 100 tools', async () => {
      server.use(
        http.get('/api/v1/me/mcp-endpoint', () =>
          HttpResponse.json({
            url: 'https://mcp.aiwcorpo.pl/mcp',
            toolCount: 140,
            clientConfigs: { claudeCode: 'c', copilot: 'p', codex: 'x' },
          }),
        ),
      );
      configureTestApp();
      await openRoute('/endpoint');
      await until(() => expect(document.querySelector('[data-testid="paging-note"]')).toBeTruthy());
      expect(text()).toContain('Lista ma około 140 narzędzi.');
      expect(text()).toContain('100 narzędzi na stronę');
    });
  });

  it('shows the 400 invalid_filter of the BFF without any backend text', async () => {
    server.use(
      http.get('/api/v1/me/mcp-endpoint', ({ request }) =>
        new URL(request.url).searchParams.has('systems')
          ? HttpResponse.json(
              { error: 'invalid_request', reason: 'invalid_filter', message: 'internal detail' },
              { status: 400 },
            )
          : HttpResponse.json({
              url: 'https://mcp.aiwcorpo.pl/mcp',
              toolCount: 1,
              clientConfigs: { claudeCode: 'c', copilot: 'p', codex: 'x' },
            }),
      ),
    );
    configureTestApp();
    await openRoute('/endpoint');
    await whenAddress('https://mcp.aiwcorpo.pl/mcp');

    checkbox('Jira').click();

    await until(() =>
      expect(text()).toContain('Takiego filtru nie da się zapisać w adresie. Zmień wybór.'),
    );
    expect(text()).not.toContain('internal detail');
  });

  it('shows a failure of the address with a retry, and the filter still works', async () => {
    store.update({ scenario: 'errors' });
    configureTestApp();
    await openRoute('/endpoint');
    await until(() => expect(text()).toContain('Usługa jest chwilowo niedostępna.'));
    expect(addressField()).toBeNull();
  });

  it('switches between Claude Code, Copilot and Codex and copies the visible one', async () => {
    configureTestApp();
    const harness = await openRoute('/endpoint');
    await whenAddress('https://mcp.aiwcorpo.pl/mcp');
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);

    expect(text()).toContain(
      'claude mcp add --transport http aiwcorpo-mcp "https://mcp.aiwcorpo.pl/mcp"',
    );
    const tab = (name: string) =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find((candidate) =>
        candidate.textContent?.includes(name),
      )!;
    tab('Copilot').click();
    await harness.fixture.whenStable();
    await until(() => expect(text()).toContain('.vscode/mcp.json'));
    button('Kopiuj (Copilot)').click();
    expect(copy).toHaveBeenLastCalledWith(
      JSON.stringify({
        servers: { 'aiwcorpo-mcp': { type: 'http', url: 'https://mcp.aiwcorpo.pl/mcp' } },
      }),
    );

    tab('Codex').click();
    await harness.fixture.whenStable();
    await until(() => expect(text()).toContain('[mcp_servers.aiwcorpo-mcp]'));

    button('Kopiuj adres MCP').click();
    expect(copy).toHaveBeenLastCalledWith('https://mcp.aiwcorpo.pl/mcp');
  });

  it.each(['/links', '/links/new', '/links/przeglad-zgloszen'])(
    'sends the old bookmark %s to the address page',
    async (path) => {
      configureTestApp();
      await openRoute(path);
      await until(() => expect(TestBed.inject(Router).url).toBe('/endpoint'));
    },
  );

  it('shows a load failure of the catalog next to a working address', async () => {
    server.use(
      http.get('/api/v1/catalog', () =>
        HttpResponse.json({ error: 'upstream_unavailable' }, { status: 503 }),
      ),
    );
    configureTestApp();
    await openRoute('/endpoint');
    await whenAddress('https://mcp.aiwcorpo.pl/mcp');
    await until(() => expect(text()).toContain('Nie udało się pobrać danych.'));
  });
});

describe('toolBlock', () => {
  const tool = toolFixture('jira__x');
  it('names the first reason a tool does not count towards the address', () => {
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
