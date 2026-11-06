import { TestBed } from '@angular/core/testing';
import { HttpResponse, http } from 'msw';
import { SessionService } from '../../core/session.service';
import { useMockApi } from '../../../testing/mock-api';
import { Recorded, dialog, field, fill, recordWrites, toggle } from '../../../testing/forms';
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
