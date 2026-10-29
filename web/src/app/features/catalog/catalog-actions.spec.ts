import { CatalogAction, CatalogStatus } from '../../api/generated';
import { serverFixture, toolFixture } from '../../../testing/fixtures';
import {
  canRequestTool,
  catalogRowActions,
  connectionRowActions,
  isEmphasised,
} from './catalog-actions';

function offered(status: CatalogStatus, actions: CatalogAction[]) {
  return serverFixture('gitlab', { status, actions });
}

describe('catalogRowActions', () => {
  it.each<[CatalogStatus, CatalogAction[], CatalogAction[]]>([
    ['connected', ['copy_link', 'request_access', 'disconnect'], ['copy_link', 'request_access']],
    ['connected', ['copy_link', 'view_request', 'disconnect'], ['copy_link', 'view_request']],
    ['expiring', ['copy_link', 'reconnect', 'disconnect'], ['reconnect', 'copy_link']],
    ['expiring', ['copy_link', 'add_secret', 'disconnect'], ['add_secret', 'copy_link']],
    ['reconnect_required', ['reconnect', 'disconnect'], ['reconnect']],
    ['not_connected', ['add_secret', 'connect_oauth'], ['connect_oauth', 'add_secret']],
    ['request_pending', ['view_request'], ['view_request']],
    ['no_access', ['request_access'], ['request_access']],
    ['no_access', [], []],
  ])('%s offering %j shows %j (never disconnect)', (status, actions, shown) => {
    expect(catalogRowActions(offered(status, actions))).toEqual(shown);
  });
});

describe('systems without a user credential', () => {
  const serviceAccount = serverFixture('servicedesk', {
    status: 'connected',
    actions: ['copy_link', 'add_secret', 'connect_oauth', 'reconnect', 'request_access'],
    credential: { supportedTypes: ['service-account'], defaultType: 'service-account' },
  });
  const tokenExchange = serverFixture('opensearch', {
    status: 'connected',
    actions: ['copy_link', 'add_secret'],
    credential: { supportedTypes: ['token-exchange'], defaultType: 'token-exchange' },
  });

  it('offers no way to connect an account, even when the BFF lists one', () => {
    expect(catalogRowActions(serviceAccount)).toEqual(['copy_link', 'request_access']);
    expect(connectionRowActions(serviceAccount)).toEqual(['request_access']);
    expect(catalogRowActions(tokenExchange)).toEqual(['copy_link']);
  });
});

describe('canRequestTool', () => {
  const denied = toolFixture('jira__create_issue', {
    access: 'denied',
    requiredEntitlements: ['mcp-jira-write'],
  });
  const withRequest = serverFixture('jira', { actions: ['copy_link', 'request_access'] });
  const withPending = serverFixture('jira', { actions: ['copy_link', 'view_request'] });

  it('needs request_access on the server and an entitlement on a denied tool (CC-113)', () => {
    expect(canRequestTool(withRequest, denied)).toBe(true);
    expect(canRequestTool(withPending, denied)).toBe(false);
    expect(canRequestTool(withRequest, { ...denied, requiredEntitlements: [] })).toBe(false);
    expect(canRequestTool(withRequest, { ...denied, access: 'granted' })).toBe(false);
    expect(canRequestTool(withRequest, { ...denied, disabled: true })).toBe(false);
  });
});

describe('connectionRowActions', () => {
  it('keeps disconnect and drops link copying', () => {
    expect(
      connectionRowActions(offered('expiring', ['copy_link', 'add_secret', 'disconnect'])),
    ).toEqual(['add_secret', 'disconnect']);
    expect(connectionRowActions(offered('connected', ['copy_link']))).toEqual([]);
  });
});

describe('isEmphasised', () => {
  it('gives the filled button to the actions that connect an account', () => {
    expect(isEmphasised('reconnect')).toBe(true);
    expect(isEmphasised('connect_oauth')).toBe(true);
    expect(isEmphasised('add_secret')).toBe(true);
    expect(isEmphasised('copy_link')).toBe(false);
    expect(isEmphasised('request_access')).toBe(false);
    expect(isEmphasised('disconnect')).toBe(false);
  });
});
