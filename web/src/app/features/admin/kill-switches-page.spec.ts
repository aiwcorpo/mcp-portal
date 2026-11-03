import { TestBed } from '@angular/core/testing';
import { HttpResponse, http } from 'msw';
import { SessionService } from '../../core/session.service';
import { useMockApi } from '../../../testing/mock-api';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';

const SWITCH_OFF = '/api/v1/admin/registry/servers/mcp-jira/tools/update_issue/kill-switch';

/** Emergency switch (A9, CC-194): switching off without MFA, lifting after a fresh MFA, the list of what is off. */
describe('KillSwitchesPage', () => {
  const { server, store } = useMockApi();
  const requests: { method: string; url: string; body: unknown }[] = [];

  beforeAll(() => {
    server.events.on('request:start', async ({ request }) => {
      if (request.method !== 'GET' && request.url.includes('/kill-switch')) {
        requests.push({
          method: request.method,
          url: new URL(request.url).pathname,
          body: request.method === 'PUT' ? await request.clone().json() : null,
        });
      }
    });
  });
  beforeEach(() => {
    requests.length = 0;
    store.update({ admin: true });
  });

  function dialog(): HTMLElement {
    const found = document.querySelector<HTMLElement>('mat-dialog-container');
    if (!found) {
      throw new Error('no dialog');
    }
    return found;
  }

  function field(id: string): HTMLInputElement | HTMLSelectElement {
    return document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
  }

  function fill(id: string, value: string): void {
    const element = field(id);
    element.value = value;
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input'));
  }

  async function open(url = '/admin/kill-switches') {
    const navigation = configureTestApp();
    await TestBed.inject(SessionService).load();
    const harness = await openRoute(url);
    await until(() => expect(text()).toContain('Włączone wyłączniki'));
    return { navigation, harness };
  }

  async function switchOffTool(reason = 'Zapisy psują workflow'): Promise<void> {
    fill('ks-server', 'mcp-jira');
    await until(() =>
      expect(field('ks-tool').querySelectorAll('option').length).toBeGreaterThan(1),
    );
    fill('ks-tool', 'update_issue');
    fill('ks-reason', reason);
    await until(() => expect(button('Wyłącz').getAttribute('aria-disabled')).not.toBe('true'));
    button('Wyłącz').click();
    await until(() => expect(text(dialog())).toContain('Wyłączyć awaryjnie?'));
    button('Wyłącz', dialog()).click();
  }

  it('says so when nothing is switched off', async () => {
    await open();

    expect(text()).toContain('Żaden wyłącznik nie jest włączony.');
    expect(document.querySelector('table')).toBeNull();
  });

  it('lists the switches that are on with who set them, when and why', async () => {
    store.update({
      killSwitches: [
        {
          scope: 'tool',
          serverId: 'mcp-jira',
          tool: 'update_issue',
          setBy: '3c1d6b7e-5a43-4f49-9d4f-0a7b1a1f2c11',
          setAt: '2026-11-03T09:12:44Z',
          reason: 'Zapisy psują workflow‮',
        },
        {
          scope: 'server',
          serverId: 'mcp-confluence',
          setBy: '3c1d6b7e-5a43-4f49-9d4f-0a7b1a1f2c11',
          setAt: '2026-11-03T09:15:02Z',
          reason: 'Awaria dostawcy',
        },
      ],
    });
    await open();

    const body = text(document.querySelector('tbody')!);
    expect(body).toContain('Narzędzie');
    expect(body).toContain('jira__update_issue');
    expect(body).toContain('Serwer');
    expect(body).toContain('Confluence');
    expect(body).toContain('3c1d6b7e-5a43-4f49-9d4f-0a7b1a1f2c11');
    expect(body).toContain('Awaria dostawcy');
    // The reason is the administrator's free text: hidden characters are written out.
    expect(body).toContain('Zapisy psują workflow[U+202E]');
  });

  it('switches a tool off after one confirmation and without any MFA', async () => {
    await open();

    await switchOffTool();

    await until(() => expect(text()).toContain('Wyłączono: Jira: update_issue.'));
    expect(requests).toEqual([
      { method: 'PUT', url: SWITCH_OFF, body: { reason: 'Zapisy psują workflow' } },
    ]);
    await until(() =>
      expect(text(document.querySelector('tbody')!)).toContain('jira__update_issue'),
    );
    expect(store.state.killSwitches.map((entry) => entry.tool)).toEqual(['update_issue']);
    expect(field('ks-reason').value).toBe('');
  });

  it('switches a whole server off', async () => {
    await open();

    fill('ks-server', 'mcp-confluence');
    fill('ks-reason', 'Awaria dostawcy');
    await until(() => expect(button('Wyłącz').getAttribute('aria-disabled')).not.toBe('true'));
    button('Wyłącz').click();
    await until(() => expect(text(dialog())).toContain('Wyłączyć awaryjnie?'));
    button('Wyłącz', dialog()).click();

    await until(() => expect(text()).toContain('Wyłączono: Confluence.'));
    expect(requests.map((request) => request.url)).toEqual([
      '/api/v1/admin/registry/servers/mcp-confluence/kill-switch',
    ]);
  });

  it('sends nothing when the confirmation is cancelled, and needs a server and a reason', async () => {
    await open();
    expect(button('Wyłącz').getAttribute('aria-disabled')).toBe('true');
    fill('ks-server', 'mcp-jira');
    expect(button('Wyłącz').getAttribute('aria-disabled')).toBe('true');
    fill('ks-reason', '   ');
    expect(button('Wyłącz').getAttribute('aria-disabled')).toBe('true');
    fill('ks-reason', 'Awaria');
    await until(() => expect(button('Wyłącz').getAttribute('aria-disabled')).not.toBe('true'));

    button('Wyłącz').click();
    await until(() => expect(text(dialog())).toContain('Wyłączyć awaryjnie?'));
    button('Anuluj', dialog()).click();

    await until(() => expect(document.querySelector('mat-dialog-container')).toBeNull());
    expect(requests).toEqual([]);
  });

  it('limits the reason to what the contract takes and counts what is left', async () => {
    await open();

    fill('ks-reason', 'x'.repeat(150));

    await until(() => expect(text()).toContain('Zostało znaków: 50'));
    expect(field('ks-reason').getAttribute('maxlength')).toBe('200');
  });

  it('shows the failure of switching off and keeps the form', async () => {
    server.use(
      http.put(SWITCH_OFF, () =>
        HttpResponse.json({ error: 'upstream_unavailable' }, { status: 503 }),
      ),
    );
    await open();

    await switchOffTool();

    await until(() => expect(text()).toContain('Usługa jest chwilowo niedostępna.'));
    expect(store.state.killSwitches).toEqual([]);
    expect(field('ks-reason').value).toBe('Zapisy psują workflow');
  });

  describe('lifting', () => {
    beforeEach(() =>
      store.update({
        killSwitches: [
          {
            scope: 'tool',
            serverId: 'mcp-jira',
            tool: 'update_issue',
            setBy: 'admin-1',
            setAt: '2026-11-03T09:12:44Z',
            reason: 'Zapisy psują workflow',
          },
        ],
      }),
    );

    async function startLift() {
      const opened = await open();
      button('Zdejmij (jira__update_issue)').click();
      await until(() => expect(text(dialog())).toContain('Zdjąć wyłącznik?'));
      button('Zdejmij wyłącznik', dialog()).click();
      return opened;
    }

    it('goes through the fresh MFA, saves the intent and carries the lift out after the return (U12)', async () => {
      const { navigation, harness } = await startLift();

      await until(() =>
        expect(navigation.assign).toHaveBeenCalledWith(
          '/api/v1/auth/login?stepUp=true&returnPath=%2Fadmin%2Fkill-switches%3Fmfa%3Dok',
        ),
      );
      expect(store.state.killSwitches.length).toBe(1);
      expect(JSON.parse(sessionStorage.getItem('mcp-portal-resume')!).intent).toEqual({
        kind: 'lift-kill-switch',
        serverId: 'mcp-jira',
        tool: 'update_issue',
        setAt: '2026-11-03T09:12:44Z',
      });

      store.update({ mfaFresh: true });
      await harness.navigateByUrl('/catalog');
      await harness.navigateByUrl('/admin/kill-switches?mfa=ok');

      await until(() => expect(text()).toContain('Zdjęto wyłącznik: jira__update_issue.'));
      expect(text()).toContain('Tożsamość potwierdzona. Zdejmuję wyłącznik');
      expect(store.state.killSwitches).toEqual([]);
      expect(sessionStorage.getItem('mcp-portal-resume')).toBeNull();
      expect(document.querySelector('mat-dialog-container')).toBeNull();
      const deletes = requests.filter((request) => request.method === 'DELETE');
      expect(deletes.length).toBe(2);
    });

    it('lifts at once with a fresh MFA, one confirmation and no redirect', async () => {
      store.update({ mfaFresh: true });
      const { navigation } = await startLift();

      await until(() => expect(text()).toContain('Zdjęto wyłącznik: jira__update_issue.'));
      expect(navigation.assign).not.toHaveBeenCalled();
      expect(store.state.killSwitches).toEqual([]);
    });

    it('does not lift for a bare ?mfa=ok link that this tab did not ask for', async () => {
      store.update({ mfaFresh: true });
      await open('/admin/kill-switches?mfa=ok');

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(requests).toEqual([]);
      expect(store.state.killSwitches.length).toBe(1);
    });

    it('does nothing after the return when the switch was lifted meanwhile', async () => {
      const { harness } = await startLift();
      await until(() => expect(sessionStorage.getItem('mcp-portal-resume')).not.toBeNull());

      store.update({ mfaFresh: true, killSwitches: [] });
      await harness.navigateByUrl('/catalog');
      const before = requests.length;
      await harness.navigateByUrl('/admin/kill-switches?mfa=ok');

      await until(() => expect(text()).toContain('Żaden wyłącznik nie jest włączony.'));
      expect(requests.length).toBe(before);
    });

    it('does not lift a switch that was lifted and put on again meanwhile, and says so', async () => {
      const { harness } = await startLift();
      await until(() => expect(sessionStorage.getItem('mcp-portal-resume')).not.toBeNull());

      store.update({
        mfaFresh: true,
        killSwitches: [
          {
            scope: 'tool',
            serverId: 'mcp-jira',
            tool: 'update_issue',
            setBy: 'admin-2',
            setAt: '2026-11-03T12:00:00Z',
            reason: 'Nowy incydent',
          },
        ],
      });
      await harness.navigateByUrl('/catalog');
      const before = requests.length;
      await harness.navigateByUrl('/admin/kill-switches?mfa=ok');

      await until(() => expect(text()).toContain('Wyłącznik zmienił się, zanim potwierdziłeś'));
      expect(requests.length).toBe(before);
      expect(store.state.killSwitches.length).toBe(1);
    });

    it('shows a second step_up_required as an error instead of looping', async () => {
      const { navigation, harness } = await startLift();
      await until(() => expect(navigation.assign).toHaveBeenCalledTimes(1));

      // The IdP returned, but the gateway still wants a fresh MFA (the login was not one).
      await harness.navigateByUrl('/catalog');
      await harness.navigateByUrl('/admin/kill-switches?mfa=ok');

      await until(() => expect(text()).toContain('wymaga ponownego uwierzytelnienia'));
      expect(navigation.assign).toHaveBeenCalledTimes(1);
    });
  });

  it('shows the list failure with a retry', async () => {
    store.update({ scenario: 'errors' });
    configureTestApp();
    await TestBed.inject(SessionService).load();
    await openRoute('/admin/kill-switches');

    await until(() => expect(text()).toContain('Usługa jest chwilowo niedostępna.'));
    store.update({ scenario: 'default' });
    button('Odśwież').click();
    await until(() => expect(text()).toContain('Żaden wyłącznik nie jest włączony.'));
  });
});
