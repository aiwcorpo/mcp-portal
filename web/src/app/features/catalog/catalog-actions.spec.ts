import { CatalogAction, CatalogStatus, PortalCatalogServer } from '../../api/generated';
import { serverActions } from './catalog-actions';

function server(status: CatalogStatus, actions: CatalogAction[]): PortalCatalogServer {
  return {
    serverId: 'mcp-gitlab',
    system: 'gitlab',
    version: '1.0.0',
    url: 'https://mcp-gateway.internal/s/mcp-gitlab/mcp',
    status,
    actions,
    tools: [],
  };
}

describe('serverActions', () => {
  it.each<[CatalogStatus, CatalogAction[], CatalogAction | null, CatalogAction[]]>([
    ['connected', ['copy_link', 'request_access', 'disconnect'], 'copy_link', ['disconnect']],
    [
      'expiring',
      ['copy_link', 'reconnect', 'disconnect'],
      'reconnect',
      ['copy_link', 'disconnect'],
    ],
    ['reconnect_required', ['reconnect', 'disconnect'], 'reconnect', ['disconnect']],
    ['not_connected', ['connect_oauth', 'add_secret'], 'connect_oauth', ['add_secret']],
    ['not_connected', ['add_secret'], 'add_secret', []],
    ['request_pending', ['view_request'], null, []],
    ['no_access', ['request_access'], null, []],
  ])('%s with %j -> primary %s, secondary %j', (status, actions, primary, secondary) => {
    expect(serverActions(server(status, actions))).toEqual({ primary, secondary });
  });

  it('never makes disconnect the main action', () => {
    expect(serverActions(server('connected', ['disconnect']))).toEqual({
      primary: null,
      secondary: ['disconnect'],
    });
  });
});
