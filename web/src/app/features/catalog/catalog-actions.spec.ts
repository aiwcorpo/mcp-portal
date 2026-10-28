import { CatalogAction, CatalogStatus } from '../../api/generated';
import { serverFixture } from '../../../testing/fixtures';
import { catalogRowActions, connectionRowActions, isEmphasised } from './catalog-actions';

function offered(status: CatalogStatus, actions: CatalogAction[]) {
  return serverFixture('gitlab', { status, actions });
}

describe('catalogRowActions', () => {
  it.each<[CatalogStatus, CatalogAction[], CatalogAction[]]>([
    ['connected', ['copy_link', 'request_access', 'disconnect'], ['copy_link']],
    ['expiring', ['copy_link', 'reconnect', 'disconnect'], ['reconnect', 'copy_link']],
    ['expiring', ['copy_link', 'add_secret', 'disconnect'], ['add_secret', 'copy_link']],
    ['reconnect_required', ['reconnect', 'disconnect'], ['reconnect']],
    ['not_connected', ['add_secret', 'connect_oauth'], ['connect_oauth', 'add_secret']],
    ['request_pending', ['view_request'], []],
    ['no_access', ['request_access'], []],
  ])(
    '%s offering %j shows %j (never disconnect, view_request or request_access in M2)',
    (status, actions, shown) => {
      expect(catalogRowActions(offered(status, actions))).toEqual(shown);
    },
  );
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
