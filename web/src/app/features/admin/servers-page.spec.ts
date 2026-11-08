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

  async function openAdd(): Promise<void> {
    button('Add server').click();
    await until(() => expect(document.getElementById('srv-url')).toBeTruthy());
  }

  async function fillNewApp(): Promise<void> {
    fill('srv-url', 'https://mcp-newapp.corp.local:8443/mcp');
  }

  it('lists the servers of the registry with their address, credential, state and connection', async () => {
    await open();

    expect(text(row('mcp-jira'))).toContain('Jira');
    expect(text(row('mcp-jira'))).toContain('https://mcp-jira.internal:8443/mcp');
    expect(text(row('mcp-jira'))).toContain('Enabled');
    expect(text(row('mcp-opensearch'))).toContain('Disabled');
    expect(text(row('mcp-servicedesk'))).toContain('Service account');
  });

  it('shows the status of each server and the badges for plain HTTP, a pinned and a changed certificate', async () => {
    await open();

    expect(text(row('mcp-confluence'))).toContain('Connected');
    expect(text(row('mcp-confluence'))).not.toContain('Plain HTTP');
    expect(text(row('mcp-confluence'))).not.toContain('Pinned certificate');
    expect(text(row('mcp-jira'))).toContain('Pinned certificate');
    expect(text(row('mcp-servicedesk'))).toContain('Unreachable');
    expect(text(row('mcp-notes'))).toContain('Pending approval');

    const plain = row('mcp-gitlab').querySelector('.tag-danger');
    expect(plain?.textContent).toContain('Plain HTTP');
    const changed = row('mcp-opensearch');
    expect(text(changed)).toContain('Certificate changed');
    expect(changed.querySelectorAll('.tag-danger').length).toBe(1);
    expect(changed.querySelector('.tag-danger')?.textContent).toContain('Certificate changed');
  });

  it('names a system the way the administrator named it in the broker, as inert text', async () => {
    await open();

    await until(() => expect(text(row('mcp-servicedesk'))).toContain('Service Desk'));
    expect(text(row('mcp-opensearch'))).toContain('OpenSearch');
    expect(text(row('mcp-gitlab'))).toContain('GitLab');
  });

  it('asks for an address, an optional system and the plain HTTP option, and warns next to the option', async () => {
    await open();
    await openAdd();

    const system = field('srv-system') as HTMLInputElement;
    expect(system.value).toBe('');
    expect(text(document.getElementById(system.getAttribute('aria-describedby')!)!)).toContain(
      'If you fill it in, the gateway refuses a server that claims another system.',
    );
    expect(document.querySelector('input[name="adapter"]')).toBeNull();
    expect(document.querySelector('input[name="acceptedTypes"]')).toBeNull();
    const checkbox = field('srv-plain') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    const hint = document.getElementById(checkbox.getAttribute('aria-describedby')!)!;
    expect(text(hint)).toContain("Plain HTTP sends users' credentials unencrypted.");
    expect(text(hint)).toContain('same Docker network as the gateway');
  });

  it('adds a server by its address and shows it waiting for approval', async () => {
    store.update({ mfaFresh: true });
    await open();
    await openAdd();

    await fillNewApp();
    button('Save').click();

    await until(() => expect(text()).toContain('Added the server mcp-newapp.'));
    expect(writes).toEqual([
      {
        method: 'POST',
        url: '/api/v1/admin/servers',
        headers: {},
        body: { internalUrl: 'https://mcp-newapp.corp.local:8443/mcp', allowPlainHttp: false },
      },
    ]);
    await until(() => expect(text(row('mcp-newapp'))).toContain('Pending approval'));
  });

  it('sends the expected system only when it is filled in', async () => {
    store.update({ mfaFresh: true });
    await open();
    await openAdd();

    fill('srv-url', 'https://mcp-newapp.corp.local:8443/mcp');
    fill('srv-system', ' newapp ');
    button('Save').click();

    await until(() => expect(text()).toContain('Added the server mcp-newapp.'));
    expect(writes[0].body).toEqual({
      internalUrl: 'https://mcp-newapp.corp.local:8443/mcp',
      allowPlainHttp: false,
      expectedSystem: 'newapp',
    });
  });

  it('checks the expected system before it sends anything', async () => {
    await open();
    await openAdd();

    fill('srv-url', 'https://mcp-newapp.corp.local:8443/mcp');
    fill('srv-system', 'Not A System');
    button('Save').click();

    await until(() => expect(text()).toContain('Enter a system identifier'));
    expect(writes).toEqual([]);
  });

  it('says that the server claims another system than the one entered and keeps the form', async () => {
    store.update({ mfaFresh: true });
    await open();
    await openAdd();

    fill('srv-url', 'https://mcp-newapp.corp.local:8443/mcp');
    fill('srv-system', 'jira');
    button('Save').click();

    await until(() => expect(text()).toContain('claims another system than the one you entered'));
    expect(field('srv-system').value).toBe('jira');
    expect(field('srv-url').value).toBe('https://mcp-newapp.corp.local:8443/mcp');
  });

  it('sends the plain HTTP option when it is ticked', async () => {
    store.update({ mfaFresh: true });
    await open();
    await openAdd();

    fill('srv-url', 'http://mcp-inner:8080/mcp');
    toggle('allowPlainHttp');
    button('Save').click();

    await until(() => expect(text()).toContain('Added the server mcp-inner.'));
    expect(writes[0].body).toEqual({
      internalUrl: 'http://mcp-inner:8080/mcp',
      allowPlainHttp: true,
    });
    await until(() => expect(row('mcp-inner').querySelector('.tag-danger')).toBeTruthy());
  });

  it('checks the form before it sends anything', async () => {
    await open();
    await openAdd();

    fill('srv-url', 'ftp://plain.internal/mcp');
    button('Save').click();
    await until(() =>
      expect(text()).toContain('Enter an address that starts with https:// or http://'),
    );

    fill('srv-url', 'http://plain.internal/mcp');
    await until(() =>
      expect(text()).toContain('An http address needs the "Allow plain HTTP" option.'),
    );
    expect(writes).toEqual([]);
  });

  it('shows the 409 of an existing server and keeps the form', async () => {
    store.update({ mfaFresh: true });
    await open();
    await openAdd();

    fill('srv-url', 'https://mcp-jira.internal:8443/mcp');
    button('Save').click();

    await until(() => expect(text()).toContain('A server with this identifier already exists.'));
    expect(field('srv-url').value).toBe('https://mcp-jira.internal:8443/mcp');
  });

  it.each([
    [
      'https://127.0.0.1:8443/mcp',
      'address_refused',
      'The gateway does not connect to this address',
    ],
    [
      'https://mcp-notls.corp.local/mcp',
      'tls_handshake_failed',
      'could not complete a TLS handshake',
    ],
    [
      'https://mcp-nomanifest.corp.local/mcp',
      'manifest_unreachable',
      'could not read its manifest',
    ],
    [
      'https://mcp-badmanifest.corp.local/mcp',
      'manifest_invalid',
      'meant for a different environment',
    ],
    ['https://mcp-wiki.corp.local/mcp', 'namespace_conflict', 'already owns the policy namespace'],
    ['https://mcp-admin.corp.local/mcp', 'system_reserved', 'reserved for a component'],
  ])('shows the refusal of %s as a readable message (%s)', async (address, _reason, message) => {
    store.update({ mfaFresh: true });
    await open();
    await openAdd();

    fill('srv-url', address);
    button('Save').click();

    await until(() => expect(text()).toContain(message));
    expect(document.querySelector('.detail')).toBeTruthy();
    expect(field('srv-url').value).toBe(address);
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
    await openAdd();
    await fillNewApp();
    button('Save').click();

    await until(() => expect(text()).toContain('A service account cannot be combined'));
    expect(text()).toContain('service-account next to user types');
  });

  describe('fresh MFA', () => {
    it('keeps the form, goes to the IdP and gives the form back after the return', async () => {
      const { navigation, harness } = await open();
      button('Add server').click();
      await until(() => expect(document.getElementById('srv-url')).toBeTruthy());
      await fillNewApp();
      button('Save').click();

      await until(() =>
        expect(navigation.assign).toHaveBeenCalledWith(
          '/api/v1/auth/login?stepUp=true&returnPath=%2Fadmin%2Fservers%3Fmfa%3Dok',
        ),
      );
      const kept = JSON.parse(sessionStorage.getItem('mcp-portal-resume')!).intent;
      expect(kept.kind).toBe('admin-draft');
      expect(kept.page).toBe('/admin/servers');
      expect(JSON.parse(kept.draft).internalUrl).toBe('https://mcp-newapp.corp.local:8443/mcp');
      expect(writes.length).toBe(1);

      store.update({ mfaFresh: true });
      await harness.navigateByUrl('/catalog');
      await harness.navigateByUrl('/admin/servers?mfa=ok');
      await until(() =>
        expect(text()).toContain('Identity confirmed. Check the form and save again.'),
      );
      expect(field('srv-url').value).toBe('https://mcp-newapp.corp.local:8443/mcp');

      button('Save').click();
      await until(() => expect(text()).toContain('Added the server mcp-newapp.'));
    });

    it('shows an error instead of going round again when the return was no MFA', async () => {
      const { navigation, harness } = await open();
      button('Add server').click();
      await until(() => expect(document.getElementById('srv-url')).toBeTruthy());
      await fillNewApp();
      button('Save').click();
      await until(() => expect(navigation.assign).toHaveBeenCalledTimes(1));

      await harness.navigateByUrl('/catalog');
      await harness.navigateByUrl('/admin/servers?mfa=ok');
      await until(() =>
        expect(field('srv-url').value).toBe('https://mcp-newapp.corp.local:8443/mcp'),
      );
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
      await until(() => expect(document.getElementById('srv-type')).toBeTruthy());
      return opened;
    }

    it('shows the address as fixed text, with no field to change it', async () => {
      await edit('mcp-jira');

      expect(document.getElementById('srv-url')).toBeNull();
      expect(text(document.querySelector('.editor')!)).toContain(
        'https://mcp-jira.internal:8443/mcp',
      );
      expect(text(document.querySelector('.editor')!)).toContain('The address cannot be changed.');
    });

    it('sends only what changed, with the ETag that was read, and nothing about the address', async () => {
      store.update({ mfaFresh: true });
      await edit('mcp-jira');

      toggle('required');
      button('Save').click();

      await until(() => expect(text()).toContain('Saved the settings of mcp-jira.'));
      expect(writes).toEqual([
        {
          method: 'PATCH',
          url: '/api/v1/admin/servers/mcp-jira',
          headers: { 'if-match': '"v1"' },
          body: {
            credential: {
              required: false,
              acceptedTypes: ['user-oauth', 'user-secret'],
              type: 'user-oauth',
            },
          },
        },
      ]);
    });

    it('offers neither the adapter flag nor the address when a server is changed or added', async () => {
      await edit('mcp-jira');
      expect(document.querySelector('input[name="adapter"]')).toBeNull();
      button('Cancel').click();
      await openAdd();
      expect(document.querySelector('input[name="adapter"]')).toBeNull();
    });

    it('says so when someone changed the server in the meantime (412)', async () => {
      await edit('mcp-jira');
      server.use(
        http.patch('/api/v1/admin/servers/mcp-jira', () =>
          HttpResponse.json({ error: 'precondition_failed' }, { status: 412 }),
        ),
      );
      toggle('required');
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

  describe('details', () => {
    async function details(serverId: string) {
      await open();
      button(`Details (${serverId})`).click();
      await until(() => expect(document.getElementById('server-details-title')).toBeTruthy());
    }

    it('warns about plain HTTP at the top and shows the connection the administrator approved', async () => {
      await details('mcp-gitlab');

      const panel = document.querySelector('.editor')!;
      expect(text(panel.firstElementChild!)).toContain('mcp-gitlab');
      expect(panel.querySelector('app-notice')?.textContent).toContain(
        "Plain HTTP sends users' credentials unencrypted.",
      );
      expect(text(panel)).toContain('http://mcp-gitlab:8080/mcp');
      expect(text(panel)).toContain('None: the connection is not encrypted.');
      expect(text(panel)).toContain('Last check');
    });

    it('shows the fingerprint, subject, issuer and names of a certificate, and the last error', async () => {
      await details('mcp-servicedesk');

      const panel = document.querySelector('.editor')!;
      expect(panel.querySelector('app-notice')).toBeNull();
      expect(text(panel)).toContain('Trusted CA (chain and host name)');
      expect(panel.querySelector('.fingerprint code')?.textContent).toMatch(
        /^sha256:[0-9a-f]{64}$/,
      );
      expect(text(panel)).toContain('CN=mcp-servicedesk.internal');
      expect(text(panel)).toContain('CN=Corp Issuing CA 2');
      expect(text(panel)).toContain('Valid until');
      expect(text(panel)).toContain('TLS handshake failed.');
    });

    it('points a server with a pending connection to the Approvals screen', async () => {
      await details('mcp-opensearch');

      const panel = document.querySelector('.editor')!;
      expect(text(panel)).toContain('A connection waits for your approval.');
      expect(panel.querySelector('a')?.getAttribute('href')).toBe('/admin');
    });

    it('refreshes without a second factor, shows the new check time and the wait after a second click', async () => {
      await details('mcp-jira');
      const before = text(document.querySelector('.editor')!);

      button('Refresh').click();
      await until(() =>
        expect(writes.map((write) => write.url)).toEqual([
          '/api/v1/admin/servers/mcp-jira/refresh',
        ]),
      );
      await until(() => expect(text(document.querySelector('.editor')!)).not.toBe(before));
      expect(text(document.querySelector('app-error-notice') ?? document.body)).not.toContain(
        'requires re-authentication',
      );

      button('Refresh').click();
      await until(() =>
        expect(text()).toContain(
          'The server was checked a moment ago. Wait a few seconds and try again.',
        ),
      );
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
