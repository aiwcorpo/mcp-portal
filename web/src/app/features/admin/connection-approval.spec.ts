import { TestBed } from '@angular/core/testing';
import { HttpResponse, http } from 'msw';
import { ServerConfig } from '../../api/generated';
import { SessionService } from '../../core/session.service';
import { mockFingerprint } from '../../../mocks/dynamic-mock';
import { useMockApi } from '../../../testing/mock-api';
import { Recorded, recordWrites } from '../../../testing/forms';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';

const HOST = 'mcp-wiki.corp.local';

function pendingServer(
  overrides: Partial<ServerConfig['pendingConnection'] & object> = {},
): ServerConfig {
  return {
    serverId: 'mcp-wiki',
    system: 'wiki',
    internalUrl: `https://${HOST}:8443/mcp`,
    allowPlainHttp: false,
    credential: { required: true, acceptedTypes: ['user-oauth'], type: 'user-oauth' },
    enabled: true,
    adapter: false,
    status: 'pending_approval',
    lastCheckedAt: '2026-11-08T09:30:00Z',
    lastError: null,
    connection: null,
    pendingConnection: {
      tlsMode: 'ca',
      fingerprint: mockFingerprint(HOST),
      subject: `CN=${HOST}`,
      issuer: 'CN=Corp Issuing CA 2',
      sans: [HOST, 'wiki'],
      notAfter: '2027-03-01T12:00:00Z',
      validatesAsCa: true,
      reason: 'first_connection',
      detectedAt: '2026-11-08T09:30:00Z',
      ...overrides,
    },
  };
}

function plainServer(): ServerConfig {
  return {
    ...pendingServer(),
    internalUrl: 'http://mcp-wiki:8080/mcp',
    allowPlainHttp: true,
    pendingConnection: {
      tlsMode: 'plain',
      fingerprint: null,
      subject: null,
      issuer: null,
      sans: [],
      notAfter: null,
      validatesAsCa: false,
      reason: 'first_connection',
      detectedAt: '2026-11-08T09:30:00Z',
    },
  };
}

