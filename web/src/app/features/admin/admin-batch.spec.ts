import { TestBed } from '@angular/core/testing';
import { HttpResponse, http } from 'msw';
import { SessionService } from '../../core/session.service';
import { changePendingDefinition } from '../../../mocks/admin-mock';
import { useMockApi } from '../../../testing/mock-api';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';

const GITLAB_TOOLS = [
  'list_projects',
  'get_merge_request',
  'list_pipelines',
  'create_issue',
  'add_mr_comment',
  'delete_branch',
];

function checkbox(tool: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(
    `input[aria-label="Select ${tool} for approval"]`,
  );
  if (!found) {
    throw new Error(`no checkbox for ${tool}`);
  }
  return found;
}

function toolRow(name: string): HTMLElement {
  const cell = Array.from(document.querySelectorAll('tr.tool td')).find(
    (td) => td.querySelector('code')?.textContent === name,
  );
  const row = cell?.closest<HTMLElement>('tr');
  if (!row) {
    throw new Error(`no tool ${name}`);
  }
  return row;
}

/** The buttons of every server carry the same labels; the hidden suffix names the server. */
function gitlab(label: RegExp): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll('button')).find(
    (candidate) => label.test(text(candidate).trim()) && text(candidate).includes('(GitLab)'),
  );
  if (!found) {
    throw new Error(`no GitLab button ${String(label)}`);
  }
  return found;
}

/** Buttons are `disabledInteractive` (app.config), so they stay focusable and say it with aria-disabled. */
function off(element: HTMLElement): boolean {
  return element.getAttribute('aria-disabled') === 'true';
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('mat-dialog-container');
  if (!found) {
    throw new Error('no dialog');
  }
  return found;
}

