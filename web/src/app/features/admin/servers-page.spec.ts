import { TestBed } from '@angular/core/testing';
import { HttpResponse, http } from 'msw';
import { SessionService } from '../../core/session.service';
import { useMockApi } from '../../../testing/mock-api';
import { Recorded, dialog, field, fill, recordWrites, toggle } from '../../../testing/forms';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';

describe('ServersPage', () => {
  const { server, store } = useMockApi();
  const writes: Recorded[] = [];

  beforeAll(() => recordWrites(server, (url) => url.startsWith('/api/v1/admin/servers'), writes));
  beforeEach(() => {
    writes.length = 0;
    store.update({ admin: true });
  });

  async function open(url = '/admin/servers') {
    const navigation = configureTestApp();
    await TestBed.inject(SessionService).load();
    const harness = await openRoute(url);
    await until(() => expect(text()).toContain('Servers of the gateway'));
    return { navigation, harness };
  }

  function row(serverId: string): HTMLElement {
    const found = Array.from(document.querySelectorAll('tbody tr')).find((candidate) =>
      text(candidate).includes(serverId),
    );
    if (!found) {
      throw new Error(`no row ${serverId}`);
    }
    return found as HTMLElement;
  }

  async function fillNotes(): Promise<void> {
    fill('srv-system', 'notes');
    fill('srv-url', 'https://mcp-notes.internal:8443/mcp');
  }

  it('lists the servers of the registry with their address, credential and state', async () => {
    await open();

    expect(text(row('mcp-jira'))).toContain('Jira');
    expect(text(row('mcp-jira'))).toContain('https://mcp-jira.internal:8443/mcp');
    expect(text(row('mcp-jira'))).toContain('Enabled');
    expect(text(row('mcp-opensearch'))).toContain('Disabled');
    expect(text(row('mcp-servicedesk'))).toContain('Service account');
  });

  it('names a system the way the administrator named it in the broker, as inert text', async () => {
    await open();

    await until(() => expect(text(row('mcp-servicedesk'))).toContain('Service Desk'));
    expect(text(row('mcp-opensearch'))).toContain('OpenSearch');
    expect(text(row('mcp-gitlab'))).toContain('GitLab');
  });

  it('shows the certificate name as derived text and offers no field for it', async () => {
    await open();
    button('Add server').click();
    await until(() => expect(document.getElementById('srv-url')).toBeTruthy());

    fill('srv-system', 'notes');
    await until(() => expect(text()).toContain('mcp-notes.internal'));
    expect(document.getElementById('srv-tls')).toBeNull();
  });

  it('adds a server for any valid system, with the identifier derived and no certificate name', async () => {
    store.update({ mfaFresh: true });
    await open();
    button('Add server').click();
    await until(() => expect(document.getElementById('srv-system')).toBeTruthy());

    await fillNotes();
    await until(() => expect(text()).toContain('mcp-notes'));
    button('Save').click();

    await until(() => expect(text()).toContain('Added the server mcp-notes.'));
    expect(writes).toEqual([
      {
        method: 'POST',
        url: '/api/v1/admin/servers',
        headers: {},
        body: {
          serverId: 'mcp-notes',
          system: 'notes',
          internalUrl: 'https://mcp-notes.internal:8443/mcp',
          credential: { required: true, acceptedTypes: ['user-oauth'], type: 'user-oauth' },
          enabled: true,
          adapter: false,
        },
      },
    ]);
    await until(() => expect(text(row('mcp-notes'))).toContain('Notes'));
  });

  it('checks the form before it sends anything', async () => {
    await open();
    button('Add server').click();
    await until(() => expect(document.getElementById('srv-system')).toBeTruthy());

    fill('srv-system', 'gateway');
    fill('srv-url', 'http://plain.internal/mcp');
    button('Save').click();

    await until(() => expect(text()).toContain('are reserved'));
    expect(text()).toContain('Enter an https address');
    expect(writes).toEqual([]);
  });

  it('shows the 409 of an existing server and keeps the form', async () => {
    store.update({ mfaFresh: true });
    await open();
    button('Add server').click();
    await until(() => expect(document.getElementById('srv-system')).toBeTruthy());

    fill('srv-system', 'jira');
    fill('srv-url', 'https://mcp-jira.internal:8443/mcp');
    button('Save').click();

    await until(() => expect(text()).toContain('A server with this identifier already exists.'));
    expect(field('srv-system').value).toBe('jira');
  });

  it('shows what the gateway rejects, in its own words', async () => {
    server.use(
      http.post('/api/v1/admin/servers', () =>
        HttpResponse.json(
          {
            error: 'server_rejected',
            reason: 'credential_types_mixed',
            message: 'service-account next to user types',
          },
          { status: 422 },
        ),
      ),
    );
    await open();
    button('Add server').click();
    await until(() => expect(document.getElementById('srv-system')).toBeTruthy());
    await fillNotes();
    button('Save').click();

    await until(() => expect(text()).toContain('A service account cannot be combined'));
    expect(text()).toContain('service-account next to user types');
  });

  describe('fresh MFA', () => {
    it('keeps the form, goes to the IdP and gives the form back after the return (no certificate name, no secret)', async () => {
      const { navigation, harness } = await open();
      button('Add server').click();
      await until(() => expect(document.getElementById('srv-system')).toBeTruthy());
      await fillNotes();
      button('Save').click();

      await until(() =>
        expect(navigation.assign).toHaveBeenCalledWith(
          '/api/v1/auth/login?stepUp=true&returnPath=%2Fadmin%2Fservers%3Fmfa%3Dok',
        ),
      );
      const kept = JSON.parse(sessionStorage.getItem('mcp-portal-resume')!).intent;
      expect(kept.kind).toBe('admin-draft');
      expect(kept.page).toBe('/admin/servers');
      expect(JSON.parse(kept.draft).system).toBe('notes');
      expect(writes.length).toBe(1);

      store.update({ mfaFresh: true });
      await harness.navigateByUrl('/catalog');
      await harness.navigateByUrl('/admin/servers?mfa=ok');
      await until(() =>
        expect(text()).toContain('Identity confirmed. Check the form and save again.'),
      );
      expect(field('srv-system').value).toBe('notes');

      button('Save').click();
      await until(() => expect(text()).toContain('Added the server mcp-notes.'));
    });

    it('shows an error instead of going round again when the return was no MFA', async () => {
      const { navigation, harness } = await open();
      button('Add server').click();
      await until(() => expect(document.getElementById('srv-system')).toBeTruthy());
      await fillNotes();
      button('Save').click();
      await until(() => expect(navigation.assign).toHaveBeenCalledTimes(1));

      await harness.navigateByUrl('/catalog');
      await harness.navigateByUrl('/admin/servers?mfa=ok');
      await until(() => expect(field('srv-system').value).toBe('notes'));
      button('Save').click();

      await until(() => expect(text()).toContain('requires re-authentication'));
      expect(navigation.assign).toHaveBeenCalledTimes(1);
    });

    it('disables a server without a step-up', async () => {
      const { navigation } = await open();

      button('Disable (mcp-jira)').click();

      await until(() => expect(text()).toContain('Disabled the server mcp-jira.'));
      expect(navigation.assign).not.toHaveBeenCalled();
      const patch = writes.find((write) => write.method === 'PATCH')!;
      expect(patch.body).toEqual({ enabled: false });
      expect(patch.headers['if-match']).toBe('"v1"');
      await until(() => expect(text(row('mcp-jira'))).toContain('Disabled'));
    });
  });

  describe('editing', () => {
    async function edit(serverId: string) {
      const opened = await open();
      button(`Edit (${serverId})`).click();
      await until(() => expect(document.getElementById('srv-url')).toBeTruthy());
      return opened;
    }

    it('sends only what changed, with the ETag that was read, and no adapter or certificate name', async () => {
      store.update({ mfaFresh: true });
      await edit('mcp-jira');

      fill('srv-url', 'https://mcp-jira.internal:9443/mcp');
      button('Save').click();

      await until(() => expect(text()).toContain('Saved the settings of mcp-jira.'));
      expect(writes).toEqual([
        {
          method: 'PATCH',
          url: '/api/v1/admin/servers/mcp-jira',
          headers: { 'if-match': '"v1"' },
          body: { internalUrl: 'https://mcp-jira.internal:9443/mcp' },
        },
      ]);
    });

    it('offers the adapter flag only when a server is added', async () => {
      await edit('mcp-jira');
      expect(document.querySelector('input[name="adapter"]')).toBeNull();
      button('Cancel').click();
      button('Add server').click();
      await until(() => expect(document.querySelector('input[name="adapter"]')).toBeTruthy());
    });

    it('says so when someone changed the server in the meantime (412)', async () => {
      await edit('mcp-jira');
      server.use(
        http.patch('/api/v1/admin/servers/mcp-jira', () =>
          HttpResponse.json({ error: 'precondition_failed' }, { status: 412 }),
        ),
      );
      fill('srv-url', 'https://mcp-jira.internal:9443/mcp');
      button('Save').click();

      await until(() => expect(text()).toContain('Someone changed this in the meantime'));
    });

    it('toggles a type and keeps the type in use among the accepted ones', async () => {
      await edit('mcp-jira');

      toggle('accepted-user-oauth');
      await until(() => expect(field('srv-type').querySelectorAll('option').length).toBe(1));
      expect(field('srv-type').value).toBe('user-secret');
    });
  });

  it('removes a server only after a confirmation and a fresh MFA', async () => {
    const { navigation, harness } = await open();

    button('Remove (mcp-gitlab)').click();
    await until(() => expect(text(dialog())).toContain('Remove the server mcp-gitlab?'));
    button('Remove server', dialog()).click();
    await until(() => expect(navigation.assign).toHaveBeenCalledTimes(1));
    expect(text()).not.toContain('Removed the server');

    store.update({ mfaFresh: true });
    await harness.navigateByUrl('/catalog');
    await harness.navigateByUrl('/admin/servers?mfa=ok');
    await until(() => expect(text()).toContain('Identity confirmed. Repeat the operation.'));
    button('Remove (mcp-gitlab)').click();
    await until(() => expect(text(dialog())).toContain('Remove the server mcp-gitlab?'));
    button('Remove server', dialog()).click();

    await until(() => expect(text()).toContain('Removed the server mcp-gitlab.'));
    await until(() =>
      expect(document.body.textContent).not.toContain('https://mcp-gitlab.internal'),
    );
    expect(writes.filter((write) => write.method === 'DELETE').length).toBe(2);
  });

  it('sends nothing when the removal is cancelled', async () => {
    await open();
    button('Remove (mcp-gitlab)').click();
    await until(() => expect(text(dialog())).toContain('Remove the server mcp-gitlab?'));
    button('Cancel', dialog()).click();
    await until(() => expect(document.querySelector('mat-dialog-container')).toBeNull());
    expect(writes).toEqual([]);
  });

  it('shows a list failure with a retry, and the message of the gateway being down', async () => {
    store.update({ scenario: 'errors' });
    configureTestApp();
    await TestBed.inject(SessionService).load();
    await openRoute('/admin/servers');

    await until(() => expect(text()).toContain('The service is temporarily unavailable.'));
    store.update({ scenario: 'default' });
    button('Refresh').click();
    await until(() => expect(text()).toContain('Servers of the gateway'));
  });
});
