import { TestBed } from '@angular/core/testing';
import { HttpResponse, http } from 'msw';
import { SessionService } from '../../core/session.service';
import { changePendingDefinition } from '../../../mocks/admin-mock';
import { useMockApi } from '../../../testing/mock-api';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';

/** Tools of an adapter wait without risk and action; the administrator classifies them in a dialog (CC-193, CC-207). */
describe('AdminPage: tools of an adapter', () => {
  const { server, store } = useMockApi();
  const bodies: Record<string, unknown>[] = [];

  beforeAll(() => {
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'POST' && request.url.includes('/approve')) {
        bodies.push((await request.clone().json()) as Record<string, unknown>);
      }
    });
  });
  beforeEach(() => {
    bodies.length = 0;
    store.update({ admin: true, adapter: true });
  });

  function dialog(): HTMLElement {
    const found = document.querySelector<HTMLElement>('mat-dialog-container');
    if (!found) {
      throw new Error('no dialog');
    }
    return found;
  }

  function choose(name: string, value: string): void {
    const input = dialog().querySelector<HTMLInputElement>(
      `input[name="${name}"][value="${value}"]`,
    );
    if (!input) {
      throw new Error(`no ${name}=${value}`);
    }
    input.click();
  }

  async function openClassification(tool: string) {
    const navigation = configureTestApp();
    await TestBed.inject(SessionService).load();
    const harness = await openRoute('/admin');
    await until(() => expect(button(`Show differences (${tool})`)).toBeTruthy());
    button(`Show differences (${tool})`).click();
    await until(() => expect(button(`Classify and approve (${tool})`)).toBeTruthy());
    return { navigation, harness };
  }

  async function startClassification(tool: string) {
    const opened = await openClassification(tool);
    button(`Classify and approve (${tool})`).click();
    await until(() => expect(dialog().querySelector('input[name="classify-risk"]')).toBeTruthy());
    return opened;
  }

  /** The confirm step of the "Approve" dialog of a server definition has the same label; this is the classification one. */
  const confirmClassification = () => button('Approve with this classification', dialog());

  it('lists a tool of an adapter as waiting, with its source and without a risk', async () => {
    configureTestApp();
    await TestBed.inject(SessionService).load();
    await openRoute('/admin');
    await until(() => expect(text()).toContain('mcp-jira'));

    const row = Array.from(document.querySelectorAll('tr.tool')).find((tr) =>
      text(tr).includes('jira__add_worklog'),
    );
    expect(row && text(row)).toContain('Source: adapter');
    expect(row && text(row)).toContain('New · To classify');
  });

  it('shows the definition without a risk, with an adapter warning', async () => {
    await openClassification('jira__add_worklog');

    expect(text()).toContain('Source: foreign server adapter.');
    expect(text()).toContain('risk and action: to be assigned by an administrator');
    expect(text()).not.toContain('risk: Read');
  });

  it('opens the classification dialog with nothing chosen and the hints of the server as untrusted text', async () => {
    await startClassification('jira__delete_comment');

    expect(text(dialog())).toContain('jira__delete_comment');
    expect(text(dialog())).toContain('Server hints (untrusted, no effect on the choice)');
    // The server claims readOnlyHint for a tool that deletes; it is shown, never applied.
    expect(text(dialog())).toContain('readOnlyHint: true');
    expect(dialog().querySelectorAll('input[name="classify-risk"]:checked').length).toBe(0);
    expect(confirmClassification().getAttribute('aria-disabled')).toBe('true');
    expect(bodies).toEqual([]);
  });

  it('offers only Read and read (an adapter is read only) and approves with them', async () => {
    await startClassification('jira__add_worklog');

    expect(
      Array.from(dialog().querySelectorAll<HTMLInputElement>('input[name="classify-risk"]')).map(
        (input) => input.value,
      ),
    ).toEqual(['READ_ONLY']);
    expect(text(dialog())).toContain('read only');
    choose('classify-risk', 'READ_ONLY');
    // The only possible action is taken by itself.
    await until(() =>
      expect(
        Array.from(
          dialog().querySelectorAll<HTMLInputElement>('input[name="classify-action"]'),
        ).map((input) => `${input.value}:${input.checked}`),
      ).toEqual(['read:true']),
    );
    confirmClassification().click();

    await until(() => expect(text()).toContain('Approved the definition of jira__add_worklog.'));
    expect(bodies).toEqual([
      { definitionHash: expect.stringMatching(/^sha256:/), risk: 'READ_ONLY', action: 'read' },
    ]);
    await until(() => expect(text()).toContain('Approved · Read'));
    expect(store.state.classified['mcp-jira/add_worklog']).toMatchObject({
      risk: 'READ_ONLY',
      action: 'read',
    });
  });

  it('sends nothing when the dialog is cancelled', async () => {
    await startClassification('jira__add_worklog');

    button('Cancel', dialog()).click();

    await until(() => expect(document.querySelector('mat-dialog-container')).toBeNull());
    expect(bodies).toEqual([]);
    expect(text()).not.toContain('Approved the definition of');
  });

  it.each([
    ['classification_inconsistent', 'Risk and action do not match.'],
    [
      'classification_not_allowed',
      'The adapter is read-only: its tool can only be approved as Read (read)',
    ],
  ])('shows the 422 %s in the dialog and keeps the choice', async (reason, message) => {
    server.use(
      http.post(
        '/api/v1/admin/registry/servers/mcp-jira/tools/add_worklog/approve',
        () =>
          HttpResponse.json(
            { error: 'manifest_rejected', reason, message: 'server text that must not be shown' },
            { status: 422 },
          ),
        { once: true },
      ),
    );
    await startClassification('jira__add_worklog');
    choose('classify-risk', 'READ_ONLY');
    await until(() =>
      expect(confirmClassification().getAttribute('aria-disabled')).not.toBe('true'),
    );
    confirmClassification().click();

    await until(() => expect(text(dialog())).toContain(message));
    expect(text(dialog())).not.toContain('server text');
    expect(
      dialog().querySelector<HTMLInputElement>('input[name="classify-risk"][value="READ_ONLY"]')
        ?.checked,
    ).toBe(true);

    // The retry goes through (the next answer is the mock's) and the page confirms the approval.
    confirmClassification().click();
    await until(() => expect(text()).toContain('Approved the definition of jira__add_worklog.'));
    expect(bodies.length).toBe(2);
  });

  async function chooseAndConfirm(risk: string, action?: string): Promise<void> {
    choose('classify-risk', risk);
    if (action) {
      await until(() =>
        expect(
          dialog().querySelector(`input[name="classify-action"][value="${action}"]`),
        ).toBeTruthy(),
      );
      choose('classify-action', action);
    }
    await until(() =>
      expect(confirmClassification().getAttribute('aria-disabled')).not.toBe('true'),
    );
    confirmClassification().click();
  }

  describe('a tool that was classified earlier and changed on the server', () => {
    async function lowerToTheMfa() {
      const opened = await startClassification('jira__transition_issue');
      expect(text(dialog())).toContain('Previous classification: Write (UPDATE, update).');
      // Nothing is preselected from the earlier classification: it is a suggestion.
      expect(dialog().querySelectorAll('input[name="classify-risk"]:checked').length).toBe(0);
      await chooseAndConfirm('READ_ONLY');
      // A lower classification is a lowering like any other (CC-167): the administrator confirms it first.
      await until(() => expect(text(dialog())).toContain('Approve risk lowering?'));
      button('Approve risk lowering', dialog()).click();
      await until(() => expect(opened.navigation.assign).toHaveBeenCalled());
      return opened;
    }

    it('needs the fresh MFA for a lower classification and sends acceptRiskLowering with it', async () => {
      const { navigation } = await lowerToTheMfa();

      expect(navigation.assign).toHaveBeenCalledWith(
        '/api/v1/auth/login?stepUp=true&returnPath=%2Fadmin%3Fmfa%3Dok',
      );
      expect(bodies).toEqual([
        {
          definitionHash: expect.stringMatching(/^sha256:/),
          acceptRiskLowering: true,
          risk: 'READ_ONLY',
          action: 'read',
        },
      ]);
      expect(store.state.registryApproved).toEqual([]);
    });

    it('carries out the classification chosen before the MFA after the return, without a second click (U12)', async () => {
      const { harness } = await lowerToTheMfa();

      store.update({ mfaFresh: true });
      await harness.navigateByUrl('/catalog');
      await harness.navigateByUrl('/admin?mfa=ok');

      await until(() => expect(text()).toContain('Approved the definition of jira__transition_issue.'));
      expect(bodies.at(-1)).toEqual({
        definitionHash: expect.stringMatching(/^sha256:/),
        acceptRiskLowering: true,
        risk: 'READ_ONLY',
        action: 'read',
      });
      expect(store.state.classified['mcp-jira/transition_issue']).toMatchObject({
        risk: 'READ_ONLY',
      });
      expect(document.querySelector('mat-dialog-container')).toBeNull();
      expect(sessionStorage.getItem('mcp-portal-resume')).toBeNull();
    });

    it('approves nothing after the return when the definition changed meanwhile', async () => {
      const { harness } = await lowerToTheMfa();

      changePendingDefinition(store, 'mcp-jira', 'transition_issue');
      store.update({ mfaFresh: true });
      await harness.navigateByUrl('/catalog');
      await harness.navigateByUrl('/admin?mfa=ok');

      await until(() =>
        expect(text()).toContain('The definition changed before you confirmed your identity'),
      );
      expect(store.state.registryApproved).toEqual([]);
      expect(bodies.length).toBe(1);
    });
  });

  describe('an entry whose stored classification the gateway voided (CC-227)', () => {
    it('is a lowering from the floor: dialogs, a fresh MFA, acceptRiskLowering, then it resumes by itself (U12)', async () => {
      const { navigation, harness } = await startClassification('jira__link_issues');
      expect(text()).toContain('Risk lowering.');
      await chooseAndConfirm('READ_ONLY');
      await until(() => expect(text(dialog())).toContain('Approve risk lowering?'));
      button('Approve risk lowering', dialog()).click();
      await until(() => expect(navigation.assign).toHaveBeenCalled());
      expect(bodies).toEqual([
        {
          definitionHash: expect.stringMatching(/^sha256:/),
          acceptRiskLowering: true,
          risk: 'READ_ONLY',
          action: 'read',
        },
      ]);
      expect(store.state.registryApproved).toEqual([]);

      store.update({ mfaFresh: true });
      await harness.navigateByUrl('/catalog');
      await harness.navigateByUrl('/admin?mfa=ok');

      await until(() => expect(text()).toContain('Approved the definition of jira__link_issues.'));
      expect(store.state.classified['mcp-jira/link_issues']).toMatchObject({ risk: 'READ_ONLY' });
    });

    it('treats a 422 risk_lowered of an unflagged entry as a lowering: dialog, fresh MFA, again with acceptRiskLowering (U12)', async () => {
      // merge_issues is voided too, but this gateway does not report riskLowered for it.
      const { navigation, harness } = await startClassification('jira__merge_issues');
      expect(text()).not.toContain('Risk lowering.');
      await chooseAndConfirm('READ_ONLY');

      // The first request carries no acceptRiskLowering and is refused with 422 risk_lowered; the portal then asks.
      await until(() => expect(text(dialog())).toContain('Approve risk lowering?'));
      expect(bodies).toEqual([
        { definitionHash: expect.stringMatching(/^sha256:/), risk: 'READ_ONLY', action: 'read' },
      ]);
      button('Approve risk lowering', dialog()).click();
      await until(() => expect(navigation.assign).toHaveBeenCalled());
      expect(bodies.at(-1)).toEqual({
        definitionHash: expect.stringMatching(/^sha256:/),
        acceptRiskLowering: true,
        risk: 'READ_ONLY',
        action: 'read',
      });
      expect(store.state.registryApproved).toEqual([]);

      store.update({ mfaFresh: true });
      await harness.navigateByUrl('/catalog');
      await harness.navigateByUrl('/admin?mfa=ok');

      await until(() => expect(text()).toContain('Approved the definition of jira__merge_issues.'));
      expect(store.state.classified['mcp-jira/merge_issues']).toMatchObject({ risk: 'READ_ONLY' });
    });

    it('does not send again when the lowering is not confirmed', async () => {
      await startClassification('jira__merge_issues');
      await chooseAndConfirm('READ_ONLY');
      await until(() => expect(text(dialog())).toContain('Approve risk lowering?'));

      button('Cancel', dialog()).click();

      await until(() => expect(document.querySelector('mat-dialog-container')).toBeNull());
      expect(bodies.length).toBe(1);
      expect(store.state.registryApproved).toEqual([]);
    });
  });
});
