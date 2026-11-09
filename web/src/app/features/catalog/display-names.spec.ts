import { HttpResponse, http } from 'msw';
import { connectionFixture, serverFixture, toolFixture } from '../../../testing/fixtures';
import { useMockApi } from '../../../testing/mock-api';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';
import { PortalCatalogServer } from '../../api/generated';

const NAMED: PortalCatalogServer[] = [
  serverFixture('notes', {
    credential: {
      supportedTypes: ['user-oauth'],
      defaultType: 'user-oauth',
      displayName: 'Team notes',
    },
    actions: ['copy_link', 'disconnect'],
    connection: connectionFixture('notes'),
  }),
  serverFixture('jira', {
    credential: {
      supportedTypes: ['user-oauth'],
      defaultType: 'user-oauth',
      displayName: 'Jira of the company‮',
    },
    connection: connectionFixture('jira'),
  }),
  serverFixture('gitlab', { connection: connectionFixture('gitlab') }),
];

/** The pages for users show the display name that the broker reports in the catalog, and the identifier without one (CC-248). */
describe('display names of systems on the user pages', () => {
  const { server } = useMockApi();

  beforeEach(() =>
    server.use(http.get('/api/v1/catalog', () => HttpResponse.json({ servers: NAMED }))),
  );

  it('are in the catalog, where a hidden character is written out and a missing name falls back to the id', async () => {
    configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('Team notes'));

    expect(text()).toContain('Jira of the company[U+202E]');
    expect(text()).toContain('Gitlab');
  });

  it('are searched in the catalog', async () => {
    configureTestApp();
    await openRoute('/catalog');
    await until(() => expect(text()).toContain('Team notes'));
    const search = document.querySelector<HTMLInputElement>(
      'input[type="search"], input.searchbox',
    )!;
    search.value = 'team';
    search.dispatchEvent(new Event('input'));

    await until(() => expect(text()).not.toContain('Gitlab'));
    expect(text()).toContain('Team notes');
  });

  it('are on the connections page and in the text of a disconnection', async () => {
    configureTestApp();
    await openRoute('/connections');
    await until(() => expect(text()).toContain('Team notes'));

    await until(() => expect(button('Disconnect (Team notes)')).toBeTruthy());
    button('Disconnect (Team notes)').click();
    await until(() =>
      expect(text(document.querySelector('mat-dialog-container') ?? document.body)).toContain(
        'Disconnect account Team notes?',
      ),
    );
  });

  it('are in the request dialog and in the title of an entitlement on the requests page', async () => {
    server.use(
      http.get('/api/v1/catalog', () =>
        HttpResponse.json({
          servers: [
            ...NAMED,
            serverFixture('opensearch', {
              status: 'no_access',
              actions: ['request_access'],
              tools: [
                toolFixture('opensearch__q', {
                  access: 'denied',
                  requiredEntitlements: ['mcp-opensearch-read'],
                }),
              ],
            }),
          ],
        }),
      ),
    );
    configureTestApp();
    await openRoute('/requests');
    await until(() => expect(button('Submit request')).toBeTruthy());
    button('Submit request').click();
    await until(() =>
      expect(document.querySelector('#request-system option[value="notes"]')).toBeTruthy(),
    );

    expect(text(document.querySelector('#request-system')!)).toContain('Team notes');
  });

  it('name a system in the OAuth return banner only when the catalog has it', async () => {
    configureTestApp();
    await openRoute('/catalog?connected=notes');
    await until(() => expect(text()).toContain('Connected to Team notes as jkowalski.'));
  });
});
