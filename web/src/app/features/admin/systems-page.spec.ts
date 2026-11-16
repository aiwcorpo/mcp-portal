import { TestBed } from '@angular/core/testing';
import { HttpResponse, http } from 'msw';
import { SessionService } from '../../core/session.service';
import { useMockApi } from '../../../testing/mock-api';
import { Recorded, dialog, field, fill, recordWrites, toggle } from '../../../testing/forms';
import type { SystemAdminView } from '../../api/generated';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';

describe('SystemsPage', () => {
  const { server, store } = useMockApi();
  const writes: Recorded[] = [];

  beforeAll(() => recordWrites(server, (url) => url.startsWith('/api/v1/admin/systems'), writes));
  beforeEach(() => {
    writes.length = 0;
    store.update({ admin: true });
  });

  async function open(url = '/admin/systems') {
    const navigation = configureTestApp();
    await TestBed.inject(SessionService).load();
    const harness = await openRoute(url);
    await until(() => expect(text()).toContain('Systems of the credential broker'));
    return { navigation, harness };
  }

  async function edit(system: string) {
    const opened = await open();
    button(`Edit (${system})`).click();
    await until(() => expect(document.getElementById('sys-base')).toBeTruthy());
    return opened;
  }

  function row(system: string): HTMLElement {
    const found = Array.from(document.querySelectorAll('tbody tr')).find((candidate) =>
      text(candidate).includes(`(${system})`),
    );
    if (!found) {
      throw new Error(`no row ${system}`);
    }
    return found as HTMLElement;
  }

  it('lists the systems of the broker without any secret and says whether a client secret is stored', async () => {
    await open();

    expect(text(row('jira'))).toContain('https://jira.internal');
    expect(text(row('jira'))).toContain('atlassian-dc');
    expect(text(row('jira'))).toContain('Client secret stored');
    expect(text(row('servicedesk'))).not.toContain('Client secret');
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('shows the display name of a system and sends the one that is typed, never one with hidden characters', async () => {
    store.update({ mfaFresh: true });
    await edit('gitlab');
    expect(text(row('gitlab'))).toContain('GitLab');
    expect(field('sys-display').value).toBe('GitLab');

    fill('sys-display', 'Code\u202Ehosting');
    button('Save').click();
    await until(() => expect(text()).toContain('control and invisible characters are not allowed'));
    expect(writes).toEqual([]);

    fill('sys-display', 'GitLab of the company');
    fill('sys-scopes', 'gitlab.read');
    button('Save').click();
    await until(() => expect(text()).toContain('Saved the system gitlab.'));
    expect(writes[0].body).toMatchObject({ displayName: 'GitLab of the company' });
    await until(() => expect(text(row('gitlab'))).toContain('GitLab of the company'));
  });

  it('shows the identifier when no display name was given and leaves the field empty', async () => {
    store.update({ mfaFresh: true });
    await open();
    button('Add system').click();
    await until(() => expect(document.getElementById('sys-id')).toBeTruthy());
    fill('sys-id', 'notes');
    fill('sys-base', 'https://notes.internal/api');
    button('Save').click();

    await until(() => expect(text()).toContain('Added the system notes.'));
    expect(JSON.stringify(writes[0].body)).not.toContain('displayName');
    await until(() => expect(text(row('notes'))).toContain('notes'));
  });

  it('does not ask for the client secret while only a harmless setting changes, and leaves it out of the body', async () => {
    store.update({ mfaFresh: true });
    await edit('gitlab');
    expect(field('sys-client-secret').required).toBe(false);
    expect(text()).toContain('Leave this empty to keep it');

    fill('sys-scopes', 'gitlab.read');
    button('Save').click();

    await until(() => expect(text()).toContain('Saved the system gitlab.'));
    const put = writes.find((write) => write.method === 'PUT')!;
    expect(put.headers).toEqual({ 'if-match': '"v1"' });
    expect(put.body).toMatchObject({
      oauth: { clientId: 'mcp-broker-gitlab', scopes: ['gitlab.read'] },
    });
    expect(JSON.stringify(put.body)).not.toContain('clientSecret');
  });

  it('asks for the client secret again as soon as an address changes, and warns that the connections go', async () => {
    await edit('jira');

    fill('sys-base', 'https://jira2.internal');
    await until(() => expect(field('sys-client-secret').required).toBe(true));
    expect(text()).toContain('deletes the connections of all users');
    expect(text()).toContain('baseUrl');
    button('Save').click();
    await until(() => expect(text()).toContain('Enter the client secret again'));
    expect(writes).toEqual([]);

    fill('sys-client-secret', 'a-new-secret');
    store.update({ mfaFresh: true });
    button('Save').click();

    await until(() => expect(text()).toContain('The connections of its users were deleted'));
    const put = writes.find((write) => write.method === 'PUT')!;
    expect(put.body).toMatchObject({
      baseUrl: 'https://jira2.internal',
      oauth: { clientSecret: 'a-new-secret' },
    });
  });

  it('shows the reason when the broker wants the secret again although the page did not ask for it', async () => {
    server.use(
      http.put('/api/v1/admin/systems/gitlab', () =>
        HttpResponse.json(
          {
            error: 'system_rejected',
            reason: 'client_secret_required',
            message: 'enter the secret again',
          },
          { status: 422 },
        ),
      ),
    );
    await edit('gitlab');
    fill('sys-scopes', 'gitlab.read');
    button('Save').click();

    await until(() => expect(text()).toContain('The client secret has to be entered again'));
    expect(text()).toContain('enter the secret again');
  });

  it('adds a generic REST system with user secrets and no check, with If-None-Match', async () => {
    store.update({ mfaFresh: true });
    await open();
    button('Add system').click();
    await until(() => expect(document.getElementById('sys-id')).toBeTruthy());
    expect(document.getElementById('sys-client-secret')).toBeNull();
    fill('sys-id', 'notes');
    fill('sys-base', 'https://notes.internal/api');
    button('Save').click();

    await until(() => expect(text()).toContain('Added the system notes.'));
    const put = writes.find((write) => write.method === 'PUT')!;
    expect(put.url).toBe('/api/v1/admin/systems/notes');
    expect(put.headers).toEqual({ 'if-none-match': '*' });
    expect(put.body).toEqual({
      baseUrl: 'https://notes.internal/api',
      adapter: 'generic-rest',
      supportedTypes: ['user-secret'],
      defaultType: 'user-secret',
      secretScheme: 'Bearer',
    });
    await until(() => expect(text(row('notes'))).toContain('generic-rest'));
  });

  it('offers a generic REST system user secrets or a service account, never both and never OAuth', async () => {
    await open();
    button('Add system').click();
    await until(() => expect(document.getElementById('sys-id')).toBeTruthy());

    const radios = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="generic-type"]'),
    );
    expect(radios.length).toBe(2);
    expect(document.querySelector('input[name="type-user-oauth"]')).toBeNull();
    expect(text()).toContain('either the tokens of its users or one service account');

    radios[1].click();
    await until(() => expect(document.getElementById('sys-whoami-path')).toBeNull());
    radios[0].click();
    await until(() => expect(document.getElementById('sys-whoami-path')).toBeTruthy());
  });

  it('drops OAuth and mixing when the adapter becomes generic REST, and shows the types again for another adapter', async () => {
    await open();
    button('Add system').click();
    await until(() => expect(document.getElementById('sys-id')).toBeTruthy());
    fill('sys-adapter', 'gitlab');
    await until(() => expect(document.querySelector('input[name="type-user-oauth"]')).toBeTruthy());
    toggle('type-user-oauth');
    toggle('type-service-account');
    await until(() => expect(document.getElementById('sys-client-secret')).toBeTruthy());

    fill('sys-adapter', 'generic-rest');
    await until(() => expect(document.getElementById('sys-client-secret')).toBeNull());
    expect(document.querySelectorAll('input[name="generic-type"]').length).toBe(2);
    expect(
      Array.from(document.querySelectorAll<HTMLInputElement>('input[name="generic-type"]')).filter(
        (radio) => radio.checked,
      ).length,
    ).toBe(1);
  });

  it('sends the whoami that is typed, checks both fields first and says what happens without it', async () => {
    store.update({ mfaFresh: true });
    await open();
    button('Add system').click();
    await until(() => expect(document.getElementById('sys-id')).toBeTruthy());
    expect(text()).toContain('Without it the token is stored without a check');
    fill('sys-id', 'notes');
    fill('sys-base', 'https://notes.internal/api');

    fill('sys-whoami-path', '//evil.example/x');
    button('Save').click();
    await until(() => expect(text()).toContain('starts with a single slash'));
    expect(text()).toContain('Enter the field of the answer that holds the user name');
    expect(writes).toEqual([]);

    fill('sys-whoami-path', '/api/me');
    fill('sys-whoami-field', '/user/login');
    button('Save').click();

    await until(() => expect(text()).toContain('Added the system notes.'));
    expect(writes[0].body).toMatchObject({
      adapter: 'generic-rest',
      supportedTypes: ['user-secret'],
      whoami: { path: '/api/me', usernameField: '/user/login' },
    });
    await until(() => expect(button('Edit (notes)')).toBeTruthy());
    button('Edit (notes)').click();
    await until(() => expect(field('sys-whoami-path').value).toBe('/api/me'));
    expect(field('sys-whoami-field').value).toBe('/user/login');
  });

  it('refuses a path with .. or a query, and a field that is neither a name nor a pointer', async () => {
    await open();
    button('Add system').click();
    await until(() => expect(document.getElementById('sys-id')).toBeTruthy());
    fill('sys-id', 'notes');
    fill('sys-base', 'https://notes.internal/api');
    for (const [path, name] of [
      ['/a/../b', 'login'],
      ['/api/me?x=1', 'login'],
      ['api/me', 'login'],
      ['/api/me', 'a b'],
      ['/api/me', '/'],
    ]) {
      fill('sys-whoami-path', path);
      fill('sys-whoami-field', name);
      button('Save').click();
      await until(() => expect(document.querySelectorAll('.problem').length).toBeGreaterThan(0));
      expect(writes, `${path} ${name}`).toEqual([]);
    }
  });

  it('shows the reason when the broker refuses a type the adapter cannot take', async () => {
    server.use(
      http.put('/api/v1/admin/systems/notes', () =>
        HttpResponse.json(
          {
            error: 'system_rejected',
            reason: 'credential_type_not_supported_by_adapter',
            message: 'no',
          },
          { status: 422 },
        ),
      ),
    );
    await open();
    button('Add system').click();
    await until(() => expect(document.getElementById('sys-id')).toBeTruthy());
    fill('sys-id', 'notes');
    fill('sys-base', 'https://notes.internal/api');
    button('Save').click();

    await until(() =>
      expect(text()).toContain('A generic REST system takes user secrets or a service account'),
    );
  });

  it('needs the product for the Atlassian adapter and an audience for token exchange', async () => {
    await open();
    button('Add system').click();
    await until(() => expect(document.getElementById('sys-id')).toBeTruthy());
    fill('sys-id', 'wiki');
    fill('sys-base', 'https://wiki.internal');
    fill('sys-adapter', 'atlassian-dc');
    await until(() => expect(document.getElementById('sys-product')).toBeTruthy());
    toggle('type-token-exchange');
    await until(() => expect(document.getElementById('sys-audience')).toBeTruthy());
    button('Save').click();

    await until(() => expect(text()).toContain('Choose Jira or Confluence.'));
    expect(text()).toContain('needs the audience of the token');
    expect(writes).toEqual([]);
  });

  it('keeps the form but never the client secret on the way to the IdP', async () => {
    const { navigation, harness } = await edit('jira');
    fill('sys-base', 'https://jira2.internal');
    fill('sys-client-secret', 'a-new-secret');
    button('Save').click();

    await until(() =>
      expect(navigation.assign).toHaveBeenCalledWith(
        '/api/v1/auth/login?stepUp=true&returnPath=%2Fadmin%2Fsystems%3Fmfa%3Dok',
      ),
    );
    const kept = JSON.parse(sessionStorage.getItem('mcp-portal-resume')!);
    expect(JSON.stringify(kept)).not.toContain('a-new-secret');
    expect(JSON.parse(kept.intent.draft).baseUrl).toBe('https://jira2.internal');

    store.update({ mfaFresh: true });
    await harness.navigateByUrl('/catalog');
    await harness.navigateByUrl('/admin/systems?mfa=ok');
    await until(() => expect(text()).toContain('enter the client secret again'));
    expect(field('sys-base').value).toBe('https://jira2.internal');
    expect(field('sys-client-secret').value).toBe('');
  });

  it('removes a system with the ETag that was read, after a confirmation and a fresh MFA', async () => {
    store.update({ mfaFresh: true });
    await open();

    button('Remove (servicedesk)').click();
    await until(() => expect(text(dialog())).toContain('Remove the system servicedesk?'));
    expect(text(dialog())).toContain('connections of all users');
    button('Remove system', dialog()).click();

    await until(() => expect(text()).toContain('Removed the system servicedesk.'));
    const del = writes.find((write) => write.method === 'DELETE')!;
    expect(del.url).toBe('/api/v1/admin/systems/servicedesk');
    expect(del.headers).toEqual({ 'if-match': '"v1"' });
  });

  it('sends the user to the IdP when the removal needs a fresh MFA', async () => {
    const { navigation } = await open();
    button('Remove (servicedesk)').click();
    await until(() => expect(text(dialog())).toContain('Remove the system servicedesk?'));
    button('Remove system', dialog()).click();

    await until(() => expect(navigation.assign).toHaveBeenCalledTimes(1));
    expect(text()).not.toContain('Removed the system');
  });

  it('shows 412 as a change made by someone else', async () => {
    server.use(
      http.put('/api/v1/admin/systems/gitlab', () =>
        HttpResponse.json({ error: 'precondition_failed' }, { status: 412 }),
      ),
    );
    await edit('gitlab');
    fill('sys-scopes', 'gitlab.read');
    button('Save').click();
    await until(() => expect(text()).toContain('Someone changed this in the meantime'));
  });
});

