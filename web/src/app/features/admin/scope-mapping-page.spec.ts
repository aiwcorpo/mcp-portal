import { TestBed } from '@angular/core/testing';
import { HttpResponse, http } from 'msw';
import { SessionService } from '../../core/session.service';
import { useMockApi } from '../../../testing/mock-api';
import { Recorded, field, fill, recordWrites } from '../../../testing/forms';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';
import { MappingRow, checkRow, scopesOf } from './scope-mapping-page';

describe('checkRow', () => {
  const row = (group: string, scopes: string): MappingRow => ({ key: 1, group, scopes });

  it('accepts a group of the contract and scopes separated by lines, spaces or commas', () => {
    expect(
      checkRow(
        row('mcp-team-platform', 'Jira::Project/PLAT\nNotes::Folder/a, Notes::Folder/b'),
        new Map(),
      ),
    ).toEqual({});
    expect(scopesOf(row('g', 'A::B/c A::B/c\nA::B/d'))).toEqual(['A::B/c', 'A::B/d']);
  });

  it('refuses a group without the prefix and a repeated group', () => {
    expect(checkRow(row('team', 'A::B/c'), new Map()).group).toBeTruthy();
    expect(checkRow(row('mcp-a', 'A::B/c'), new Map([['mcp-a', 2]])).group).toContain('twice');
  });

  it('refuses an empty list and a scope that is not Namespace::Type/id', () => {
    expect(checkRow(row('mcp-a', '  '), new Map()).scopes).toContain('at least one');
    expect(checkRow(row('mcp-a', 'jira/ABC'), new Map()).scopes).toContain('jira/ABC');
    expect(checkRow(row('mcp-a', 'Jira::Project/'), new Map()).scopes).toBeTruthy();
  });
});

