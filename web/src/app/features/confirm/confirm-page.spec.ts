import { TestBed } from '@angular/core/testing';
import { HttpResponse, http } from 'msw';
import {
  BIDI_CONFIRMATION_ID,
  CONFIRMATION_TTL_MS,
  DEMO_CONFIRMATION_ID,
  demoConfirmation,
} from '../../../mocks/m3-mock';
import { useMockApi } from '../../../testing/mock-api';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';
import { CONFIRM_POLL_MS, sortedArguments } from './confirm-page';

function visibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('ConfirmPage', () => {
  const { server, store } = useMockApi();
  const path = `/confirm/${DEMO_CONFIRMATION_ID}`;

  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState');
    Reflect.deleteProperty(document, 'prerendering');
  });

  function fast(): void {
    TestBed.configureTestingModule({ providers: [{ provide: CONFIRM_POLL_MS, useValue: 40 }] });
  }

  function countCalls(url: string, method: 'get' | 'post') {
    const calls = vi.fn();
    server.use(
      http[method](url, () => {
        calls();
        return undefined;
      }),
    );
    return calls;
  }

  it('shows system, tool, resource and the arguments sorted by name, read only', async () => {
    configureTestApp();
    await openRoute(path);
    await until(() => expect(text()).toContain('Operacja nieodwracalna czeka na kod'));

    expect(text()).toMatch(/wygasa za 0[012]:\d{2}/);
    expect(text()).toContain('SystemConfluence');
    expect(text()).toContain('Narzędzieconfluence__delete_page');
    expect(text()).toContain('ZasóbConfluence DEV / 48213');
    const names = Array.from(document.querySelectorAll('.facts dt code')).map((c) => c.textContent);
    expect(names).toEqual(['pageId', 'spaceKey', 'title', 'versionComment']);
    expect(text()).toContain('(obcięto)');
    expect(text()).toContain(
      'Jeśli to się zgadza, wpisz w sesji agenta kod z aplikacji MCP Platform.',
    );
    expect(text()).toContain(
      'Ten podgląd jest opcjonalny: kod działa także bez otwierania tej strony.',
    );
    expect(button('Anuluj operację')).toBeTruthy();
    expect(text()).not.toMatch(/Zatwierdź|Odrzuć/);
  });

  it('sorts arguments by name even if the answer arrives unsorted', () => {
    const sorted = sortedArguments([
      { name: 'title', value: '"a"', truncated: false },
      { name: 'Zeta', value: '"a"', truncated: false },
      { name: 'pageId', value: '"a"', truncated: false },
    ]);
    expect(sorted.map((argument) => argument.name)).toEqual(['Zeta', 'pageId', 'title']);
  });

  it('records the view with an explicit POST once the page is drawn and visible', async () => {
    const viewed = countCalls(`/api/v1/confirmations/${DEMO_CONFIRMATION_ID}/viewed`, 'post');
    configureTestApp();
    await openRoute(path);
    await until(() => expect(viewed).toHaveBeenCalledTimes(1));
    expect(store.state.confirmations[DEMO_CONFIRMATION_ID]?.viewed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(viewed).toHaveBeenCalledTimes(1);
  });

  it('does not record the view while the tab is hidden, and does when it becomes visible', async () => {
    const viewed = countCalls(`/api/v1/confirmations/${DEMO_CONFIRMATION_ID}/viewed`, 'post');
    visibility('hidden');
    configureTestApp();
    await openRoute(path);
    await until(() => expect(text()).toContain('Anuluj operację'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(viewed).not.toHaveBeenCalled();

    visibility('visible');
    await until(() => expect(viewed).toHaveBeenCalledTimes(1));
  });

  it('does not record the view during prerender', async () => {
    const viewed = countCalls(`/api/v1/confirmations/${DEMO_CONFIRMATION_ID}/viewed`, 'post');
    Object.defineProperty(document, 'prerendering', { configurable: true, value: true });
    configureTestApp();
    await openRoute(path);
    await until(() => expect(text()).toContain('Anuluj operację'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(viewed).not.toHaveBeenCalled();
  });

  it('warns that "first wins" is off when the view cannot be recorded, and retries', async () => {
    fast();
    let failing = true;
    server.use(
      http.post(`/api/v1/confirmations/${DEMO_CONFIRMATION_ID}/viewed`, () =>
        failing ? HttpResponse.json({ error: 'upstream_unavailable' }, { status: 503 }) : undefined,
      ),
    );
    configureTestApp();
    await openRoute(path);
    await until(() =>
      expect(text()).toContain('Ochrona "pierwsza wygrywa" nie jest teraz aktywna'),
    );
    failing = false;
    await until(() =>
      expect(text()).not.toContain('Ochrona "pierwsza wygrywa" nie jest teraz aktywna'),
    );
    expect(store.state.confirmations[DEMO_CONFIRMATION_ID]?.viewed).toBe(true);
  });

  it('says the link is out of date when the answer is 404', async () => {
    configureTestApp();
    await openRoute('/confirm/cnf_unknown');
    await until(() => expect(text()).toContain('Ten link jest nieaktualny.'));
    expect(text()).toContain('Nie wpisuj kodu dla tej operacji.');
    expect(text()).not.toContain('Anuluj operację');
  });

  it('notices by polling that another operation replaced this one', async () => {
    fast();
    configureTestApp();
    await openRoute(path);
    await until(() => expect(text()).toContain('Anuluj operację'));
    store.update({
      confirmations: {
        ...store.state.confirmations,
        [DEMO_CONFIRMATION_ID]: {
          ...store.state.confirmations[DEMO_CONFIRMATION_ID],
          superseded: true,
        },
      },
    });
    await until(() => expect(text()).toContain('Ten link jest nieaktualny.'));
    expect(text()).not.toContain('Anuluj operację');
  });

  it('keeps showing the operation, with a warning, when polling fails for another reason', async () => {
    fast();
    configureTestApp();
    await openRoute(path);
    await until(() => expect(text()).toContain('Anuluj operację'));
    server.use(
      http.get(`/api/v1/confirmations/${DEMO_CONFIRMATION_ID}`, () =>
        HttpResponse.json({ error: 'upstream_unavailable' }, { status: 503 }),
      ),
    );
    await until(() =>
      expect(text()).toContain('Nie udało się sprawdzić, czy operacja jest nadal aktualna.'),
    );
    expect(text()).toContain('Anuluj operację');
  });

  it('turns into "Czas minął" when the 120 seconds are over', async () => {
    server.use(
      http.get(`/api/v1/confirmations/${DEMO_CONFIRMATION_ID}`, () =>
        HttpResponse.json({
          ...demoConfirmation(Date.now()),
          expiresAt: new Date(Date.now() + 1200).toISOString(),
        }),
      ),
    );
    configureTestApp();
    await openRoute(path);
    await until(() => expect(text()).toContain('Anuluj operację'));
    await until(() => expect(text()).toContain('Czas minął.'));
    expect(text()).toContain('Poproś agenta o ponowienie.');
    expect(text()).toContain('Nie wpisuj kodu dla tej operacji.');
    expect(text()).not.toContain('Anuluj operację');
    expect(CONFIRMATION_TTL_MS).toBe(120_000);
  });

  describe('a wrong clock on this machine', () => {
    afterEach(() => vi.restoreAllMocks());

    function serverSays(expiresInMs: number) {
      const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
      server.use(
        http.get(`/api/v1/confirmations/${DEMO_CONFIRMATION_ID}`, () =>
          HttpResponse.json(
            {
              ...demoConfirmation(Date.now()),
              expiresAt,
            },
            { headers: { Date: new Date().toUTCString() } },
          ),
        ),
      );
    }

    it('does not make the page say "Czas minął" and does not hide "Anuluj operację"', async () => {
      serverSays(100_000);
      const real = Date.now.bind(Date);
      vi.spyOn(Date, 'now').mockImplementation(() => real() + 130_000);
      const viewed = countCalls(`/api/v1/confirmations/${DEMO_CONFIRMATION_ID}/viewed`, 'post');
      configureTestApp();
      await openRoute(path);
      await until(() => expect(text()).toContain('Anuluj operację'));
      expect(text()).not.toContain('Czas minął.');
      expect(text()).toMatch(/wygasa za 01:(3|4|5)\d/);
      await until(() => expect(viewed).toHaveBeenCalledTimes(1));
    });

    it('does not turn "Czas minął" into a view when the server clock says the time is over', async () => {
      serverSays(-5000);
      const viewed = countCalls(`/api/v1/confirmations/${DEMO_CONFIRMATION_ID}/viewed`, 'post');
      configureTestApp();
      await openRoute(path);
      await until(() => expect(text()).toContain('Czas minął.'));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(viewed).not.toHaveBeenCalled();
      expect(text()).not.toContain('Anuluj operację');
    });
  });

  it('cancels the operation from the preview', async () => {
    configureTestApp();
    await openRoute(path);
    await until(() => expect(text()).toContain('Anuluj operację'));
    button('Anuluj operację').click();
    await until(() => expect(text()).toContain('Operacja anulowana.'));
    expect(store.state.confirmations[DEMO_CONFIRMATION_ID]?.cancelled).toBe(true);
    expect(text()).toContain('poczekaj na nowy kod (30 do 60 s)');
    expect(text()).not.toContain('Anuluj operację');
  });

  it('explains a failed cancel with a link to the activity log', async () => {
    configureTestApp();
    await openRoute(path);
    await until(() => expect(text()).toContain('Anuluj operację'));
    server.use(
      http.post(`/api/v1/confirmations/${DEMO_CONFIRMATION_ID}/cancel`, () =>
        HttpResponse.json({ error: 'not_found_or_denied' }, { status: 404 }),
      ),
    );
    button('Anuluj operację').click();
    await until(() =>
      expect(text()).toContain(
        'Nie udało się anulować: operacja mogła zostać wykonana albo wygasła.',
      ),
    );
    expect(document.querySelector('a[href="/logs"]')?.textContent).toContain(
      'Sprawdź w logach aktywności',
    );
    expect(text()).toContain('Anuluj operację');
  });

  it('says nothing was cancelled when the gateway cannot burn the codes (503)', async () => {
    configureTestApp();
    await openRoute(path);
    await until(() => expect(text()).toContain('Anuluj operację'));
    server.use(
      http.post(`/api/v1/confirmations/${DEMO_CONFIRMATION_ID}/cancel`, () =>
        HttpResponse.json({ error: 'upstream_unavailable' }, { status: 503 }),
      ),
    );
    button('Anuluj operację').click();
    await until(() => expect(text()).toContain('Usługa jest chwilowo niedostępna.'));
    expect(text()).not.toContain('Operacja anulowana.');
  });

  it('shows the whole-page error when the first read fails', async () => {
    server.use(
      http.get(`/api/v1/confirmations/${DEMO_CONFIRMATION_ID}`, () =>
        HttpResponse.json({ error: 'upstream_unavailable' }, { status: 503 }),
      ),
    );
    configureTestApp();
    await openRoute(path);
    await until(() => expect(text()).toContain('Nie udało się pobrać danych.'));
  });

  it('renders values from the agent as inert text with control characters made visible', async () => {
    configureTestApp();
    await openRoute(`/confirm/${BIDI_CONFIRMATION_ID}`);
    await until(() => expect(text()).toContain('Operacja nieodwracalna czeka na kod'));

    const value = Array.from(document.querySelectorAll('[data-testid="argument-value"]'))
      .map((node) => node.textContent ?? '')
      .join('|');
    expect(value).toContain('cleanup[U+202E]gnp.exe[U+2066] first line\nsecond line[U+0007]');
    for (const code of [0x202e, 0x2066, 0x07]) {
      expect(document.body.textContent).not.toContain(String.fromCodePoint(code));
    }
    expect(text()).toContain('Wartości zawierają znaki sterujące.');
    for (const node of document.querySelectorAll('.untrusted')) {
      expect(node.getAttribute('dir')).toBe('ltr');
    }
  });

  it('never turns a value into markup', async () => {
    server.use(
      http.get(`/api/v1/confirmations/${DEMO_CONFIRMATION_ID}`, () =>
        HttpResponse.json({
          ...demoConfirmation(Date.now()),
          arguments: [{ name: 'x', value: '"<img src=x onerror=alert(1)>"', truncated: false }],
        }),
      ),
    );
    configureTestApp();
    await openRoute(path);
    await until(() => expect(text()).toContain('<img src=x onerror=alert(1)>'));
    expect(document.querySelector('main img')).toBeNull();
  });
});