describe('AdminPage: batch approval of tools', () => {
  const { server, store } = useMockApi();
  const approvals: { tool: string; body: Record<string, unknown> }[] = [];

  beforeAll(() => {
    server.events.on('request:start', async ({ request }) => {
      const match = /\/tools\/([^/]+)\/approve$/.exec(request.url);
      if (request.method === 'POST' && match) {
        approvals.push({
          tool: decodeURIComponent(match[1]),
          body: (await request.clone().json()) as Record<string, unknown>,
        });
      }
    });
  });
  beforeEach(() => {
    approvals.length = 0;
    store.update({ admin: true, batch: true });
  });

  async function openAdmin() {
    const navigation = configureTestApp();
    await TestBed.inject(SessionService).load();
    await openRoute('/admin');
    await until(() => expect(checkbox('gitlab__list_projects')).toBeTruthy());
    return navigation;
  }

  async function confirm(label: string): Promise<void> {
    await until(() => expect(button(label, dialog())).toBeTruthy());
    button(label, dialog()).click();
  }

  it('picks the reading tools only, then every tool a batch can take, and counts them on the button', async () => {
    await openAdmin();
    expect(off(gitlab(/^Approve selected \(0\)/))).toBe(true);

    gitlab(/^Select all read-only/).click();
    await until(() => expect(gitlab(/^Approve selected \(3\)/)).toBeTruthy());
    expect(GITLAB_TOOLS.filter((tool) => checkbox(`gitlab__${tool}`).checked)).toEqual(
      GITLAB_TOOLS.slice(0, 3),
    );

    gitlab(/^Select all \(/).click();
    await until(() => expect(gitlab(/^Approve selected \(6\)/)).toBeTruthy());

    checkbox('gitlab__delete_branch').click();
    await until(() => expect(gitlab(/^Approve selected \(5\)/)).toBeTruthy());

    gitlab(/^Clear selection/).click();
    await until(() => expect(gitlab(/^Approve selected \(0\)/)).toBeTruthy());
  });

  it('gives every checkbox the name of its tool and shows none for a server with nothing pending', async () => {
    await openAdmin();
    for (const tool of GITLAB_TOOLS) {
      expect(checkbox(`gitlab__${tool}`).disabled).toBe(false);
    }
    expect(document.querySelector('input[aria-label*="servicedesk__"]')).toBeNull();
  });

  it('asks once, sends one call per tool in the order of the list with the hash that was shown, and reports once', async () => {
    await openAdmin();
    const shown = new Map(
      (await (await fetch('/api/v1/admin/registry')).json()).flatMap(
        (entry: { tools: { name: string; definitionHash: string }[] }) =>
          entry.tools.map((tool) => [tool.name, tool.definitionHash] as const),
      ),
    );
    gitlab(/^Select all \(/).click();
    await until(() => expect(gitlab(/^Approve selected \(6\)/)).toBeTruthy());
    gitlab(/^Approve selected/).click();

    await until(() => expect(dialog().textContent).toContain('Approve the selected tools?'));
    expect(approvals).toEqual([]);
    await confirm('Approve 6');

    await until(() => expect(text()).toContain('Approved 6 of 6 tools of'));
    expect(approvals.map((call) => call.tool)).toEqual(GITLAB_TOOLS);
    for (const call of approvals) {
      expect(call.body).toEqual({ definitionHash: shown.get(call.tool) });
    }
    expect(store.state.registryApproved).toHaveLength(6);
    await until(() => expect(document.querySelector('input[aria-label*="gitlab__"]')).toBeNull());
    expect(document.querySelectorAll('[role="alert"]').length).toBe(0);
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    await openAdmin();
    gitlab(/^Select all read-only/).click();
    await until(() => expect(gitlab(/^Approve selected \(3\)/)).toBeTruthy());
    gitlab(/^Approve selected/).click();
    await until(() => expect(dialog()).toBeTruthy());
    button('Cancel', dialog()).click();
    await until(() => expect(document.querySelector('mat-dialog-container')).toBeNull());
    expect(approvals).toEqual([]);
    expect(gitlab(/^Approve selected \(3\)/)).toBeTruthy();
  });

  it('continues after a failure, marks the failed rows and reports "4 of 6" once', async () => {
    await openAdmin();
    gitlab(/^Select all \(/).click();
    await until(() => expect(gitlab(/^Approve selected \(6\)/)).toBeTruthy());
    changePendingDefinition(store, 'mcp-gitlab', 'get_merge_request');
    server.use(
      http.post('*/tools/create_issue/approve', () =>
        HttpResponse.json({ error: 'upstream_unavailable', requestId: 'req-1' }, { status: 503 }),
      ),
    );
    gitlab(/^Approve selected/).click();
    await confirm('Approve 6');

    await until(() => expect(text()).toContain('Approved 4 of 6 tools of'));
    expect(approvals.map((call) => call.tool)).toEqual(GITLAB_TOOLS);
    expect(text(toolRow('gitlab__get_merge_request'))).toContain(
      'The definition changed after you picked it, nothing was approved. Open the differences and review it again.',
    );
    expect(text(toolRow('gitlab__create_issue'))).toContain('New · Write');
    expect(toolRow('gitlab__create_issue').querySelector('[role="alert"]')).toBeTruthy();
    await until(() => expect(text(toolRow('gitlab__list_projects'))).toContain('Approved'));
    expect(store.state.registryApproved).toHaveLength(4);
    // The failed rows are not picked again behind the administrator's back.
    // The label reads "Approving 6/6" until the list was read again, so it is awaited like the rest.
    await until(() => expect(gitlab(/^Approve selected \(0\)/)).toBeTruthy());
    expect(checkbox('gitlab__get_merge_request').checked).toBe(false);

    checkbox('gitlab__get_merge_request').click();
    await until(() =>
      expect(toolRow('gitlab__get_merge_request').textContent).not.toContain('changed after'),
    );
  });

  it('shows the progress and keeps the controls off while it runs', async () => {
    await openAdmin();
    gitlab(/^Select all read-only/).click();
    await until(() => expect(gitlab(/^Approve selected \(3\)/)).toBeTruthy());
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.post('*/tools/get_merge_request/approve', async () => {
        await gate;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    gitlab(/^Approve selected/).click();
    await confirm('Approve 3');

    await until(() => expect(off(gitlab(/^Approving 1\/3/))).toBe(true));
    expect(checkbox('gitlab__create_issue').disabled).toBe(true);
    expect(off(gitlab(/^Select all \(/))).toBe(true);
    release();
    await until(() => expect(text()).toContain('Approved 3 of 3 tools of'));
    await until(() => expect(gitlab(/^Approve selected \(0\)/)).toBeTruthy());
  });

  it('stops with a message when the BFF asks for a fresh MFA, and keeps the rest picked', async () => {
    await openAdmin();
    gitlab(/^Select all \(/).click();
    await until(() => expect(gitlab(/^Approve selected \(6\)/)).toBeTruthy());
    server.use(
      http.post('*/tools/create_issue/approve', () =>
        HttpResponse.json(
          {
            error: 'step_up_required',
            stepUpUrl: '/api/v1/auth/login?stepUp=true',
            requestId: 'r',
          },
          { status: 401 },
        ),
      ),
    );
    gitlab(/^Approve selected/).click();
    await confirm('Approve 6');

    await until(() => expect(text()).toContain('the run stopped after 3 of 6 tools'));
    expect(approvals.map((call) => call.tool)).toEqual(GITLAB_TOOLS.slice(0, 4));
    await until(() => expect(gitlab(/^Approve selected \(3\)/)).toBeTruthy());
    expect(checkbox('gitlab__delete_branch').checked).toBe(true);
  });

  describe('what stays out of a batch', () => {
    beforeEach(() => store.update({ adapter: true }));

    it('disables the checkbox of a risk lowering and of an adapter tool, each with its reason, and skips them in "Select all"', async () => {
      await openAdmin();
      await until(() => expect(checkbox('jira__update_issue')).toBeTruthy());

      expect(checkbox('jira__delete_issue').disabled).toBe(true);
      expect(text(toolRow('jira__delete_issue'))).toContain(
        'Lowers the risk: review and approve it on its own.',
      );
      expect(checkbox('jira__transition_issue').disabled).toBe(true);
      expect(text(toolRow('jira__transition_issue'))).toContain(
        'Needs a classification: approve it on its own.',
      );
      expect(checkbox('jira__delete_issue').getAttribute('aria-describedby')).toBeTruthy();
      expect(checkbox('jira__update_issue').disabled).toBe(false);

      const jiraAll = Array.from(document.querySelectorAll('button')).find(
        (candidate) =>
          /^Select all \(/.test(text(candidate).trim()) && text(candidate).includes('Jira'),
      );
      jiraAll?.click();
      await until(() => expect(checkbox('jira__update_issue').checked).toBe(true));
      expect(
        Array.from(document.querySelectorAll<HTMLInputElement>('input.select:checked')).filter(
          (box) => box.getAttribute('aria-label')?.includes('jira__'),
        ),
      ).toHaveLength(1);
    });
  });
});
