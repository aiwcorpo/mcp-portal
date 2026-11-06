import { TestBed } from '@angular/core/testing';
import { SessionService } from '../../core/session.service';
import { ResumeIntentStore } from '../../core/resume-intent';
import { HttpResponse, http } from 'msw';
import { AuthenticatorStatus } from '../../api/generated';
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
  const { server, store } = useMockApi();

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
    await until(() => expect(text()).toContain('Servicedesk'));

    expect(text(row('Jira'))).toContain('PAT token');
    expect(text(row('Jira'))).toContain('jkowalski');
    expect(text(row('Jira'))).toMatch(/\d{2}\.\d{2}\.\d{4} · in 5 days/);
    expect(text(row('Jira'))).toMatch(/today \d{2}:\d{2}/);
    expect(button('Renew (Jira)', row('Jira'))).toBeTruthy();
    expect(button('Disconnect (Jira)', row('Jira'))).toBeTruthy();
    expect(text(row('Gitlab'))).toContain('refreshed automatically');
    expect(text(row('Gitlab'))).toContain('20.10.2026');
    expect(text(row('Confluence'))).toContain('needs reconnecting');
    expect(button('Connect (Confluence)', row('Confluence'))).toBeTruthy();
    expect(text(row('Servicedesk'))).toContain('Service account');
    expect(row('Servicedesk').querySelector('button')).toBeNull();
    expect(text(row('Opensearch'))).toContain('no entitlement');
    expect(button('Submit request (Opensearch)', row('Opensearch'))).toBeTruthy();
    expect(text(row('Opensearch'))).not.toContain('Add token');
    expect(text()).toContain('Last used');
  });

  it('says the connection stopped working and asks to connect again when the secret is gone (error)', async () => {
    server.use(
      serve([
        serverFixture('jira', {
          status: 'reconnect_required',
          actions: ['add_secret', 'disconnect'],
          connection: connectionFixture('jira', { type: 'user-secret', status: 'error' }),
        }),
        serverFixture('confluence', {
          status: 'reconnect_required',
          actions: ['reconnect', 'disconnect'],
          connection: connectionFixture('confluence', { status: 'revoked' }),
        }),
      ]),
    );
    configureTestApp();
    await openRoute('/connections');

    await until(() => expect(text()).toContain('Confluence'));
    const jira = Array.from(document.querySelectorAll('tbody tr')).find((tr) =>
      text(tr).includes('Jira'),
    )!;
    const confluence = Array.from(document.querySelectorAll('tbody tr')).find((tr) =>
      text(tr).includes('Confluence'),
    )!;
    expect(text(jira)).toContain('stopped working, reconnect the account');
    expect(button('Renew (Jira)', jira)).toBeTruthy();
    // A revoked connection keeps the older wording: it does not say the secret is gone.
    expect(text(confluence)).toContain('needs reconnecting');
  });

  it('says plainly that an administrator changed the system and the connection has to be made again (needs_reconnect)', async () => {
    server.use(
      serve([
        serverFixture('notes', {
          status: 'reconnect_required',
          actions: ['reconnect', 'disconnect'],
          connection: connectionFixture('notes', { type: 'user-oauth', status: 'needs_reconnect' }),
        }),
        serverFixture('jira', { connection: connectionFixture('jira') }),
      ]),
    );
    configureTestApp();
    await openRoute('/connections');

    await until(() => expect(text()).toContain('Notes'));
    expect(text()).toContain('An administrator changed the settings of the system');
    expect(text()).toContain('Connect the account again: Notes.');
    const notes = Array.from(document.querySelectorAll('tbody tr')).find((tr) =>
      text(tr).includes('Notes'),
    )!;
    expect(text(notes)).toContain(
      'the administrator changed the system settings, connect the account again',
    );
    expect(button('Connect (Notes)', notes)).toBeTruthy();
  });

  it('shows no banner while every connection works', async () => {
    configureTestApp();
    await openRoute('/connections');
    await until(() => expect(text()).toContain('Jira'));

    expect(text()).not.toContain('An administrator changed the settings of the system');
  });

  it('disconnects after confirmation and reloads', async () => {
    configureTestApp();
    const harness = await openRoute('/connections');
    await until(() => expect(text()).toContain('Jira'));

    button('Disconnect (Jira)').click();
    await harness.fixture.whenStable();
    const dialog = document.querySelector('mat-dialog-container')!;
    expect(text(dialog)).toContain('Disconnect account Jira?');
    button('Disconnect', dialog).click();

    await until(() => expect(text()).toContain('Disconnected account Jira.'));
    await until(() => expect(text(row('Jira'))).toContain('Add token'));
  });

  it('keeps the connection when the dialog is cancelled', async () => {
    configureTestApp();
    const harness = await openRoute('/connections');
    await until(() => expect(text()).toContain('Jira'));

    button('Disconnect (Jira)').click();
    await harness.fixture.whenStable();
    button('Cancel', document.querySelector('mat-dialog-container')!).click();

    await until(() => expect(document.querySelector('mat-dialog-container')).toBeNull());
    expect(text()).not.toContain('Disconnected');
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
    await until(() => expect(text()).toContain('The service is temporarily unavailable.'));
    expect(text()).toContain('abcdef12');

    button('Refresh').click();
    await until(() => expect(text()).toContain('Jira'));
  });

  it('shows an empty state', async () => {
    server.use(serve([]));
    configureTestApp();
    await openRoute('/connections');
    await until(() => expect(text()).toContain('You have no connections yet'));
  });

  describe('last use of a service account', () => {
    function lastUseCell(): string {
      return row('Servicedesk').querySelectorAll('td')[3].textContent!.trim();
    }

    it('comes from the newest call in the activity log', async () => {
      const queries: URLSearchParams[] = [];
      server.events.on('request:start', ({ request }) => {
        const url = new URL(request.url);
        if (url.pathname === '/api/v1/activity/calls') {
          queries.push(url.searchParams);
        }
      });
      configureTestApp();
      await openRoute('/connections');
      await until(() => expect(text()).toContain('Servicedesk'));
      await until(() => expect(lastUseCell()).toMatch(/\d{2}\.\d{2}\.\d{4}|today \d{2}:\d{2}/));
      expect(queries.map((query) => query.get('q'))).toEqual(['servicedesk__']);
      expect(queries[0].get('limit')).toBe('20');
    });

    it('skips calls of other systems that only match by resource id, and calls refused before the system', async () => {
      server.use(
        http.get('/api/v1/activity/calls', () =>
          HttpResponse.json([
            {
              requestId: '0192d1b2-7c3a-7d4e-8f10-000000000001',
              ts: '2026-10-28T10:00:00.000Z',
              tool: 'gitlab__get_project',
              result: 'ok',
              resource: { type: 'Gitlab::Project', id: 'group/servicedesk__tools' },
            },
            {
              requestId: '0192d1b2-7c3a-7d4e-8f10-000000000002',
              ts: '2026-10-28T09:00:00.000Z',
              tool: 'servicedesk__get_ticket',
              result: 'denied_not_granted',
            },
            {
              requestId: '0192d1b2-7c3a-7d4e-8f10-000000000003',
              ts: '2026-10-20T08:00:00.000Z',
              tool: 'servicedesk__get_ticket',
              result: 'ok',
            },
          ]),
        ),
      );
      configureTestApp();
      await openRoute('/connections');
      await until(() => expect(text()).toContain('Servicedesk'));
      await until(() => expect(lastUseCell()).toBe('20.10.2026'));
    });

    it('stays empty, without an error, when the log cannot be read', async () => {
      server.use(
        http.get('/api/v1/activity/calls', () =>
          HttpResponse.json({ error: 'upstream_unavailable' }, { status: 503 }),
        ),
      );
      configureTestApp();
      await openRoute('/connections');
      await until(() => expect(text()).toContain('Servicedesk'));
      expect(lastUseCell()).toBe('—');
      expect(text()).not.toContain('Could not load the data');
    });
  });

  describe('Authenticator section', () => {
    async function open(status: AuthenticatorStatus) {
      store.update({ authenticator: status });
      const navigation = configureTestApp();
      await TestBed.inject(SessionService).load();
      const harness = await openRoute('/connections');
      await until(() => expect(text()).toContain('MCP Platform'));
      return { navigation, harness };
    }

    it('offers registration when there is none', async () => {
      await open({ state: 'none' });
      expect(text()).toContain('The "MCP Platform" account in Microsoft Authenticator.');
      expect(text()).toContain('Not registered');
      expect(document.querySelector('app-authenticator-section a')?.getAttribute('href')).toBe(
        '/authenticator/register',
      );
      expect(text()).not.toContain('Remove');
    });

    it('shows an active registration with its dates and a removal button', async () => {
      await open({
        state: 'active',
        registeredAt: '2026-10-27T09:00:00Z',
        lastUsedAt: new Date().toISOString(),
      });
      expect(text()).toMatch(/Active · since 27\.10\.2026 · last used today \d{2}:\d{2}/);
      expect(button('Remove')).toBeTruthy();
    });

    it('says when an active registration was never used', async () => {
      await open({ state: 'active', registeredAt: '2026-10-27T09:00:00Z' });
      expect(text()).toContain('never used');
    });

    it('shows the end of a block, without an unlock action', async () => {
      await open({
        state: 'active',
        registeredAt: '2026-10-27T09:00:00Z',
        lockedUntil: new Date(Date.now() + 600_000).toISOString(),
      });
      expect(text()).toMatch(/Locked until \d{2}:\d{2} · 5 wrong codes in 15 minutes/);
      expect(text()).toContain('A lock is lifted only by time.');
      expect(text()).not.toMatch(/Unlock/);
      expect(button('Remove')).toBeTruthy();
    });

    it('shows a switched-off authenticator with the banner and the single action', async () => {
      await open({
        state: 'disabled',
        registeredAt: '2026-10-27T09:00:00Z',
        disabledAt: '2026-10-28T11:00:00Z',
        disabledReason: 'daily_failure_limit',
      });
      expect(text()).toContain(
        'The Authenticator was switched off after 20 wrong codes in one day.',
      );
      expect(text()).toContain('Switched off · 28.10.2026');
      expect(document.querySelector('app-authenticator-section a')?.textContent).toContain(
        'Register again',
      );
      expect(text()).not.toContain('Remove');
    });

    it('removes the registration after a warning and a fresh MFA', async () => {
      store.update({ mfaFresh: true });
      const { harness } = await open({ state: 'active', registeredAt: '2026-10-27T09:00:00Z' });
      button('Remove').click();
      await harness.fixture.whenStable();
      const dialog = document.querySelector('mat-dialog-container')!;
      expect(text(dialog)).toContain('Remove the Authenticator?');
      expect(text(dialog)).toContain(
        'Without the Authenticator the agent will not run irreversible operations.',
      );
      expect(text(dialog)).toContain('Removal requires identity confirmation (MFA).');
      button('Remove', dialog).click();

      await until(() => expect(text()).toContain('Authenticator removed.'));
      await until(() => expect(text()).toContain('Not registered'));
      expect(store.state.authenticator.state).toBe('none');
    });

    it('keeps the registration when the warning is cancelled', async () => {
      const { harness } = await open({ state: 'active', registeredAt: '2026-10-27T09:00:00Z' });
      button('Remove').click();
      await harness.fixture.whenStable();
      button('Cancel', document.querySelector('mat-dialog-container')!).click();
      await until(() => expect(document.querySelector('mat-dialog-container')).toBeNull());
      expect(store.state.authenticator.state).toBe('active');
    });

    it('asks the IdP for a fresh MFA first and returns to this page', async () => {
      const { navigation, harness } = await open({
        state: 'active',
        registeredAt: '2026-10-27T09:00:00Z',
      });
      button('Remove').click();
      await harness.fixture.whenStable();
      button('Remove', document.querySelector('mat-dialog-container')!).click();

      await until(() => expect(navigation.assign).toHaveBeenCalled());
      const target = new URL(navigation.assign.mock.calls[0][0], location.origin);
      expect(target.searchParams.get('stepUp')).toBe('true');
      expect(target.searchParams.get('returnPath')).toBe('/connections?mfa=ok');
      expect(store.state.authenticator.state).toBe('active');
    });

    it('removes the registration after the return from the MFA without a second click, once (U12)', async () => {
      store.update({
        mfaFresh: true,
        authenticator: { state: 'active', registeredAt: '2026-10-27T09:00:00Z' },
      });
      configureTestApp();
      await TestBed.inject(SessionService).load();
      TestBed.inject(ResumeIntentStore).save(
        { kind: 'remove-authenticator', registeredAt: '2026-10-27T09:00:00Z' },
        TestBed.inject(SessionService).username(),
      );
      await openRoute('/connections?mfa=ok');

      await until(() => expect(text()).toContain('Authenticator removed.'));
      expect(store.state.authenticator.state).toBe('none');
      expect(sessionStorage.getItem('mcp-portal-resume')).toBeNull();
      expect(document.querySelector('mat-dialog-container')).toBeNull();
    });

    it('does not remove the registration for another user of the same tab (the intent is bound to the user)', async () => {
      store.update({
        mfaFresh: true,
        authenticator: { state: 'active', registeredAt: '2026-10-27T09:00:00Z' },
      });
      configureTestApp();
      await TestBed.inject(SessionService).load();
      TestBed.inject(ResumeIntentStore).save(
        { kind: 'remove-authenticator', registeredAt: '2026-10-27T09:00:00Z' },
        'somebody-else',
      );
      await openRoute('/connections?mfa=ok');
      await until(() => expect(text()).toContain('You can now remove the Authenticator.'));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(store.state.authenticator.state).toBe('active');
    });

    it('does not remove a registration other than the one that was shown in the dialog', async () => {
      store.update({
        mfaFresh: true,
        authenticator: { state: 'active', registeredAt: '2026-10-29T09:00:00Z' },
      });
      configureTestApp();
      await TestBed.inject(SessionService).load();
      TestBed.inject(ResumeIntentStore).save(
        { kind: 'remove-authenticator', registeredAt: '2026-10-27T09:00:00Z' },
        TestBed.inject(SessionService).username(),
      );
      await openRoute('/connections?mfa=ok');
      await until(() => expect(text()).toContain('You can now remove the Authenticator.'));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(store.state.authenticator.state).toBe('active');
    });

    it('drops the intent on logout, so the next user of the tab inherits nothing', async () => {
      configureTestApp();
      const session = TestBed.inject(SessionService);
      await session.load();
      const store = TestBed.inject(ResumeIntentStore);
      store.save({ kind: 'enroll-authenticator' }, session.username());
      await session.logout();
      expect(sessionStorage.getItem('mcp-portal-resume')).toBeNull();
    });

    it('keeps the intent of the removal in this tab until the page is back', async () => {
      const { navigation, harness } = await open({
        state: 'active',
        registeredAt: '2026-10-27T09:00:00Z',
      });
      button('Remove').click();
      await harness.fixture.whenStable();
      button('Remove', document.querySelector('mat-dialog-container')!).click();
      await until(() => expect(navigation.assign).toHaveBeenCalled());
      expect(JSON.parse(sessionStorage.getItem('mcp-portal-resume') ?? '{}').intent).toEqual({
        kind: 'remove-authenticator',
        registeredAt: '2026-10-27T09:00:00Z',
      });
    });

    it('does not remove anything for a bare ?mfa=ok link without the intent of this tab', async () => {
      store.update({
        mfaFresh: true,
        authenticator: { state: 'active', registeredAt: '2026-10-27T09:00:00Z' },
      });
      configureTestApp();
      await openRoute('/connections?mfa=ok');
      await until(() => expect(text()).toContain('You can now remove the Authenticator.'));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(store.state.authenticator.state).toBe('active');
    });

    it('tells the user the MFA counted after the return', async () => {
      store.update({ authenticator: { state: 'active', registeredAt: '2026-10-27T09:00:00Z' } });
      configureTestApp();
      await openRoute('/connections?mfa=ok');
      await until(() => expect(text()).toContain('Identity confirmed.'));
    });

    it('shows one error for the whole page when the registration cannot be read', async () => {
      server.use(
        http.get('/api/v1/authenticator', () =>
          HttpResponse.json({ error: 'upstream_unavailable' }, { status: 503 }),
        ),
      );
      configureTestApp();
      await openRoute('/connections');
      await until(() => expect(text()).toContain('The service is temporarily unavailable.'));
      expect(document.querySelector('table')).toBeNull();
    });
  });
});
