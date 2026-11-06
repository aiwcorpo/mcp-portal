import { connectionFixture, serverFixture } from '../../../testing/fixtures';
import { useMockApi } from '../../../testing/mock-api';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';
import { HttpResponse, http } from 'msw';

function tokenInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[formcontrolname="secret"]')!;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

/** A system whose broker stores a user token without a check (generic REST without whoami, CC-247). */
describe('a token that the system does not verify', () => {
  const { server, store } = useMockApi();

  beforeEach(() => store.update({ unverified: true }));

  it('is stored, said so without a name of an account, and shown as not verified', async () => {
    configureTestApp();
    const harness = await openRoute('/connect/notes');
    await until(() => expect(tokenInput()).toBeTruthy());
    expect(text()).not.toContain('does not check tokens');

    type(tokenInput(), 'notes-token-test-value-0001');
    button('Check and save').click();

    await until(() => expect(text()).toContain('Token stored for Notes.'));
    expect(text()).toContain('(not verified)');
    expect(text()).not.toContain('Connected to Notes as');
    expect(store.state.connections['notes']?.verified).toBe(false);

    await harness.navigateByUrl('/connections');
    await until(() => expect(text()).toContain('Notes'));
    const row = Array.from(document.querySelectorAll('tbody tr')).find((tr) =>
      text(tr).includes('Notes'),
    )!;
    expect(text(row)).toContain('Not verified');
    expect(row.querySelector('.state-danger, .state-error')).toBeNull();
    expect(text(row)).not.toContain('jkowalski');
  });

  it('warns before the token is stored again, when the connection being renewed was not verified', async () => {
    server.use(
      http.get('/api/v1/catalog', () =>
        HttpResponse.json({
          servers: [
            serverFixture('notes', {
              status: 'connected',
              actions: ['add_secret', 'disconnect'],
              credential: { supportedTypes: ['user-secret'], defaultType: 'user-secret' },
              connection: {
                ...connectionFixture('notes', { type: 'user-secret' }),
                backendUser: null,
                verified: false,
              },
            }),
          ],
        }),
      ),
    );
    configureTestApp();
    await openRoute('/connect/notes');
    await until(() => expect(tokenInput()).toBeTruthy());

    expect(text()).toContain('This system does not check tokens when they are stored.');
  });

  it('shows no warning and a named account for a system that checks', async () => {
    store.update({ unverified: false });
    configureTestApp();
    await openRoute('/connect/jira');
    await until(() => expect(tokenInput()).toBeTruthy());
    type(tokenInput(), 'jira-pat-test-value-0001');
    button('Check and save').click();

    await until(() => expect(text()).toContain('Connected to Jira as jkowalski.'));
    expect(text()).not.toContain('not verified');
  });
});