describe('SystemsPage service account key', () => {
  const { server, store } = useMockApi();
  const writes: Recorded[] = [];
  const SECRET = 'test-only-service-token-0000000000';
  const PASSWORD = 'test-only-service-password';

  beforeAll(() => recordWrites(server, (url) => url.startsWith('/api/v1/admin/systems'), writes));
  beforeEach(() => {
    writes.length = 0;
    store.update({ admin: true });
  });

  const basicSystem = (key: SystemAdminView['serviceAccountKey']): SystemAdminView => ({
    system: 'billing',
    displayName: 'Billing',
    baseUrl: 'https://billing.internal',
    adapter: 'generic-rest',
    supportedTypes: ['service-account'],
    defaultType: 'service-account',
    secretScheme: 'Basic',
    serviceAccountKey: key,
  });

  async function open(url = '/admin/systems') {
    const navigation = configureTestApp();
    await TestBed.inject(SessionService).load();
    const harness = await openRoute(url);
    await until(() => expect(text()).toContain('Systems of the credential broker'));
    return { navigation, harness };
  }

  function row(system: string): HTMLElement {
    const found = Array.from(document.querySelectorAll('tbody tr')).find((candidate) =>
      text(candidate).includes(`(${system})`),
    );
    if (!found) {
      throw new Error(`no row ${system}`);
    }
    return found as HTMLElement;
  }

  function listOf(...systems: SystemAdminView[]) {
    server.use(http.get('/api/v1/admin/systems', () => HttpResponse.json(systems)));
  }

  /** The mock only knows its own systems; a system of the list above is answered the way the broker would. */
  function acceptKeysOf(system: string) {
    server.use(
      http.put(`/api/v1/admin/systems/${system}/service-account-key`, () =>
        HttpResponse.json({ system, set: true, kvVersion: 1 }),
      ),
      http.delete(
        `/api/v1/admin/systems/${system}/service-account-key`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
  }

  /** Lets the page render what was typed, as a real keystroke does, before the next step. */
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  function leaks(secret: string): boolean {
    const inputs = Array.from(document.querySelectorAll('input')).map((input) => input.value);
    return (
      text().includes(secret) || document.body.innerHTML.includes(secret) || inputs.includes(secret)
    );
  }

  it('shows the state of the key next to a service-account system and nowhere else', async () => {
    await open();

    expect(text(row('servicedesk'))).toContain('Service account key: not set');
    expect(text(row('servicedesk'))).toContain('Set key');
    expect(text(row('servicedesk'))).not.toContain('Delete key');
    expect(text(row('jira'))).not.toContain('Service account key');
    expect(text(row('jira'))).not.toContain('Set key');
  });

  it('shows set with its expiry, expired, and unknown, and offers the delete where there may be a key', async () => {
    listOf(
      {
        ...basicSystem({ state: 'set', expiresAt: '2027-03-01T08:30:00Z', expired: false }),
        system: 'aaa',
      },
      {
        ...basicSystem({ state: 'set', expiresAt: '2026-01-01T00:00:00Z', expired: true }),
        system: 'bbb',
      },
      { ...basicSystem({ state: 'set' }), system: 'ccc' },
      { ...basicSystem({ state: 'unknown' }), system: 'ddd' },
      { ...basicSystem(undefined), system: 'eee' },
    );
    await open();

    expect(text(row('aaa'))).toContain('set, expires 2027-03-01 08:30 UTC.');
    expect(text(row('aaa'))).toContain('Replace key');
    expect(text(row('aaa'))).toContain('Delete key');
    expect(text(row('bbb'))).toContain(
      'set, expired 2026-01-01 00:00 UTC. Calls to this system are refused',
    );
    expect(text(row('ccc'))).toContain('set, no planned expiry');
    expect(text(row('ddd'))).toContain('status unknown');
    expect(text(row('ddd'))).toContain('Delete key');
    expect(text(row('eee'))).toContain('status unknown');
  });

  it('sets a key as one hidden value, sends it once, and keeps it nowhere afterwards', async () => {
    store.update({ mfaFresh: true });
    await open();
    button('Set key (servicedesk)').click();
    await until(() => expect(document.getElementById('key-value')).toBeTruthy());

    expect(field('key-value').getAttribute('type')).toBe('password');
    expect(field('key-value').getAttribute('autocomplete')).toBe('off');
    expect(field('key-expires').getAttribute('type')).toBe('datetime-local');
    expect(document.querySelector('input[name="key-mode"]')).toBeNull();
    fill('key-value', SECRET);
    fill('key-expires', '2099-03-01T10:00');
    button('Save key').click();

    await until(() => expect(text()).toContain('Saved the service account key of servicedesk.'));
    const put = writes.find((write) => write.method === 'PUT')!;
    expect(put.url).toBe('/api/v1/admin/systems/servicedesk/service-account-key');
    expect(put.headers).toEqual({});
    expect(put.body).toMatchObject({ value: SECRET });
    expect(Object.keys(put.body as object).sort()).toEqual(['expiresAt', 'value']);
    expect((put.body as { expiresAt: string }).expiresAt).toMatch(/^2099-03-01T\d\d:00:00Z$/);
    await until(() =>
      expect(text(row('servicedesk'))).toContain('Service account key: set, expires 2099-03-01'),
    );
    expect(text(row('servicedesk'))).toContain('Replace key');
    expect(document.getElementById('key-value')).toBeNull();
    expect(leaks(SECRET)).toBe(false);
  });

  it('replaces a key without asking for the old one, and a form without an expiry sends none', async () => {
    store.update({ mfaFresh: true });
    listOf({
      ...basicSystem({ state: 'set', expiresAt: '2099-01-01T00:00:00Z', expired: false }),
      secretScheme: 'Bearer',
    });
    acceptKeysOf('billing');
    await open();
    button('Replace key (billing)').click();
    await until(() => expect(text()).toContain('Replace the service account key of Billing'));
    expect(field('key-expires').value).toBe('');
    fill('key-value', SECRET);
    button('Save key').click();

    await until(() => expect(writes.length).toBe(1));
    expect(writes[0].body).toEqual({ value: SECRET });
  });

  it('takes a login and a password for a Basic system, and the single value only as base64', async () => {
    store.update({ mfaFresh: true });
    listOf(basicSystem({ state: 'missing' }));
    acceptKeysOf('billing');
    await open();
    button('Set key (billing)').click();
    await until(() => expect(document.getElementById('key-username')).toBeTruthy());

    expect(field('key-password').getAttribute('type')).toBe('password');
    expect(field('key-password').getAttribute('autocomplete')).toBe('off');
    expect(document.getElementById('key-value')).toBeNull();
    fill('key-username', 'svc-billing');
    fill('key-password', PASSWORD);
    button('Save key').click();

    await until(() => expect(writes.length).toBe(1));
    expect(writes[0].body).toEqual({ username: 'svc-billing', password: PASSWORD });
    await until(() => expect(leaks(PASSWORD)).toBe(false));

    button('Set key (billing)').click();
    await until(() => expect(document.getElementById('key-username')).toBeTruthy());
    fill('key-username', 'svc-billing');
    fill('key-password', PASSWORD);
    (document.querySelectorAll('input[name="key-mode"]')[1] as HTMLInputElement).click();
    await until(() => expect(document.getElementById('key-value')).toBeTruthy());
    fill('key-value', 'c3ZjOnB3');
    store.update({ mfaFresh: true });
    button('Save key').click();
    await until(() => expect(writes.length).toBe(2));
    expect(writes[1].body).toEqual({ value: 'c3ZjOnB3' });
  });

  it('checks the key and the expiry before anything is sent', async () => {
    store.update({ mfaFresh: true });
    listOf(basicSystem({ state: 'missing' }));
    await open();
    button('Set key (billing)').click();
    await until(() => expect(document.getElementById('key-username')).toBeTruthy());

    button('Save key').click();
    await until(() => expect(text()).toContain('Enter the login'));
    expect(text()).toContain('Enter the password');

    fill('key-username', 'svc:billing');
    fill('key-password', PASSWORD);
    fill('key-expires', '2020-01-01T00:00');
    await settle();
    button('Save key').click();
    await until(() => expect(text()).toContain('no colon'));
    expect(text()).toContain('The expiry has to be a date and time in the future.');

    (document.querySelectorAll('input[name="key-mode"]')[1] as HTMLInputElement).click();
    await until(() => expect(document.getElementById('key-value')).toBeTruthy());
    fill('key-value', 'two words');
    button('Save key').click();
    await until(() => expect(text()).toContain('visible characters only, no spaces'));
    expect(writes).toEqual([]);
  });

  it('empties the secret fields as soon as the key is sent, also when the broker refuses it', async () => {
    store.update({ mfaFresh: true });
    server.use(
      http.put('/api/v1/admin/systems/servicedesk/service-account-key', () =>
        HttpResponse.json(
          {
            error: 'service_account_key_rejected',
            reason: 'expires_at_in_past',
            message: `echo ${SECRET}`,
          },
          { status: 422 },
        ),
      ),
    );
    await open();
    button('Set key (servicedesk)').click();
    await until(() => expect(document.getElementById('key-value')).toBeTruthy());
    fill('key-value', SECRET);
    fill('key-expires', '2099-03-01T10:00');
    await settle();
    button('Save key').click();

    await until(() => expect(text()).toContain('The expiry has to be in the future.'));
    expect(field('key-value').value).toBe('');
    expect(field('key-expires').value).toBe('2099-03-01T10:00');
    expect(leaks(SECRET)).toBe(false);
  });

  it('shows the reason of a refusal for a login on a system that is not Basic', async () => {
    store.update({ mfaFresh: true });
    server.use(
      http.put('/api/v1/admin/systems/servicedesk/service-account-key', () =>
        HttpResponse.json(
          {
            error: 'service_account_key_rejected',
            reason: 'system_not_service_account',
            message: 'x',
          },
          { status: 422 },
        ),
      ),
    );
    await open();
    button('Set key (servicedesk)').click();
    await until(() => expect(document.getElementById('key-value')).toBeTruthy());
    fill('key-value', SECRET);
    button('Save key').click();

    await until(() => expect(text()).toContain('This system does not take a service account'));
  });

  it('goes through a fresh MFA without keeping the key, and opens the form again after the return', async () => {
    const { navigation, harness } = await open();
    button('Set key (servicedesk)').click();
    await until(() => expect(document.getElementById('key-value')).toBeTruthy());
    fill('key-value', SECRET);
    button('Save key').click();

    await until(() =>
      expect(navigation.assign).toHaveBeenCalledWith(
        '/api/v1/auth/login?stepUp=true&returnPath=%2Fadmin%2Fsystems%3Fmfa%3Dok',
      ),
    );
    const kept = sessionStorage.getItem('mcp-portal-resume') ?? '';
    expect(kept).not.toContain(SECRET);
    expect(JSON.parse(JSON.parse(kept).intent.draft)).toEqual({ keyFor: 'servicedesk' });
    expect(
      Object.keys(sessionStorage).some((name) =>
        (sessionStorage.getItem(name) ?? '').includes(SECRET),
      ),
    ).toBe(false);

    store.update({ mfaFresh: true });
    await harness.navigateByUrl('/catalog');
    await harness.navigateByUrl('/admin/systems?mfa=ok');
    await until(() => expect(text()).toContain('Enter the key again and save'));
    expect(field('key-value').value).toBe('');
    fill('key-value', SECRET);
    button('Save key').click();
    await until(() => expect(text()).toContain('Saved the service account key of servicedesk.'));
  });

  it('deletes the key after a confirmation and a fresh MFA', async () => {
    store.update({ mfaFresh: true });
    listOf(basicSystem({ state: 'set', expiresAt: '2099-01-01T00:00:00Z', expired: false }));
    acceptKeysOf('billing');
    await open();
    button('Delete key (billing)').click();

    await until(() =>
      expect(text(dialog())).toContain('Delete the service account key of billing?'),
    );
    expect(text(dialog())).toContain('Deleting needs a fresh MFA');
    button('Delete key', dialog()).click();

    await until(() => expect(text()).toContain('Deleted the service account key of billing.'));
    const del = writes.find((write) => write.method === 'DELETE')!;
    expect(del.url).toBe('/api/v1/admin/systems/billing/service-account-key');
    expect(del.headers).toEqual({});
  });

  it('sends nothing when the deletion is not confirmed', async () => {
    listOf(basicSystem({ state: 'set' }));
    await open();
    button('Delete key (billing)').click();
    await until(() => expect(text(dialog())).toContain('Delete the service account key'));
    button('Cancel', dialog()).click();

    await until(() => expect(document.querySelector('mat-dialog-container')).toBeNull());
    expect(writes).toEqual([]);
  });

  it('sends the user to the IdP when the deletion needs a fresh MFA', async () => {
    const { navigation } = await open();
    store.update({ mfaFresh: true });
    button('Set key (servicedesk)').click();
    await until(() => expect(document.getElementById('key-value')).toBeTruthy());
    fill('key-value', SECRET);
    button('Save key').click();
    await until(() => expect(text()).toContain('Saved the service account key of servicedesk.'));

    await until(() => expect(text(row('servicedesk'))).toContain('Delete key'));
    button('Delete key (servicedesk)').click();
    await until(() => expect(text(dialog())).toContain('Delete the service account key'));
    button('Delete key', dialog()).click();

    await until(() => expect(navigation.assign).toHaveBeenCalledTimes(1));
    expect(text()).not.toContain('Deleted the service account key');
  });

  it('tells in the confirmation of a system removal that the key goes with it', async () => {
    store.update({ mfaFresh: true });
    await open();
    button('Remove (servicedesk)').click();
    await until(() => expect(text(dialog())).toContain('Remove the system servicedesk?'));

    expect(text(dialog())).toContain('the service account key (if one is set)');
  });
});

describe('SystemsPage without the broker', () => {
  const { store } = useMockApi();

  it('shows the list failure with a retry', async () => {
    store.update({ admin: true, scenario: 'errors' });
    configureTestApp();
    await TestBed.inject(SessionService).load();
    await openRoute('/admin/systems');

    await until(() => expect(text()).toContain('The service is temporarily unavailable.'));
    store.update({ scenario: 'default' });
    button('Refresh').click();
    await until(() => expect(text()).toContain('Systems of the credential broker'));
  });
});
