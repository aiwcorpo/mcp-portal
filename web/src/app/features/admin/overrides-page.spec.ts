import { TestBed } from '@angular/core/testing';
import { HttpResponse, http } from 'msw';
import { SessionService } from '../../core/session.service';
import { useMockApi } from '../../../testing/mock-api';
import { Recorded, dialog, field, fill, recordWrites } from '../../../testing/forms';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';
import { overrideTemplate } from './admin-validation';

describe('OverridesPage', () => {
  const { server, store } = useMockApi();
  const writes: Recorded[] = [];

  beforeAll(() =>
    recordWrites(server, (url) => url.startsWith('/api/v1/admin/policy/overrides'), writes),
  );
  beforeEach(() => {
    writes.length = 0;
    store.update({ admin: true });
  });

  async function open(url = '/admin/overrides') {
    const navigation = configureTestApp();
    await TestBed.inject(SessionService).load();
    const harness = await openRoute(url);
    await until(() => expect(text()).toContain('Emergency overrides'));
    return { navigation, harness };
  }

  const POLICY = (id: string) =>
    `@id("${id}")\nforbid (principal, action == Action::"call", resource is Tool)\nwhen { resource.name == "drop_table" };`;

  it('lists the overrides with target, policy and who set them', async () => {
    await open();

    const body = text(document.querySelector('tbody')!);
    expect(body).toContain('override-block-drop-table');
    expect(body).toContain('Gateway');
    expect(body).toContain('resource.name == "drop_table"');
    expect(body).toContain('3c1d6b7e-5a43-4f49-9d4f-0a7b1a1f2c11');
  });

  it('adds an override for the gateway with If-None-Match, without a second factor', async () => {
    const { navigation } = await open();
    button('Add override').click();
    await until(() => expect(document.getElementById('ov-name')).toBeTruthy());

    fill('ov-name', 'block-delete');
    fill('ov-text', POLICY('override-block-delete'));
    button('Save').click();

    await until(() => expect(text()).toContain('Added the override override-block-delete.'));
    expect(navigation.assign).not.toHaveBeenCalled();
    expect(writes).toEqual([
      {
        method: 'PUT',
        url: '/api/v1/admin/policy/overrides/override-block-delete',
        headers: { 'if-none-match': '*' },
        body: { target: 'gateway', text: POLICY('override-block-delete') },
      },
    ]);
  });

  it('targets one server chosen from the registry', async () => {
    await open();
    button('Add override').click();
    await until(() => expect(document.getElementById('ov-name')).toBeTruthy());
    fill('ov-name', 'jira-off');
    fill('ov-target', 'server');
    await until(() =>
      expect(document.querySelectorAll('#ov-server option').length).toBeGreaterThan(2),
    );
    fill('ov-server', 'mcp-jira');
    button('Start from a template').click();
    await until(() =>
      expect((field('ov-text') as HTMLTextAreaElement).value).toContain('@id("override-jira-off")'),
    );
    button('Save').click();

    await until(() => expect(text()).toContain('Added the override override-jira-off.'));
    expect(writes[0].body).toEqual({
      target: 'mcp-jira',
      text: overrideTemplate('override-jira-off', 'mcp-jira'),
    });
  });

  it('checks the identifier, the server and the text before sending', async () => {
    await open();
    button('Add override').click();
    await until(() => expect(document.getElementById('ov-name')).toBeTruthy());
    fill('ov-name', 'Bad Name');
    fill('ov-target', 'server');
    button('Save').click();

    await until(() => expect(text()).toContain('Use lower case letters, digits and hyphens'));
    expect(text()).toContain('Choose a server.');
    expect(text()).toContain('Enter the policy.');
    expect(writes).toEqual([]);
  });

  it('shows why the gateway refuses a permit', async () => {
    await open();
    button('Add override').click();
    await until(() => expect(document.getElementById('ov-name')).toBeTruthy());
    fill('ov-name', 'let-through');
    fill('ov-text', '@id("override-let-through")\npermit (principal, action, resource);');
    button('Save').click();

    await until(() => expect(text()).toContain('An override can only forbid.'));
    expect(text()).toContain('an override is forbid only');
  });

  it('replaces an override with the ETag of the one that was read, after a fresh MFA', async () => {
    store.update({ mfaFresh: true });
    await open();
    button('Edit (override-block-drop-table)').click();
    await until(() => expect(document.getElementById('ov-text')).toBeTruthy());
    expect(document.getElementById('ov-name')).toBeNull();

    fill('ov-text', POLICY('override-block-drop-table').replace('drop_table', 'truncate_table'));
    button('Save').click();

    await until(() => expect(text()).toContain('Saved the override override-block-drop-table.'));
    expect(writes[0].headers).toEqual({ 'if-match': '"v1"' });
    expect(writes[0].method).toBe('PUT');
  });

  it('needs a fresh MFA to replace an override, because a weaker text widens access, and keeps the form (CC-243)', async () => {
    const { navigation, harness } = await open();
    button('Edit (override-block-drop-table)').click();
    await until(() => expect(document.getElementById('ov-text')).toBeTruthy());
    fill('ov-text', POLICY('override-block-drop-table').replace('drop_table', 'truncate_table'));
    button('Save').click();

    await until(() =>
      expect(navigation.assign).toHaveBeenCalledWith(
        '/api/v1/auth/login?stepUp=true&returnPath=%2Fadmin%2Foverrides%3Fmfa%3Dok',
      ),
    );
    expect(store.state.mfaFresh).toBe(false);

    store.update({ mfaFresh: true });
    await harness.navigateByUrl('/catalog');
    await harness.navigateByUrl('/admin/overrides?mfa=ok');
    await until(() =>
      expect(text()).toContain('Identity confirmed. Check the form and save again.'),
    );
    expect((field('ov-text') as HTMLTextAreaElement).value).toContain('truncate_table');
    button('Save').click();
    await until(() => expect(text()).toContain('Saved the override override-block-drop-table.'));
  });

  it('removes an override after a confirmation, the ETag and a fresh MFA', async () => {
    const { navigation, harness } = await open();
    button('Remove (override-block-drop-table)').click();
    await until(() =>
      expect(text(dialog())).toContain('Remove the override override-block-drop-table?'),
    );
    button('Remove override', dialog()).click();
    await until(() => expect(navigation.assign).toHaveBeenCalledTimes(1));

    store.update({ mfaFresh: true });
    await harness.navigateByUrl('/catalog');
    await harness.navigateByUrl('/admin/overrides?mfa=ok');
    await until(() => expect(text()).toContain('Identity confirmed. Repeat the operation.'));
    button('Remove (override-block-drop-table)').click();
    await until(() => expect(text(dialog())).toContain('Remove the override'));
    button('Remove override', dialog()).click();

    await until(() => expect(text()).toContain('Removed the override override-block-drop-table.'));
    const deletes = writes.filter((write) => write.method === 'DELETE');
    expect(deletes.length).toBe(2);
    expect(deletes[1].headers).toEqual({ 'if-match': '"v1"' });
    await until(() => expect(text()).toContain('No override is set.'));
  });

  it('shows 412 when the override changed after it was read', async () => {
    server.use(
      http.put('/api/v1/admin/policy/overrides/override-block-drop-table', () =>
        HttpResponse.json({ error: 'precondition_failed' }, { status: 412 }),
      ),
    );
    await open();
    button('Edit (override-block-drop-table)').click();
    await until(() => expect(document.getElementById('ov-text')).toBeTruthy());
    button('Save').click();

    await until(() => expect(text()).toContain('Someone changed this in the meantime'));
  });

  it('is unavailable with the gateway down', async () => {
    store.update({ scenario: 'errors' });
    configureTestApp();
    await TestBed.inject(SessionService).load();
    await openRoute('/admin/overrides');
    await until(() => expect(text()).toContain('The service is temporarily unavailable.'));
  });
});
