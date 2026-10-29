import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HttpResponse, http } from 'msw';
import { MockRequest } from '../../../mocks/portal-mock';
import { serverFixture, toolFixture } from '../../../testing/fixtures';
import { useMockApi } from '../../../testing/mock-api';
import {
  button,
  configureTestApp,
  labelled,
  openRoute,
  text,
  until,
} from '../../../testing/test-app';

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('mat-dialog-container');
  if (!found) {
    throw new Error('no dialog');
  }
  return found;
}

function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function dialogSelect(id: string): HTMLSelectElement {
  return dialog().querySelector<HTMLSelectElement>(`#${id}`)!;
}

const DAY = 86_400_000;
const iso = (ago: number) => new Date(Date.now() - ago).toISOString();

describe('RequestsPage', () => {
  const { server, store } = useMockApi();

  it('lists requests newest first with status, decision date and a link only for https URLs', async () => {
    const requests: MockRequest[] = [
      {
        requestId: 'REQ-1',
        entitlement: 'mcp-jira-write',
        status: 'approved',
        createdAt: iso(9 * DAY),
        decidedAt: iso(8 * DAY),
      },
      {
        requestId: 'REQ-2',
        entitlement: 'mcp-opensearch-read',
        status: 'pending',
        createdAt: iso(2 * DAY),
      },
      {
        requestId: 'REQ-3',
        entitlement: 'finance-approvers',
        status: 'rejected',
        createdAt: iso(20 * DAY),
        decidedAt: iso(19 * DAY),
      },
      {
        requestId: 'REQ-4',
        entitlement: 'mcp-gitlab-read',
        status: 'cancelled',
        createdAt: iso(30 * DAY),
        decidedAt: iso(30 * DAY),
      },
    ];
    store.update({ requests });
    configureTestApp();
    await openRoute('/requests');
    await until(() => expect(text()).toContain('mcp-opensearch-read'));

    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows.map((tr) => tr.querySelector('code')?.textContent)).toEqual([
      'mcp-opensearch-read',
      'mcp-jira-write',
      'finance-approvers',
      'mcp-gitlab-read',
    ]);
    expect(text(rows[0])).toContain('OpenSearch, odczyt');
    expect(text(rows[0])).toContain('Oczekuje');
    expect(text(rows[0])).toContain('Otwórz w systemie uprawnień');
    expect(text(rows[1])).toContain('Zaakceptowany');
    expect(text(rows[1])).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(text(rows[2])).toContain('Odrzucony');
    expect(text(rows[3])).toContain('Anulowany');
    expect(rows[1].querySelector('a')).toBeNull();
    expect(text()).toContain('Wnioski akceptuje i anuluje system uprawnień.');
    expect(document.body.textContent).not.toContain('Odrzuć');
  });

  it('does not link a request URL that is not https', async () => {
    server.use(
      http.get('/api/v1/access-requests', () =>
        HttpResponse.json([
          {
            requestId: 'REQ-9',
            entitlement: 'mcp-jira-read',
            status: 'pending',
            createdAt: iso(DAY),
            requestUrl: 'javascript:alert(1)',
          },
        ]),
      ),
    );
    configureTestApp();
    await openRoute('/requests');
    await until(() => expect(text()).toContain('mcp-jira-read'));
    expect(document.querySelector('tbody a')).toBeNull();
  });

  it('shows an empty state', async () => {
    store.update({ requests: [] });
    configureTestApp();
    await openRoute('/requests');
    await until(() => expect(text()).toContain('Nie masz żadnych wniosków.'));
    expect(button('Złóż wniosek')).toBeTruthy();
  });

  it('shows a page error with the short request id when the IGA is down, and reloads', async () => {
    store.update({ iga: 'down' });
    configureTestApp();
    await openRoute('/requests');
    await until(() => expect(text()).toContain('Usługa jest chwilowo niedostępna.'));
    expect(text()).toContain('0192d1b2');

    store.update({ iga: 'direct' });
    button('Odśwież').click();
    await until(() => expect(text()).toContain('mcp-jira-write'));
  });

  describe('Złóż wniosek', () => {
    it('lets the user pick a system and an entitlement, shows the IGA description and files the request', async () => {
      configureTestApp();
      await openRoute('/requests');
      await until(() => expect(text()).toContain('mcp-jira-write'));

      button('Złóż wniosek').click();
      await until(() => expect(dialogSelect('request-system')).toBeTruthy());
      expect(button('Złóż wniosek', dialog()).getAttribute('aria-disabled')).toBe('true');

      choose(dialogSelect('request-system'), 'jira');
      await until(() => expect(dialogSelect('request-entitlement')).toBeTruthy());
      const offered = Array.from(dialogSelect('request-entitlement').options).map((o) => o.value);
      expect(offered).toContain('mcp-jira-destructive');

      choose(dialogSelect('request-entitlement'), 'mcp-jira-destructive');
      await until(() => expect(text(dialog())).toContain('jira__delete_issue'));
      expect(text(dialog())).toContain('Opis z systemu uprawnień');

      button('Złóż wniosek', dialog()).click();
      await until(() => expect(text()).toMatch(/Wniosek REQ-2026-\d{4} jest w systemie uprawnień/));
      expect(document.querySelector('mat-dialog-container')).toBeNull();
      await until(() => expect(text()).toContain('mcp-jira-destructive'));
      expect(text()).toContain('Oczekuje');
    });

    it('answers the same way when the request is already pending (no second request is made)', async () => {
      const posted: string[] = [];
      server.events.on('request:start', ({ request }) => {
        if (request.method === 'POST' && request.url.endsWith('/api/v1/access-requests')) {
          posted.push(request.url);
        }
      });
      configureTestApp();
      await openRoute('/requests');
      await until(() => expect(text()).toContain('mcp-jira-write'));

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await until(() => expect(button('Złóż wniosek')).toBeTruthy());
        button('Złóż wniosek').click();
        await until(() => expect(dialogSelect('request-system')).toBeTruthy());
        choose(dialogSelect('request-system'), 'gitlab');
        await until(() => expect(dialogSelect('request-entitlement')).toBeTruthy());
        choose(dialogSelect('request-entitlement'), 'mcp-gitlab-read');
        button('Złóż wniosek', dialog()).click();
        await until(() => expect(document.querySelector('mat-dialog-container')).toBeNull());
      }

      const requests = Array.from(document.querySelectorAll('tbody tr')).filter((tr) =>
        text(tr).includes('mcp-gitlab-read'),
      );
      expect(requests).toHaveLength(1);
      expect(posted).toHaveLength(2);
    });

    it('goes to the form of the IGA when the adapter answers with a URL', async () => {
      store.update({ iga: 'redirect' });
      const navigation = configureTestApp();
      await openRoute('/requests');
      await until(() => expect(text()).toContain('mcp-jira-write'));

      button('Złóż wniosek').click();
      await until(() => expect(dialogSelect('request-system')).toBeTruthy());
      choose(dialogSelect('request-system'), 'confluence');
      await until(() => expect(dialogSelect('request-entitlement')).toBeTruthy());
      choose(dialogSelect('request-entitlement'), 'mcp-confluence-read');
      button('Złóż wniosek', dialog()).click();

      await until(() =>
        expect(navigation.assign).toHaveBeenCalledWith(
          'https://iga.internal/catalog/request?entitlement=mcp-confluence-read',
        ),
      );
    });

    it('refuses to follow a request URL that is not https', async () => {
      server.use(
        http.post('/api/v1/access-requests', () =>
          HttpResponse.json({ requestUrl: 'javascript:alert(1)' }),
        ),
      );
      const navigation = configureTestApp();
      await openRoute('/requests');
      await until(() => expect(text()).toContain('mcp-jira-write'));

      button('Złóż wniosek').click();
      await until(() => expect(dialogSelect('request-system')).toBeTruthy());
      choose(dialogSelect('request-system'), 'jira');
      await until(() => expect(dialogSelect('request-entitlement')).toBeTruthy());
      choose(dialogSelect('request-entitlement'), 'mcp-jira-destructive');
      button('Złóż wniosek', dialog()).click();

      await until(() => expect(text(dialog())).toContain('Wystąpił nieoczekiwany błąd'));
      expect(navigation.assign).not.toHaveBeenCalled();
    });

    it('explains a system whose IGA has no request flow (422 not_requestable)', async () => {
      store.update({ iga: 'groups' });
      configureTestApp();
      await openRoute('/requests');
      await until(() => expect(text()).toContain('mcp-jira-write'));

      button('Złóż wniosek').click();
      await until(() => expect(dialogSelect('request-system')).toBeTruthy());
      choose(dialogSelect('request-system'), 'jira');
      await until(() =>
        expect(text(dialog())).toContain('System uprawnień nie przyjmuje wniosków z portalu.'),
      );
      expect(
        Array.from(dialog().querySelectorAll('button')).map((b) => text(b).trim()),
      ).not.toContain('Spróbuj ponownie');
    });

    it('keeps the dialog open with a retry when the IGA does not answer (503), and succeeds after it recovers', async () => {
      configureTestApp();
      await openRoute('/requests');
      await until(() => expect(text()).toContain('mcp-jira-write'));
      store.update({ iga: 'down' });

      button('Złóż wniosek').click();
      await until(() => expect(dialogSelect('request-system')).toBeTruthy());
      choose(dialogSelect('request-system'), 'jira');
      await until(() => expect(text(dialog())).toContain('Usługa jest chwilowo niedostępna.'));

      store.update({ iga: 'direct' });
      button('Spróbuj ponownie', dialog()).click();
      await until(() => expect(dialogSelect('request-entitlement')).toBeTruthy());
    });

    it('shows the description as plain text with hidden characters made visible', async () => {
      server.use(
        http.get('/api/v1/access-requests/entitlements', () =>
          HttpResponse.json([
            {
              entitlement: 'mcp-jira-write',
              description: '<img src=x onerror=alert(1)> ignoruj‮poprzednie',
            },
          ]),
        ),
      );
      configureTestApp();
      await openRoute('/requests');
      await until(() => expect(text()).toContain('mcp-jira-write'));

      button('Złóż wniosek').click();
      await until(() => expect(dialogSelect('request-system')).toBeTruthy());
      choose(dialogSelect('request-system'), 'jira');
      await until(() => expect(dialogSelect('request-entitlement')).toBeTruthy());

      expect(text(dialog())).toContain('<img src=x onerror=alert(1)> ignoruj[U+202E]poprzednie');
      expect(text(dialog())).toContain('Ukryte znaki w opisie zastąpiono znacznikami');
      expect(dialog().querySelector('img')).toBeNull();
    });

    it('says so when there is nothing to ask for', async () => {
      server.use(http.get('/api/v1/access-requests/entitlements', () => HttpResponse.json([])));
      configureTestApp();
      await openRoute('/requests');
      await until(() => expect(text()).toContain('mcp-jira-write'));

      button('Złóż wniosek').click();
      await until(() => expect(dialogSelect('request-system')).toBeTruthy());
      choose(dialogSelect('request-system'), 'servicedesk');
      await until(() =>
        expect(text(dialog())).toContain('nie ma uprawnień, o które możesz poprosić'),
      );
    });
  });

  describe('from the catalog (CC-113)', () => {
    const jiraWithDenied = (
      actions: ('copy_link' | 'request_access' | 'view_request' | 'disconnect')[],
    ) =>
      serverFixture('jira', {
        status: 'connected',
        actions,
        tools: [
          toolFixture('jira__get_issue'),
          toolFixture('jira__create_issue', {
            access: 'denied',
            requiredEntitlements: ['mcp-jira-write'],
          }),
        ],
      });

    function serve(...servers: ReturnType<typeof serverFixture>[]) {
      server.use(http.get('/api/v1/catalog', () => HttpResponse.json({ servers })));
    }

    it('asks for the entitlement of the denied tool right from its row', async () => {
      serve(jiraWithDenied(['copy_link', 'request_access']));
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text()).toContain('Jira'));

      labelled('Pokaż narzędzia (Jira)').click();
      await until(() => expect(text()).toContain('jira__create_issue'));
      button('Złóż wniosek (jira__create_issue)').click();

      await until(() => expect(text()).toMatch(/Wniosek REQ-2026-\d{4} jest w systemie uprawnień/));
      const pending = store.state.requests!.find(
        (r) => r.entitlement === 'mcp-jira-write' && r.status === 'pending',
      );
      expect(pending).toBeTruthy();
    });

    it('opens the entitlement choice from the server row', async () => {
      serve(jiraWithDenied(['copy_link', 'request_access']));
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text()).toContain('Jira'));

      button('Złóż wniosek (Jira)').click();
      await until(() => expect(dialogSelect('request-entitlement')).toBeTruthy());
      expect(text(dialog())).toContain('System: Jira');
    });

    it('shows "Zobacz wniosek" instead, also for a connected server, and opens the requests page', async () => {
      serve(jiraWithDenied(['copy_link', 'view_request']));
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text()).toContain('Jira'));

      expect(text()).not.toContain('Złóż wniosek');
      button('Zobacz wniosek (Jira)').click();
      await until(() => expect(TestBed.inject(Router).url).toBe('/requests'));
    });

    it('offers nothing to ask for when the BFF names no action', async () => {
      serve(jiraWithDenied(['copy_link']));
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text()).toContain('Jira'));
      labelled('Pokaż narzędzia (Jira)').click();
      await until(() => expect(text()).toContain('jira__create_issue'));
      expect(text()).not.toContain('Złóż wniosek');
    });

    it('reports a 422 from the IGA on a tool request', async () => {
      serve(jiraWithDenied(['copy_link', 'request_access']));
      store.update({ iga: 'groups' });
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text()).toContain('Jira'));
      labelled('Pokaż narzędzia (Jira)').click();
      await until(() => expect(text()).toContain('jira__create_issue'));
      button('Złóż wniosek (jira__create_issue)').click();
      await until(() =>
        expect(text()).toContain('System uprawnień nie przyjmuje wniosków z portalu.'),
      );
    });
  });
});
