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
    await until(() => expect(button(`Pokaż różnice (${tool})`)).toBeTruthy());
    button(`Pokaż różnice (${tool})`).click();
    await until(() => expect(button(`Sklasyfikuj i zatwierdź (${tool})`)).toBeTruthy());
    return { navigation, harness };
  }

  async function startClassification(tool: string) {
    const opened = await openClassification(tool);
    button(`Sklasyfikuj i zatwierdź (${tool})`).click();
    await until(() => expect(dialog().querySelector('input[name="classify-risk"]')).toBeTruthy());
    return opened;
  }

  /** The confirm step of the "Zatwierdź" dialog of a server definition has the same label; this is the classification one. */
  const confirmClassification = () => button('Zatwierdź z tą klasyfikacją', dialog());

  it('lists a tool of an adapter as waiting, with its source and without a risk', async () => {
    configureTestApp();
    await TestBed.inject(SessionService).load();
    await openRoute('/admin');
    await until(() => expect(text()).toContain('mcp-jira'));

    const row = Array.from(document.querySelectorAll('tr.tool')).find((tr) =>
      text(tr).includes('jira__add_worklog'),
    );
    expect(row && text(row)).toContain('Źródło: adapter');
    expect(row && text(row)).toContain('Nowe · Do klasyfikacji');
  });

  it('shows the definition without a risk, with an adapter warning', async () => {
    await openClassification('jira__add_worklog');

    expect(text()).toContain('Źródło: adapter obcego serwera.');
    expect(text()).toContain('ryzyko i akcja: do nadania przez administratora');
    expect(text()).not.toContain('ryzyko: Odczyt');
  });

  it('opens the classification dialog with nothing chosen and the hints of the server as untrusted text', async () => {
    await startClassification('jira__delete_comment');

    expect(text(dialog())).toContain('jira__delete_comment');
    expect(text(dialog())).toContain('Podpowiedzi serwera (niezaufane, bez wpływu na wybór)');
    // The server claims readOnlyHint for a tool that deletes; it is shown, never applied.
    expect(text(dialog())).toContain('readOnlyHint: true');
    expect(dialog().querySelectorAll('input[name="classify-risk"]:checked').length).toBe(0);
    expect(confirmClassification().getAttribute('aria-disabled')).toBe('true');
    expect(bodies).toEqual([]);
  });

  it('offers only the actions that fit the risk and approves with the chosen pair', async () => {
    await startClassification('jira__add_worklog');

    choose('classify-risk', 'UPDATE');
    await until(() =>
      expect(
        Array.from(
          dialog().querySelectorAll<HTMLInputElement>('input[name="classify-action"]'),
        ).map((input) => input.value),
      ).toEqual(['update', 'admin']),
    );
    expect(confirmClassification().getAttribute('aria-disabled')).toBe('true');
    choose('classify-action', 'update');
    await until(() =>
      expect(confirmClassification().getAttribute('aria-disabled')).not.toBe('true'),
    );
    confirmClassification().click();

    await until(() => expect(text()).toContain('Zatwierdzono definicję jira__add_worklog.'));
    expect(bodies).toEqual([
      { definitionHash: expect.stringMatching(/^sha256:/), risk: 'UPDATE', action: 'update' },
    ]);
    await until(() => expect(text()).toContain('Zatwierdzone · Zapis'));
    expect(store.state.classified['mcp-jira/add_worklog']).toMatchObject({
      risk: 'UPDATE',
      action: 'update',
    });
  });

  it('takes the only action of READ_ONLY by itself and restricts DESTRUCTIVE to delete and admin', async () => {
    await startClassification('jira__add_worklog');

    choose('classify-risk', 'READ_ONLY');
    await until(() =>
      expect(
        Array.from(
          dialog().querySelectorAll<HTMLInputElement>('input[name="classify-action"]'),
        ).map((input) => `${input.value}:${input.checked}`),
      ).toEqual(['read:true']),
    );
    choose('classify-risk', 'DESTRUCTIVE');
    await until(() =>
      expect(
        Array.from(
          dialog().querySelectorAll<HTMLInputElement>('input[name="classify-action"]'),
        ).map((input) => `${input.value}:${input.checked}`),
      ).toEqual(['delete:false', 'admin:false']),
    );
  });

  it('sends nothing when the dialog is cancelled', async () => {
    await startClassification('jira__add_worklog');

    button('Anuluj', dialog()).click();

    await until(() => expect(document.querySelector('mat-dialog-container')).toBeNull());
    expect(bodies).toEqual([]);
    expect(text()).not.toContain('Zatwierdzono definicję');
  });

  it('shows the 422 classification_inconsistent in the dialog and keeps the choice', async () => {
    server.use(
      http.post(
        '/api/v1/admin/registry/servers/mcp-jira/tools/add_worklog/approve',
        () =>
          HttpResponse.json(
            {
              error: 'manifest_rejected',
              reason: 'classification_inconsistent',
              message: 'server text that must not be shown',
            },
            { status: 422 },
          ),
        { once: true },
      ),
    );
    await startClassification('jira__add_worklog');
    choose('classify-risk', 'UPDATE');
    await until(() => expect(dialog().querySelector('input[name="classify-action"]')).toBeTruthy());
    choose('classify-action', 'admin');
    await until(() =>
      expect(confirmClassification().getAttribute('aria-disabled')).not.toBe('true'),
    );
    confirmClassification().click();

    await until(() => expect(text(dialog())).toContain('Ryzyko i akcja nie pasują do siebie.'));
    expect(text(dialog())).not.toContain('server text');
    expect(
      dialog().querySelector<HTMLInputElement>('input[name="classify-risk"][value="UPDATE"]')
        ?.checked,
    ).toBe(true);
    expect(
      dialog().querySelector<HTMLInputElement>('input[name="classify-action"][value="admin"]')
        ?.checked,
    ).toBe(true);

    // The retry goes through (the next answer is the mock's) and the page confirms the approval.
    confirmClassification().click();
    await until(() => expect(text()).toContain('Zatwierdzono definicję jira__add_worklog.'));
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
      expect(text(dialog())).toContain('Poprzednia klasyfikacja: Zapis (UPDATE, update).');
      // Nothing is preselected from the earlier classification: it is a suggestion.
      expect(dialog().querySelectorAll('input[name="classify-risk"]:checked').length).toBe(0);
      await chooseAndConfirm('READ_ONLY');
      // A lower classification is a lowering like any other (CC-167): the administrator confirms it first.
      await until(() => expect(text(dialog())).toContain('Zatwierdzić obniżenie ryzyka?'));
      button('Zatwierdź obniżenie ryzyka', dialog()).click();
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

      await until(() => expect(text()).toContain('Zatwierdzono definicję jira__transition_issue.'));
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
        expect(text()).toContain('Definicja zmieniła się, zanim potwierdziłeś tożsamość'),
      );
      expect(store.state.registryApproved).toEqual([]);
      expect(bodies.length).toBe(1);
    });

    it('does not ask for the MFA when the new classification is the same or higher', async () => {
      await startClassification('jira__transition_issue');

      await chooseAndConfirm('DESTRUCTIVE', 'delete');

      await until(() => expect(text()).toContain('Zatwierdzono definicję jira__transition_issue.'));
      expect(bodies).toEqual([
        {
          definitionHash: expect.stringMatching(/^sha256:/),
          risk: 'DESTRUCTIVE',
          action: 'delete',
        },
      ]);
    });
  });
});