describe('ScopeMappingPage', () => {
  const { server, store } = useMockApi();
  const writes: Recorded[] = [];

  beforeAll(() => recordWrites(server, (url) => url.startsWith('/api/v1/admin/policy'), writes));
  beforeEach(() => {
    writes.length = 0;
    store.update({ admin: true });
  });

  async function open(url = '/admin/scope-mapping') {
    const navigation = configureTestApp();
    await TestBed.inject(SessionService).load();
    const harness = await openRoute(url);
    await until(() => expect(text()).toContain('Add group'));
    return { navigation, harness };
  }

  function groupIds(): string[] {
    return Array.from(document.querySelectorAll<HTMLInputElement>('input[id^="sm-group-"]')).map(
      (input) => input.id,
    );
  }

  it('shows every group with its scopes, one per line', async () => {
    await open();

    const ids = groupIds();
    expect(ids.length).toBe(2);
    expect((document.getElementById(ids[1]) as HTMLInputElement).value).toBe('mcp-team-platform');
    const scopes = document.getElementById(
      ids[1].replace('group', 'scopes'),
    ) as HTMLTextAreaElement;
    expect(scopes.value).toBe('Jira::Project/PLAT\nConfluence::Space/PLATFORM');
  });

  it('lists the approved declarations of the registered servers and explains a scope before it is sent', async () => {
    await open();

    await until(() =>
      expect(text()).toContain('Resource types declared by the registered servers'),
    );
    expect(text()).toContain('Jira::Project');
    expect(text()).toContain('Confluence::Space');
    expect(text()).toContain('^[A-Z]{2,10}$');
    expect(text()).toContain('cannot be granted');

    const scopes = groupIds()[0].replace('group', 'scopes');
    fill(scopes, 'Mystery::Place/x');
    await until(() => expect(text()).toContain('No registered server declares Mystery::Place'));
    fill(scopes, 'Jira::Issue/ABC-1');
    await until(() => expect(text()).toContain('has no scope pattern, so it cannot be granted'));
    fill(scopes, 'Jira::Project/abc');
    await until(() =>
      expect(text()).toContain('does not match the scope pattern of Jira::Project'),
    );
    fill(scopes, 'Jira::Project/ABC');
    await until(() => expect(text()).not.toContain('does not match the scope pattern'));
  });

  it('saves the whole document with the ETag it was read with', async () => {
    store.update({ mfaFresh: true });
    await open();
    button('Add group').click();
    await until(() => expect(groupIds().length).toBe(3));
    const id = groupIds()[2];
    fill(id, 'mcp-team-docs');
    fill(id.replace('group', 'scopes'), 'Confluence::Space/DOCS');
    button('Save mapping').click();

    await until(() => expect(text()).toContain('Saved the scope mapping.'));
    expect(writes).toEqual([
      {
        method: 'PUT',
        url: '/api/v1/admin/policy/scope-mapping',
        headers: { 'if-match': '"v1"' },
        body: {
          scopeMapping: [
            { group: 'mcp-jira-proj-ABC', scopes: ['Jira::Project/ABC'] },
            {
              group: 'mcp-team-platform',
              scopes: ['Jira::Project/PLAT', 'Confluence::Space/PLATFORM'],
            },
            { group: 'mcp-team-docs', scopes: ['Confluence::Space/DOCS'] },
          ],
        },
      },
    ]);
  });

  it('shows the errors next to the fields and sends nothing', async () => {
    await open();
    button('Add group').click();
    await until(() => expect(groupIds().length).toBe(3));
    const id = groupIds()[2];
    fill(id, 'docs');
    fill(id.replace('group', 'scopes'), 'confluence/DOCS');
    button('Save mapping').click();

    await until(() => expect(text()).toContain('A group name starts with mcp-'));
    expect(text()).toContain('is not a scope id');
    expect(field(id).getAttribute('aria-invalid')).toBe('true');
    expect(writes).toEqual([]);
  });

  it('shows what the gateway says about a type nobody declares', async () => {
    await open();
    const ids = groupIds();
    fill(ids[0].replace('group', 'scopes'), 'Mystery::Place/x');
    button('Save mapping').click();

    await until(() => expect(text()).toContain('No registered server declares the resource type'));
    expect(text()).toContain('Mystery::Place/x names a type that no registered server declares');
    expect(writes.length).toBe(1);
  });

  it('tells apart a scope that does not fit the pattern of its type', async () => {
    await open();
    fill(groupIds()[0].replace('group', 'scopes'), 'Jira::Project/abc');
    button('Save mapping').click();

    await until(() => expect(text()).toContain('does not match the scope pattern'));
  });

  it('reloads the current mapping on 412 and drops the edits', async () => {
    server.use(
      http.put('/api/v1/admin/policy/scope-mapping', () =>
        HttpResponse.json({ error: 'precondition_failed' }, { status: 412 }),
      ),
    );
    await open();
    const ids = groupIds();
    fill(ids[0].replace('group', 'scopes'), 'Jira::Project/XYZ');
    button('Save mapping').click();

    await until(() => expect(text()).toContain('Someone changed this in the meantime'));
    await until(() => expect(text()).toContain('your edits were not kept'));
    const reloaded = document.getElementById(
      groupIds()[0].replace('group', 'scopes'),
    ) as HTMLTextAreaElement;
    expect(reloaded.value).toBe('Jira::Project/ABC');
  });

  it('keeps the edits through the fresh MFA and gives them back', async () => {
    const { navigation, harness } = await open();
    fill(groupIds()[0].replace('group', 'scopes'), 'Jira::Project/XYZ');
    button('Save mapping').click();

    await until(() =>
      expect(navigation.assign).toHaveBeenCalledWith(
        '/api/v1/auth/login?stepUp=true&returnPath=%2Fadmin%2Fscope-mapping%3Fmfa%3Dok',
      ),
    );
    store.update({ mfaFresh: true });
    await harness.navigateByUrl('/catalog');
    await harness.navigateByUrl('/admin/scope-mapping?mfa=ok');
    await until(() => expect(text()).toContain('Your changes are back in the form'));
    const back = document.getElementById(
      groupIds()[0].replace('group', 'scopes'),
    ) as HTMLTextAreaElement;
    expect(back.value).toBe('Jira::Project/XYZ');

    button('Save mapping').click();
    await until(() => expect(text()).toContain('Saved the scope mapping.'));
  });

  it('removes a group from the document', async () => {
    store.update({ mfaFresh: true });
    await open();
    button('Remove (mcp-team-platform)').click();
    await until(() => expect(groupIds().length).toBe(1));
    button('Save mapping').click();

    await until(() => expect(text()).toContain('Saved the scope mapping.'));
    expect((writes[0].body as { scopeMapping: unknown[] }).scopeMapping.length).toBe(1);
  });

  it('is unavailable with the gateway down', async () => {
    store.update({ scenario: 'errors' });
    configureTestApp();
    await TestBed.inject(SessionService).load();
    await openRoute('/admin/scope-mapping');
    await until(() => expect(text()).toContain('The service is temporarily unavailable.'));
  });
});
