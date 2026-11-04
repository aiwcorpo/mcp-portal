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
    expect(text(rows[0])).toContain('OpenSearch, read');
    expect(text(rows[0])).toContain('Pending');
    expect(text(rows[0])).toContain('Open in the entitlement system');
    expect(text(rows[1])).toContain('Approved');
    expect(text(rows[1])).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(text(rows[2])).toContain('Rejected');
    expect(text(rows[3])).toContain('Cancelled');
    expect(rows[1].querySelector('a')).toBeNull();
    expect(text()).toContain('Requests are approved and cancelled in the entitlement system.');
    expect(document.body.textContent).not.toMatch(/Reject(?!ed)/);
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
    await until(() => expect(text()).toContain('You have no requests.'));
    expect(button('Submit request')).toBeTruthy();
  });

  it('shows a page error with the short request id when the IGA is down, and reloads', async () => {
    store.update({ iga: 'down' });
    configureTestApp();
    await openRoute('/requests');
    await until(() => expect(text()).toContain('The service is temporarily unavailable.'));
    expect(text()).toContain('0192d1b2');

    store.update({ iga: 'direct' });
    button('Refresh').click();
    await until(() => expect(text()).toContain('mcp-jira-write'));
  });

  describe('Submit request', () => {
    it('lets the user pick a system and an entitlement, shows the IGA description and files the request', async () => {
      configureTestApp();
      await openRoute('/requests');
      await until(() => expect(text()).toContain('mcp-jira-write'));

      button('Submit request').click();
      await until(() => expect(dialogSelect('request-system')).toBeTruthy());
      expect(button('Submit request', dialog()).getAttribute('aria-disabled')).toBe('true');

      choose(dialogSelect('request-system'), 'jira');
      await until(() => expect(dialogSelect('request-entitlement')).toBeTruthy());
      const offered = Array.from(dialogSelect('request-entitlement').options).map((o) => o.value);
      expect(offered).toContain('mcp-jira-destructive');

      choose(dialogSelect('request-entitlement'), 'mcp-jira-destructive');
      await until(() => expect(text(dialog())).toContain('jira__delete_issue'));
      expect(text(dialog())).toContain('Description from the entitlement system');

      button('Submit request', dialog()).click();
      await until(() =>
        expect(text()).toMatch(/Request REQ-2026-\d{4} is in the entitlement system/),
      );
      expect(document.querySelector('mat-dialog-container')).toBeNull();
      await until(() => expect(text()).toContain('mcp-jira-destructive'));
      expect(text()).toContain('Pending');
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
        await until(() => expect(button('Submit request')).toBeTruthy());
        button('Submit request').click();
        await until(() => expect(dialogSelect('request-system')).toBeTruthy());
        choose(dialogSelect('request-system'), 'gitlab');
        await until(() => expect(dialogSelect('request-entitlement')).toBeTruthy());
        choose(dialogSelect('request-entitlement'), 'mcp-gitlab-read');
        button('Submit request', dialog()).click();
        await until(() => expect(document.querySelector('mat-dialog-container')).toBeNull());
      }

      await until(() => expect(text()).toContain('mcp-gitlab-read'));
      await until(() =>
        expect(
          Array.from(document.querySelectorAll('tbody tr')).filter((tr) =>
            text(tr).includes('mcp-gitlab-read'),
          ),
        ).toHaveLength(1),
      );
      expect(posted).toHaveLength(2);
      expect(
        store.state.requests!.filter((candidate) => candidate.entitlement === 'mcp-gitlab-read'),
      ).toHaveLength(1);
    });

    it('goes to the form of the IGA when the adapter answers with a URL', async () => {
      store.update({ iga: 'redirect' });
      const navigation = configureTestApp();
      await openRoute('/requests');
      await until(() => expect(text()).toContain('mcp-jira-write'));

      button('Submit request').click();
      await until(() => expect(dialogSelect('request-system')).toBeTruthy());
      choose(dialogSelect('request-system'), 'confluence');
      await until(() => expect(dialogSelect('request-entitlement')).toBeTruthy());
      choose(dialogSelect('request-entitlement'), 'mcp-confluence-read');
      button('Submit request', dialog()).click();

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

      button('Submit request').click();
      await until(() => expect(dialogSelect('request-system')).toBeTruthy());
      choose(dialogSelect('request-system'), 'jira');
      await until(() => expect(dialogSelect('request-entitlement')).toBeTruthy());
      choose(dialogSelect('request-entitlement'), 'mcp-jira-destructive');
      button('Submit request', dialog()).click();

      await until(() => expect(text(dialog())).toContain('An unexpected error occurred'));
      expect(navigation.assign).not.toHaveBeenCalled();
    });

    it('explains a system whose IGA has no request flow (422 not_requestable)', async () => {
      store.update({ iga: 'groups' });
      configureTestApp();
      await openRoute('/requests');
      await until(() => expect(text()).toContain('mcp-jira-write'));

      button('Submit request').click();
      await until(() => expect(dialogSelect('request-system')).toBeTruthy());
      choose(dialogSelect('request-system'), 'jira');
      await until(() =>
        expect(text(dialog())).toContain(
          'The entitlement system does not accept requests from the portal.',
        ),
      );
      expect(
        Array.from(dialog().querySelectorAll('button')).map((b) => text(b).trim()),
      ).not.toContain('Try again');
    });

    it('keeps the dialog open with a retry when the IGA does not answer (503), and succeeds after it recovers', async () => {
      configureTestApp();
      await openRoute('/requests');
      await until(() => expect(text()).toContain('mcp-jira-write'));
      store.update({ iga: 'down' });

      button('Submit request').click();
      await until(() => expect(dialogSelect('request-system')).toBeTruthy());
      choose(dialogSelect('request-system'), 'jira');
      await until(() =>
        expect(text(dialog())).toContain('The service is temporarily unavailable.'),
      );

      store.update({ iga: 'direct' });
      button('Try again', dialog()).click();
      await until(() => expect(dialogSelect('request-entitlement')).toBeTruthy());
    });

    it('shows the description as plain text with hidden characters made visible', async () => {
      server.use(
        http.get('/api/v1/access-requests/entitlements', () =>
          HttpResponse.json([
            {
              entitlement: 'mcp-jira-write',
              description: '<img src=x onerror=alert(1)> ignore\u202Eprevious',
            },
          ]),
        ),
      );
      configureTestApp();
      await openRoute('/requests');
      await until(() => expect(text()).toContain('mcp-jira-write'));

      button('Submit request').click();
      await until(() => expect(dialogSelect('request-system')).toBeTruthy());
      choose(dialogSelect('request-system'), 'jira');
      await until(() => expect(dialogSelect('request-entitlement')).toBeTruthy());

      expect(text(dialog())).toContain('<img src=x onerror=alert(1)> ignore[U+202E]previous');
      expect(text(dialog())).toContain('Hidden characters in the description were replaced with');
      expect(dialog().querySelector('img')).toBeNull();
    });

    it('says so when there is nothing to ask for', async () => {
      server.use(http.get('/api/v1/access-requests/entitlements', () => HttpResponse.json([])));
      configureTestApp();
      await openRoute('/requests');
      await until(() => expect(text()).toContain('mcp-jira-write'));

      button('Submit request').click();
      await until(() => expect(dialogSelect('request-system')).toBeTruthy());
      choose(dialogSelect('request-system'), 'servicedesk');
      await until(() => expect(text(dialog())).toContain('has no entitlements you can request'));
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

      labelled('Show tools (Jira)').click();
      await until(() => expect(text()).toContain('jira__create_issue'));
      button('Submit request (jira__create_issue)').click();

      await until(() =>
        expect(text()).toMatch(/Request REQ-2026-\d{4} is in the entitlement system/),
      );
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

      button('Submit request (Jira)').click();
      await until(() => expect(dialogSelect('request-entitlement')).toBeTruthy());
      expect(text(dialog())).toContain('System: Jira');
    });

    it('shows "View request" instead, also for a connected server, and opens the requests page', async () => {
      serve(jiraWithDenied(['copy_link', 'view_request']));
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text()).toContain('Jira'));

      expect(text()).not.toContain('Submit request');
      button('View request (Jira)').click();
      await until(() => expect(TestBed.inject(Router).url).toBe('/requests'));
    });

    it('offers nothing to ask for when the BFF names no action', async () => {
      serve(jiraWithDenied(['copy_link']));
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text()).toContain('Jira'));
      labelled('Show tools (Jira)').click();
      await until(() => expect(text()).toContain('jira__create_issue'));
      expect(text()).not.toContain('Submit request');
    });

    it('reports a 422 from the IGA on a tool request', async () => {
      serve(jiraWithDenied(['copy_link', 'request_access']));
      store.update({ iga: 'groups' });
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text()).toContain('Jira'));
      labelled('Show tools (Jira)').click();
      await until(() => expect(text()).toContain('jira__create_issue'));
      button('Submit request (jira__create_issue)').click();
      await until(() =>
        expect(text()).toContain(
          'The entitlement system does not accept requests from the portal.',
        ),
      );
    });
  });
});
