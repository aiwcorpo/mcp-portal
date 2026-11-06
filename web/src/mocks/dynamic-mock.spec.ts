import { useMockApi } from '../testing/mock-api';

describe('the mock of the administration registry (CC-243 rules)', () => {
  const { store } = useMockApi();
  const get = (path: string, init: RequestInit = {}) =>
    fetch(new URL(path, location.href), {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    });

  beforeEach(() => store.update({ admin: true }));

  it('answers 400 for a path identifier that does not fit, 404 for one that fits and is not there', async () => {
    expect((await get('/api/v1/admin/servers/BAD')).status).toBe(400);
    expect((await get('/api/v1/admin/servers/mcp-gateway')).status).toBe(400);
    expect((await get('/api/v1/admin/systems/Upper')).status).toBe(400);
    expect((await get('/api/v1/admin/policy/overrides/block')).status).toBe(400);
    expect((await get('/api/v1/admin/registry/servers/jira/policies')).status).toBe(400);
    expect((await get('/api/v1/admin/servers/mcp-nothing')).status).toBe(404);
    expect((await get('/api/v1/admin/registry/servers/mcp-nothing/policies')).status).toBe(404);
  });

  it('answers the approved policies of a server, and nulls while nothing is approved', async () => {
    const jira = (await (await get('/api/v1/admin/registry/servers/mcp-jira/policies')).json()) as {
      approvedHash: string | null;
      approvedResourceTypes: { type: string }[] | null;
    };
    expect(jira.approvedHash).toMatch(/^sha256:/);
    expect(jira.approvedResourceTypes?.map((type) => type.type)).toEqual([
      'Jira::Project',
      'Jira::Issue',
    ]);

    const desk = await (
      await get('/api/v1/admin/registry/servers/mcp-servicedesk/policies')
    ).json();
    expect(desk).toEqual({
      approvedHash: null,
      approvedPolicies: null,
      approvedResourceTypes: null,
    });
  });

  it('knows a system by the name the administrator gave it', async () => {
    const systems = (await (await get('/api/v1/admin/systems')).json()) as {
      system: string;
      displayName: string;
    }[];
    expect(systems.find((system) => system.system === 'servicedesk')?.displayName).toBe(
      'Service Desk',
    );
  });
});
