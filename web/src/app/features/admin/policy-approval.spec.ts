import { TestBed } from '@angular/core/testing';
import { HttpResponse, http } from 'msw';
import { PendingPolicies } from '../../api/generated';
import { SessionService } from '../../core/session.service';
import { POLICY_FIXTURES } from '../../../mocks/dynamic-mock';
import { useMockApi } from '../../../testing/mock-api';
import { Recorded, recordWrites } from '../../../testing/forms';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';
import { diffPolicies, markLines } from './policy-diff';

function pendingOf(serverId: string): PendingPolicies {
  const fixture = POLICY_FIXTURES[serverId];
  return {
    approvedHash: fixture.approved ? 'sha256:' + '0'.repeat(64) : null,
    approvedPolicies: fixture.approved,
    approvedResourceTypes: fixture.approvedTypes,
    pendingHash: fixture.hash,
    pendingPolicies: fixture.pending,
    pendingResourceTypes: fixture.pendingTypes,
    pendingVersion: fixture.version,
    source: fixture.source,
  };
}

function longSchemaPending(): PendingPolicies {
  const pending = pendingOf('mcp-jira');
  const schema = Array.from({ length: 1600 }, (_, index) => `// ${index}`).join('\n');
  return {
    ...pending,
    approvedResourceTypes: pending.pendingResourceTypes,
    approvedPolicies: { ...pending.pendingPolicies, schema, files: [] },
    pendingPolicies: {
      ...pending.pendingPolicies,
      schema,
      files: [{ name: 'all.cedar', text: 'permit (principal, action, resource);' }],
    },
  };
}

describe('diffPolicies', () => {
  it('marks the changed declaration and the added policy file of a changed server', () => {
    const diff = diffPolicies(pendingOf('mcp-jira'));

    expect(diff.firstRegistration).toBe(false);
    expect(diff.resourceTypes.changed).toBe(true);
    expect(
      diff.resourceTypes.before.filter((line) => line.mark === 'removed').map((line) => line.text),
    ).toEqual(['  scopePattern: ^[A-Z]{2,10}$']);
    expect(
      diff.resourceTypes.after.filter((line) => line.mark === 'added').map((line) => line.text),
    ).toEqual(['  scopePattern: ^[A-Z]{2,3}$']);
    expect(
      diff.policies.after.some(
        (line) => line.mark === 'added' && line.text === 'file: delete.cedar',
      ),
    ).toBe(true);
    expect(
      diff.policies.after.some((line) => line.mark === 'added' && line.text.includes('"delete"')),
    ).toBe(true);
  });

  it('has nothing before a first registration', () => {
    const diff = diffPolicies(pendingOf('mcp-notes'));

    expect(diff.firstRegistration).toBe(true);
    expect(diff.resourceTypes.before).toEqual([]);
    expect(diff.policies.after.every((line) => line.mark === 'added')).toBe(true);
  });

  it('writes hidden characters out and never lets a value start a line of its own', () => {
    const pending = pendingOf('mcp-notes');
    pending.pendingPolicies = {
      ...pending.pendingPolicies,
      files: [
        {
          name: 'read.cedar',
          text: 'permit (principal, action, resource);\u200b\r\nfile: evil.cedar',
        },
      ],
    };

    const diff = diffPolicies(pending);

    expect(diff.neutralised).toBe(true);
    expect(diff.policies.after.map((line) => line.text)).toContain(
      '  permit (principal, action, resource);[U+200B]',
    );
    expect(diff.policies.after.map((line) => line.text)).toContain('  file: evil.cedar');
    expect(diff.policies.after.map((line) => line.text)).not.toContain('file: evil.cedar');
  });

  it('cuts a side that is too long and says so', () => {
    const pending = pendingOf('mcp-notes');
    pending.pendingPolicies = {
      ...pending.pendingPolicies,
      files: [
        {
          name: 'big.cedar',
          text: Array.from({ length: 2000 }, (_, index) => `// ${index}`).join('\n'),
        },
      ],
    };

    const diff = diffPolicies(pending);

    expect(diff.truncated).toBe(true);
    expect(diff.policies.after.length).toBe(1500);
  });

  it('reports a change that lies beyond the cut as a change', () => {
    const diff = diffPolicies(longSchemaPending());

    expect(diff.truncated).toBe(true);
    expect(diff.policies.changed).toBe(true);
  });
});

describe('markLines', () => {
  it('keeps common lines on both sides in order', () => {
    const marked = markLines(['a', 'b', 'c'], ['a', 'c', 'd']);

    expect(marked.before.map((line) => `${line.mark}:${line.text}`)).toEqual([
      'same:a',
      'removed:b',
      'same:c',
    ]);
    expect(marked.after.map((line) => `${line.mark}:${line.text}`)).toEqual([
      'same:a',
      'same:c',
      'added:d',
    ]);
  });
});