describe('AdminPage: approval of a connection', () => {
  const { server, store } = useMockApi();
  const writes: Recorded[] = [];

  beforeAll(() => recordWrites(server, (url) => url.includes('/connection/approve'), writes));
  beforeEach(() => {
    writes.length = 0;
    sessionStorage.clear();
    store.update({ admin: true });
  });

  function servers(...list: ServerConfig[]): void {
    server.use(http.get('/api/v1/admin/servers', () => HttpResponse.json(list)));
  }

  async function openAdmin(url = '/admin') {
    const navigation = configureTestApp();
    await TestBed.inject(SessionService).load();
    const harness = await openRoute(url);
    await until(() => expect(text()).toContain('MCP server registry'));
    return { navigation, harness };
  }

  function card(): HTMLElement {
    return document.querySelector<HTMLElement>('app-connection-approval')!;
  }

  it('shows the address, the proposed mode, the fingerprint, the names, the validity and whether it validates as a CA', async () => {
    servers(pendingServer());
    await openAdmin();

    await until(() => expect(card()).toBeTruthy());
    const shown = text(card());
    expect(shown).toContain('Connection of Wiki');
    expect(shown).toContain(`https://${HOST}:8443/mcp`);
    expect(shown).toContain('Trusted CA (chain and host name)');
    expect(card().querySelector('.fingerprint code')?.textContent).toBe(mockFingerprint(HOST));
    expect(shown).toContain(`CN=${HOST}`);
    expect(shown).toContain('CN=Corp Issuing CA 2');
    expect(shown).toContain('wiki');
    expect(card().querySelector('.system code')?.textContent).toBe('wiki');
    expect(card().querySelector('.system')?.textContent).toContain('System claimed by the server');
    expect(shown).toContain('Approve only if this is the system you meant to add');
    expect(shown).toContain('01.03.2027');
    expect(shown).toContain('Yes, for the host of the address');
    expect(shown).toContain('First connection to this server.');
    expect(card().querySelector('app-notice')).toBeNull();
    expect(text()).toContain('Connections waiting for approval: 1');
  });

  it('shows the fingerprint in monospace and lets it be copied', async () => {
    servers(pendingServer());
    await openAdmin();
    await until(() => expect(card()).toBeTruthy());
    const copied: string[] = [];
    const original = document.execCommand;
    document.execCommand = ((command: string) => {
      copied.push(command);
      return true;
    }) as typeof document.execCommand;

    button('Copy', card()).click();

    await until(() => expect(text(card())).toContain('Copied.'));
    document.execCommand = original;
    expect(copied).toEqual(['copy']);
    const code = card().querySelector<HTMLElement>('.fingerprint code')!;
    expect(getComputedStyle(code).fontFamily).toBe(
      getComputedStyle(document.querySelector('code')!).fontFamily,
    );
  });

  it('puts the warning for plain HTTP first and shows no certificate', async () => {
    servers(plainServer());
    await openAdmin();

    await until(() => expect(card()).toBeTruthy());
    const first = card().querySelector('.card')!.children[1];
    expect(first.tagName).toBe('APP-NOTICE');
    expect(text(first)).toContain("Plain HTTP sends users' credentials unencrypted.");
    expect(text(card())).toContain('None: the connection is not encrypted.');
    expect(card().querySelector('.fingerprint')).toBeNull();
    expect(text(card())).not.toContain('Validates as a trusted CA certificate');
  });

  it('approves the proposed mode with the fingerprint that was shown', async () => {
    servers(pendingServer());
    store.update({ mfaFresh: true });
    await openAdmin();
    await until(() => expect(card()).toBeTruthy());

    button('Approve connection (Wiki)').click();

    await until(() => expect(writes.length).toBe(1));
    expect(writes[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/admin/servers/mcp-wiki/connection/approve',
      body: { tlsMode: 'ca', fingerprint: mockFingerprint(HOST) },
    });
  });

  it('offers to pin a certificate that would validate as a CA, and sends the choice', async () => {
    servers(pendingServer());
    store.update({ mfaFresh: true });
    await openAdmin();
    await until(() => expect(card()).toBeTruthy());

    const pinned = Array.from(
      card().querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).find((input) => input.value === 'pinned')!;
    pinned.click();
    button('Approve connection (Wiki)').click();

    await until(() => expect(writes.length).toBe(1));
    expect(writes[0].body).toEqual({ tlsMode: 'pinned', fingerprint: mockFingerprint(HOST) });
  });

  it('offers no choice for a certificate that can only be pinned or for plain HTTP', async () => {
    servers(pendingServer({ tlsMode: 'pinned', validatesAsCa: false }), {
      ...plainServer(),
      serverId: 'mcp-notes',
      system: 'notes',
    });
    await openAdmin();
    await until(() => expect(document.querySelectorAll('app-connection-approval').length).toBe(2));

    expect(document.querySelectorAll('input[type="radio"]').length).toBe(0);
    expect(text(card())).toContain('No: it can only be pinned');
  });

  it('goes through a fresh MFA and approves the same connection after the return', async () => {
    const { navigation, harness } = await openAdmin();
    await until(() => expect(text()).toContain('Connection of Notes'));
    button('Approve connection (Notes)').click();

    await until(() =>
      expect(navigation.assign).toHaveBeenCalledWith(
        '/api/v1/auth/login?stepUp=true&returnPath=%2Fadmin%3Fmfa%3Dok',
      ),
    );
    const kept = JSON.parse(sessionStorage.getItem('mcp-portal-resume')!).intent;
    expect(JSON.parse(kept.draft)).toEqual({
      op: 'approve-connection',
      serverId: 'mcp-notes',
      tlsMode: 'pinned',
      fingerprint: mockFingerprint('mcp-notes'),
    });

    store.update({ mfaFresh: true });
    await harness.navigateByUrl('/catalog');
    await harness.navigateByUrl('/admin?mfa=ok');

    await until(() => expect(text()).toContain('Approved the connection of Notes.'));
    expect(writes.length).toBe(2);
    expect(writes[1].body).toEqual({
      tlsMode: 'pinned',
      fingerprint: mockFingerprint('mcp-notes'),
    });
  });

  it('does not approve after the return when the certificate is another one now', async () => {
    const { navigation, harness } = await openAdmin();
    await until(() => expect(text()).toContain('Connection of Notes'));
    button('Approve connection (Notes)').click();
    await until(() => expect(navigation.assign).toHaveBeenCalledTimes(1));

    servers({
      ...pendingServer({
        tlsMode: 'pinned',
        validatesAsCa: false,
        fingerprint: mockFingerprint('renewed'),
      }),
      serverId: 'mcp-notes',
      system: 'notes',
    });
    store.update({ mfaFresh: true });
    await harness.navigateByUrl('/catalog');
    await harness.navigateByUrl('/admin?mfa=ok');

    await until(() =>
      expect(text()).toContain('The connection changed while you confirmed your identity.'),
    );
    expect(writes.length).toBe(1);
  });

  it('ignores a kept connection approval whose mode or fingerprint has a wrong shape', async () => {
    servers(pendingServer());
    for (const draft of [
      {
        op: 'approve-connection',
        serverId: 'mcp-wiki',
        tlsMode: 'any',
        fingerprint: mockFingerprint(HOST),
      },
      { op: 'approve-connection', serverId: 'mcp-wiki', tlsMode: 'ca', fingerprint: 'sha256:abc' },
      {
        op: 'approve-connection',
        serverId: 'mcp wiki',
        tlsMode: 'ca',
        fingerprint: mockFingerprint(HOST),
      },
    ]) {
      sessionStorage.clear();
      store.update({ mfaFresh: true });
      configureTestApp();
      await TestBed.inject(SessionService).load();
      sessionStorage.setItem(
        'mcp-portal-resume',
        JSON.stringify({
          user: TestBed.inject(SessionService).username(),
          intent: { kind: 'admin-draft', page: '/admin', draft: JSON.stringify(draft) },
          expiresAt: Date.now() + 60_000,
        }),
      );
      await openRoute('/admin?mfa=ok');
      await until(() => expect(text()).toContain('MCP server registry'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(writes).toEqual([]);
      TestBed.resetTestingModule();
    }
  });

  it.each([
    [
      'connection_changed',
      'The certificate presented by the server changed since you opened the card.',
    ],
    ['no_pending_connection', 'No connection of this server is waiting for approval.'],
  ])('shows the 409 %s and reads the servers again', async (code, message) => {
    servers(pendingServer());
    server.use(
      http.post('/api/v1/admin/servers/mcp-wiki/connection/approve', () =>
        HttpResponse.json({ error: code }, { status: 409 }),
      ),
    );
    await openAdmin();
    await until(() => expect(card()).toBeTruthy());
    let reads = 0;
    server.use(
      http.get('/api/v1/admin/servers', () => {
        reads += 1;
        return HttpResponse.json([pendingServer({ fingerprint: mockFingerprint('renewed') })]);
      }),
    );

    button('Approve connection (Wiki)').click();

    await until(() => expect(text()).toContain(message));
    await until(() => expect(reads).toBeGreaterThan(0));
    await until(() =>
      expect(card().querySelector('.fingerprint code')?.textContent).toBe(
        mockFingerprint('renewed'),
      ),
    );
  });

  it('shows the refusal of a mode the certificate does not allow', async () => {
    servers(pendingServer());
    server.use(
      http.post('/api/v1/admin/servers/mcp-wiki/connection/approve', () =>
        HttpResponse.json(
          { error: 'server_rejected', reason: 'tls_mode_not_allowed', message: 'no' },
          { status: 422 },
        ),
      ),
    );
    store.update({ mfaFresh: true });
    await openAdmin();
    await until(() => expect(card()).toBeTruthy());
    button('Approve connection (Wiki)').click();

    await until(() => expect(text()).toContain('The certificate does not allow this trust mode.'));
  });

  it('approves the connection of the mock server and shows it as connected', async () => {
    store.update({ mfaFresh: true });
    await openAdmin();
    await until(() => expect(text()).toContain('Connection of Notes'));

    button('Approve connection (Notes)').click();

    await until(() => expect(text()).toContain('Approved the connection of Notes.'));
    await until(() => expect(text()).not.toContain('Connection of Notes'));
    expect(text()).toContain('Connection of OpenSearch');
  });
});
