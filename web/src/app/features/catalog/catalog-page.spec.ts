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
    await until(() => expect(text()).toContain('Gitlab'));

    expect(text(row('Jira'))).toContain('Token expires in 5 days');
    expect(text(row('Jira'))).toContain('PAT token');
    expect(text(row('Jira'))).toContain('5 tools');
    expect(button('Renew (Jira)', row('Jira')).classList).toContain('mat-mdc-unelevated-button');
    expect(button('Copy link (Jira)', row('Jira'))).toBeTruthy();
    expect(text(row('Gitlab'))).toContain('Needs reconnecting');
    expect(button('Connect (Gitlab)', row('Gitlab'))).toBeTruthy();
    expect(text(row('Confluence'))).toContain('No entitlement');
    expect(button('Submit request (Confluence)', row('Confluence'))).toBeTruthy();
    expect(text(row('Servicedesk'))).toContain('Service account');
    expect(text(row('Servicedesk'))).toContain('Connected');
    expect(document.body.textContent).not.toContain('Disconnect');
  });

  describe('Authenticator at tools that need a code', () => {
    const destructive = serverFixture('jira', {
      tools: [
        toolFixture('jira__delete_issue', {
          risk: 'DESTRUCTIVE',
          action: 'delete',
          requiresConfirmation: true,
        }),
      ],
    });

    async function openTools(): Promise<void> {
      configureTestApp();
      await openRoute('/catalog');
      await until(() => expect(text()).toContain('Jira'));
      labelled('Show tools (Jira)', row('Jira')).click();
      await until(() => expect(text()).toContain('jira__delete_issue'));
    }

    it('asks to register next to the tool when there is no registration', async () => {
      server.use(serve([destructive]));
      await openTools();
      await until(() => expect(text()).toContain('You have no Authenticator'));
      const link = Array.from(document.querySelectorAll('app-authenticator-state a')).find(
        (candidate) => candidate.textContent?.includes('Register'),
      );
      expect(link?.getAttribute('href')).toBe('/authenticator/register');
      expect(text()).not.toContain('Requires a code from the Authenticator.');
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
      await openTools();
      await until(() => expect(text()).toContain('Register again'));
      expect(text()).toContain('switched off after 20 wrong codes');
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
      await openTools();
      await until(() => expect(text()).toMatch(/Locked until \d{2}:\d{2}/));
      expect(text()).not.toContain('Register');
      expect(text()).not.toContain('Unlock');
    });

    it('keeps the plain note when the registration is active', async () => {
      store.update({ authenticator: { state: 'active', registeredAt: '2026-10-27T09:00:00Z' } });
      server.use(serve([destructive]));
      await openTools();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(text()).toContain('Requires a code from the Authenticator.');
      expect(text()).not.toContain('Register');
    });

    it('does not break the catalog when the registration cannot be read', async () => {
      server.use(
        serve([destructive]),
        http.get('/api/v1/authenticator', () =>
          HttpResponse.json({ error: 'upstream_unavailable' }, { status: 503 }),
        ),
      );
      await openTools();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(text()).toContain('Requires a code from the Authenticator.');
      expect(text()).not.toContain('Could not load the data');
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
        'Connected',
        ['Copy link (Jira)'],
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
        'Connection expires in 3 days',
        ['Connect (Jira)', 'Copy link (Jira)'],
      ],
      [
        'reconnect_required',
        serverFixture('jira', {
          status: 'reconnect_required',
          actions: ['add_secret', 'disconnect'],
          connection: connectionFixture('jira', { type: 'user-secret', status: 'expired' }),
        }),
        'Needs reconnecting',
        ['Renew (Jira)'],
      ],
      [
        'not_connected',
        serverFixture('jira', {
          status: 'not_connected',
          actions: ['connect_oauth', 'add_secret'],
        }),
        'Not connected',
        ['Connect with OAuth (Jira)', 'Add token (Jira)'],
      ],
      [
        'request_pending',
        serverFixture('jira', {
          status: 'request_pending',
          actions: ['view_request'],
          tools: [toolFixture('jira__get', { access: 'denied' })],
        }),
        'Request pending',
        ['View request (Jira)'],
      ],
      [
        'no_access',
        serverFixture('jira', {
          status: 'no_access',
          actions: ['request_access'],
          tools: [toolFixture('jira__get', { access: 'denied' })],
        }),
        'No entitlement',
        ['Submit request (Jira)'],
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

  it('says why a tool is off: an emergency switch, a definition waiting for approval, or plain disabled', async () => {
    server.use(
      serve([
        serverFixture('jira', {
          tools: [
            toolFixture('jira__a', { disabled: true, disabledBy: 'kill_switch' }),
            toolFixture('jira__b', { disabled: true, disabledBy: 'approval' }),
            toolFixture('jira__c', { disabled: true, disabledBy: 'configuration' }),
            toolFixture('jira__d', { disabled: true }),
          ],
        }),
      ]),
    );
    configureTestApp();
    const harness = await openRoute('/catalog');
    await until(() => expect(text()).toContain('Jira'));
    labelled('Show tools (Jira)', row('Jira')).click();
    await harness.fixture.whenStable();

    const rows = Array.from(row('Jira').querySelectorAll('tr.tool')).map((tr) => text(tr));
    expect(rows[0]).toContain('Switched off in an emergency by an administrator.');
    expect(rows[1]).toContain('Waiting for approval by an administrator.');
    expect(rows[2]).toContain('Switched off by an administrator.');
    expect(rows[3]).toContain('Switched off by an administrator.');
  });

  it('calls for connecting again when the connection is in the error state (the secret is gone)', async () => {
    server.use(
      serve([
        serverFixture('jira', {
          status: 'reconnect_required',
          actions: ['add_secret', 'disconnect'],
          connection: connectionFixture('jira', { type: 'user-secret', status: 'error' }),
        }),
      ]),
    );
    configureTestApp();
    await openRoute('/catalog');

    await until(() =>
      expect(text(row('Jira'))).toContain('Connection stopped working, connect the account again'),
    );
    expect(button('Renew (Jira)', row('Jira'))).toBeTruthy();
  });

  it('expands the tools of a server: id, title, entitlement, risk and notes', async () => {
    server.use(
      serve([
        serverFixture('jira', {
          tools: [
            toolFixture('jira__search_issues', {
              title: 'Search issues (JQL)',
              requiredEntitlements: ['mcp-jira-read'],
            }),
            toolFixture('jira__delete_issue', {
              title: 'Delete issue',
              risk: 'DESTRUCTIVE',
              action: 'delete',
              requiresConfirmation: true,
              requiredEntitlements: ['mcp-jira-destructive'],
            }),
            toolFixture('jira__move', { disabled: true, title: 'Move' }),
          ],
        }),
      ]),
    );
    store.update({ authenticator: { state: 'active', registeredAt: '2026-10-27T09:00:00Z' } });
    configureTestApp();
    const harness = await openRoute('/catalog');
    await until(() => expect(text()).toContain('Jira'));

    const toggle = labelled('Show tools (Jira)', row('Jira'));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    toggle.click();
    await harness.fixture.whenStable();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).toBeTruthy();
    const body = text(row('Jira'));
    expect(body).toContain('jira__search_issues');
    expect(body).toContain('Search issues (JQL)');
    expect(body).toContain('mcp-jira-read · Read');
    expect(body).toContain('mcp-jira-destructive · Delete');
    expect(body).toContain('Requires a code from the Authenticator.');
    expect(body).toContain('Switched off by an administrator.');
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
    await until(() => expect(text()).toContain('Gitlab'));

    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'merge';
    search.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();

    expect(text()).not.toContain('Jira');
    expect(text(row('Gitlab'))).toContain('gitlab__list_merge_requests');

    search.value = 'brak takiego';
    search.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
    expect(text()).toContain('No server or tool matches the search.');
  });

  it('shows the wait from Retry-After when starting OAuth hits a limit (429)', async () => {
    server.use(
      http.post('/api/v1/connections/gitlab/oauth', () =>
        HttpResponse.json(
          { error: 'rate_limited' },
          { status: 429, headers: { 'Retry-After': '45' } },
        ),
      ),
    );
    const navigation = configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('Gitlab'));

    button('Connect (Gitlab)').click();

    await until(() => expect(text()).toContain('Too many requests. Try again in 45 s.'));
    expect(navigation.assign).not.toHaveBeenCalled();
  });

  it('copies the server URL from the catalog', async () => {
    configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('Jira'));
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);

    button('Copy link (Jira)').click();

    expect(copy).toHaveBeenCalledWith('https://mcp.aiwcorpo.pl/s/mcp-jira/mcp');
    await until(() => expect(text()).toContain('Copied the address of the Jira server.'));
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
    await until(() => expect(text()).toContain('Gitlab'));

    button('Connect (Gitlab)').click();

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

    button('Renew (Jira)').click();

    await until(() => expect(TestBed.inject(Router).url).toBe('/connect/jira'));
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
      await until(() => expect(text()).toContain('Connected to Gitlab as anna.nowak.'));
      await until(() => expect(location.search).not.toContain('connected'));
      expect(location.search).not.toContain('system');
    });

    it.each([
      ['flow_invalid', 'The connection link expired or was already used. Start again.'],
      ['provider_error', 'Gitlab did not respond correctly. Try again in a moment.'],
      ['identity_mismatch', 'Gitlab did not respond correctly. Try again in a moment.'],
      ['cancelled', 'Connecting to Gitlab cancelled.'],
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
      await until(() => expect(text(row('Gitlab'))).toContain('Not connected'));

      expect(text()).not.toContain('Connected to Gitlab');
      await until(() => expect(location.search).not.toContain('connected'));
    });

    it('does not trust an unknown connectError or system name', async () => {
      configureTestApp();
      await openRoute('/catalog?system=<img>&connectError=<script>');
      await until(() => expect(text()).toContain('The system did not respond correctly.'));
      expect(document.querySelector('img')).toBeNull();
      expect(text()).not.toContain('<script>');
    });

    it('can be dismissed', async () => {
      configureTestApp();
      await openRoute('/catalog?connectError=cancelled&system=gitlab');
      await until(() => expect(text()).toContain('cancelled'));
      labelled('Close message').click();
      await until(() => expect(text()).not.toContain('Connecting to Gitlab cancelled.'));
    });
  });

  it('shows the empty state of mockup 02', async () => {
    server.use(serve([]));
    configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('You do not have access to any MCP server yet'));
    expect(text()).toContain('Once a request is approved, the servers appear here.');
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
    await until(() => expect(text()).toContain('Could not load the data.'));
    expect(text()).toContain('The service is temporarily unavailable.');
    expect(text()).toMatch(/Reference for support:\s*7f3a9c21/);
    expect(text()).not.toContain('7f3a9c21-aaaa');
    expect(text()).not.toContain('ConnectException');

    button('Refresh').click();
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
    labelled('Show tools (Jira)').click();
    await harness.fixture.whenStable();

    expect(text(row('Jira'))).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
  });
});