describe('AdminPage: approval of policies', () => {
  const { server, store } = useMockApi();
  const writes: Recorded[] = [];

  beforeAll(() => recordWrites(server, (url) => url.includes('/policies/'), writes));
  beforeEach(() => {
    writes.length = 0;
    store.update({ admin: true, policies: true });
  });

  async function openAdmin(url = '/admin') {
    const navigation = configureTestApp();
    await TestBed.inject(SessionService).load();
    const harness = await openRoute(url);
    await until(() => expect(text()).toContain('MCP server registry'));
    return { navigation, harness };
  }

  it('marks the servers whose policies wait and counts them next to the tools', async () => {
    await openAdmin();

    expect(text()).toContain('Servers with policies pending approval: 2');
    expect(text()).toContain('Policies and resource types waiting for approval');
    expect(text()).toContain('The tools of this server are blocked until you approve them.');
    expect(text()).toContain('Notes');
  });

  it('shows the policies and the resource types of a changed server next to the approved ones', async () => {
    await openAdmin();

    button('Show differences (Jira, policies)').click();
    await until(() => expect(text()).toContain('Policies and schema'));

    expect(text()).toContain('Resource types');
    expect(text()).toContain('scopePattern: ^[A-Z]{2,10}$');
    expect(text()).toContain('scopePattern: ^[A-Z]{2,3}$');
    expect(text()).toContain('file: delete.cedar');
    expect(text()).toContain('Source: manifest pulled by the gateway, version 1.4.0.');
  });

  it('warns about the source of the policies of a running server and about a first registration', async () => {
    await openAdmin();

    button('Show differences (Notes, policies)').click();
    await until(() => expect(text()).toContain('Source: server.'));

    expect(text()).toContain('First registration');
    expect(text()).toContain('Notes::Folder');
  });

  it('goes through a fresh MFA and carries the approval of the same hash out after the return (U12)', async () => {
    const { navigation, harness } = await openAdmin();
    button('Show differences (Jira, policies)').click();
    await until(() => expect(button('Approve policies (Jira)')).toBeTruthy());
    button('Approve policies (Jira)').click();

    await until(() =>
      expect(navigation.assign).toHaveBeenCalledWith(
        '/api/v1/auth/login?stepUp=true&returnPath=%2Fadmin%3Fmfa%3Dok',
      ),
    );
    expect(store.state.policiesApproved).toEqual([]);

    store.update({ mfaFresh: true });
    await harness.navigateByUrl('/catalog');
    await harness.navigateByUrl('/admin?mfa=ok');

    await until(() => expect(text()).toContain('Approved the policies of Jira.'));
    expect(store.state.policiesApproved).toEqual(['mcp-jira']);
    expect(writes.filter((write) => write.method === 'POST').length).toBe(2);
    expect(writes[1].body).toEqual({ policiesHash: POLICY_FIXTURES['mcp-jira'].hash });
  });

  it('ignores a kept approval whose hash or server has a wrong shape', async () => {
    for (const draft of [
      { op: 'approve-policies', serverId: 'mcp-notes', hash: 'not a hash <script>' },
      { op: 'approve-policies', serverId: 'mcp notes', hash: POLICY_FIXTURES['mcp-notes'].hash },
      { op: 'approve-policies', serverId: 'mcp-notes' },
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
      expect(store.state.policiesApproved).toEqual([]);
      expect(writes).toEqual([]);
      TestBed.resetTestingModule();
    }
  });

  it('lists the mapping entries that the approval makes invalid', async () => {
    store.update({ mfaFresh: true });
    await openAdmin();
    button('Show differences (Jira, policies)').click();
    await until(() => expect(button('Approve policies (Jira)')).toBeTruthy());
    button('Approve policies (Jira)').click();

    await until(() =>
      expect(text()).toContain('The approval made these scope mapping entries invalid'),
    );
    expect(text()).toContain('mcp-team-platform');
  });

  it('reloads the differences when the policies changed under the administrator (409)', async () => {
    server.use(
      http.post('/api/v1/admin/registry/servers/mcp-notes/policies/approve', () =>
        HttpResponse.json({ error: 'hash_mismatch' }, { status: 409 }),
      ),
    );
    await openAdmin();
    button('Show differences (Notes, policies)').click();
    await until(() => expect(button('Approve policies (Notes)')).toBeTruthy());
    button('Approve policies (Notes)').click();

    await until(() => expect(text()).toContain('The policies changed since they were opened'));
  });

  it('does not offer the approval of policies that the cut view does not show in full', async () => {
    server.use(
      http.get('/api/v1/admin/registry/servers/mcp-jira/policies/pending', () =>
        HttpResponse.json(longSchemaPending()),
      ),
    );
    store.update({ mfaFresh: true });
    await openAdmin();
    button('Show differences (Jira, policies)').click();
    await until(() => expect(button('Approve policies (Jira)')).toBeTruthy());

    expect(text()).not.toContain('The policies did not change.');
    expect(text()).toContain('so it cannot be approved here');
    // disabledInteractive (app.config): the button stays clickable and says it with aria-disabled.
    expect(button('Approve policies (Jira)').getAttribute('aria-disabled')).toBe('true');
    button('Approve policies (Jira)').click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writes).toEqual([]);
  });

  it('does not offer an approval for a server whose policies are approved', async () => {
    store.update({ policiesApproved: ['mcp-jira', 'mcp-notes'] });
    await openAdmin();

    expect(text()).not.toContain('Policies and resource types waiting for approval');
    expect(text()).not.toContain('Servers with policies pending approval');
  });
});
