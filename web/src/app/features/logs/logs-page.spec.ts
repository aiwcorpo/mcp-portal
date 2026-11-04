import { HttpResponse, http } from 'msw';
import { ActivityCall } from '../../api/generated';
import { useMockApi } from '../../../testing/mock-api';
import {
  button,
  configureTestApp,
  labelled,
  openRoute,
  text,
  until,
} from '../../../testing/test-app';
import { resultInfo } from './activity-labels';

function call(overrides: Partial<ActivityCall> = {}): ActivityCall {
  return {
    requestId: '0192d1b2-7c3a-7d4e-8f10-000000000001',
    ts: '2026-10-28T10:05:00.000Z',
    client: 'claude-code',
    tool: 'jira__get_issue',
    risk: 'READ_ONLY',
    result: 'ok',
    errorCode: null,
    ...overrides,
  };
}

function select(id: string, value: string): void {
  const element = document.getElementById(id) as HTMLSelectElement;
  element.value = value;
  element.dispatchEvent(new Event('change'));
}

describe('LogsPage', () => {
  const { server } = useMockApi();

  function recordQueries() {
    const queries: URLSearchParams[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname === '/api/v1/activity/calls') {
        queries.push(url.searchParams);
      }
    });
    return queries;
  }

  it('lists one row per call with time, client, tool, resource and result', async () => {
    configureTestApp();
    await openRoute('/logs');
    await until(() => expect(text()).toContain('confluence__delete_page'));

    expect(text()).toContain('Waiting for confirmation');
    expect(text()).toContain('Claude Code');
    expect(text()).toContain('Confluence DEV / 48213');
    expect(text()).toContain('Done');
    expect(text()).toContain('Only your calls. Argument values are not shown here.');
    expect(document.getElementById('logs-q')).toBeTruthy();
    expect((document.getElementById('logs-period') as HTMLSelectElement).value).toBe('7d');
    expect(text()).toContain('All results');
    const ids = Array.from(document.querySelectorAll('tbody tr:not(.details) code')).map(
      (node) => node.textContent,
    );
    expect(ids.filter((tool) => tool === 'jira__delete_issue').length).toBeGreaterThan(3);
  });

  it('shows the contract labels for every confirmation outcome, including unknown values', async () => {
    configureTestApp();
    await openRoute('/logs');
    await until(() => expect(text()).toContain('Waiting for confirmation'));

    for (const label of [
      'Confirmed with a code',
      'Expired',
      'Wrong code',
      'Invalidated',
      'Cancelled',
      'Blocked by a pending operation',
      'Refused (no entitlement)',
      'Refused (outside the address filter)',
      'Error',
      'Too many calls',
      'Other result',
    ]) {
      expect(text(), label).toContain(label);
    }
    expect(resultInfo('result_from_a_newer_gateway').label).toBe('Other result');
    expect(resultInfo('constructor').label).toBe('Other result');
  });

  it('shows the count of wrong codes and the explanation in the details of a row', async () => {
    server.use(
      http.get('/api/v1/activity/calls', () =>
        HttpResponse.json([
          call({
            tool: 'jira__delete_issue',
            risk: 'DESTRUCTIVE',
            result: 'confirmed',
            wrongCodeCount: 2,
            filter: 'systems=jira&access=write',
          }),
          call({
            requestId: '0192d1b2-7c3a-7d4e-8f10-000000000002',
            result: 'blocked_by_pending',
            errorCode: 'confirmation_blocked',
          }),
        ]),
      ),
    );
    configureTestApp();
    await openRoute('/logs');
    await until(() => expect(text()).toContain('Confirmed with a code'));
    expect(document.querySelector('[data-testid="wrong-code-count"]')).toBeNull();

    labelled('Show details: jira__delete_issue').click();
    await until(() =>
      expect(document.querySelector('[data-testid="wrong-code-count"]')?.textContent).toBe('2'),
    );
    expect(text()).toContain('Delete');
    expect(labelled('Hide details: jira__delete_issue').getAttribute('aria-expanded')).toBe('true');
  });

  it('sends the filters to the API and starts again from the first page', async () => {
    const queries = recordQueries();
    configureTestApp();
    await openRoute('/logs');
    await until(() => expect(text()).toContain('confluence__delete_page'));
    expect(queries[0].get('limit')).toBe('50');
    expect(Date.parse(queries[0].get('from')!)).toBeLessThan(Date.now() - 6 * 86_400_000);
    expect(queries[0].has('result')).toBe(false);
    expect(queries[0].has('q')).toBe(false);

    select('logs-group', 'confirmation');
    await until(() => expect(queries.at(-1)?.get('result')).toBe('confirmation'));
    await until(() => expect(text()).toContain('Waiting for confirmation'));
    expect(text()).not.toContain('Done');

    select('logs-period', '24h');
    await until(() =>
      expect(Date.parse(queries.at(-1)!.get('from')!)).toBeGreaterThan(Date.now() - 2 * 86_400_000),
    );

    const input = document.getElementById('logs-q') as HTMLInputElement;
    input.value = '  ABC-1190 ';
    input.dispatchEvent(new Event('input'));
    await until(() => expect(queries.at(-1)?.get('q')).toBe('ABC-1190'));
    expect(queries.at(-1)?.get('cursor')).toBeNull();
  });

  it('puts limits and step-up refusals in "Refusals" and missing credentials in "Errors" (CC-142)', async () => {
    configureTestApp();
    await openRoute('/logs');
    await until(() => expect(text()).toContain('Too many calls'));

    select('logs-group', 'denied');
    await until(() => {
      expect(text()).not.toContain('Done');
      expect(text()).toContain('Too many calls');
    });
    expect(text()).toContain('Refused (no entitlement)');
    expect(text()).toContain('Tool switched off');
    expect(text()).not.toContain('No connection to the system');

    select('logs-group', 'error');
    await until(() => {
      expect(text()).not.toContain('Too many calls');
      expect(text()).toContain('Error');
    });
  });

  it('says so when no call matches the filters', async () => {
    configureTestApp();
    await openRoute('/logs');
    await until(() => expect(text()).toContain('confluence__delete_page'));
    const input = document.getElementById('logs-q') as HTMLInputElement;
    input.value = 'nothing-called-this';
    input.dispatchEvent(new Event('input'));
    await until(() => expect(text()).toContain('No call matches the filters.'));
  });

  it('adds the next page with the cursor of the last answer', async () => {
    const queries = recordQueries();
    configureTestApp();
    await openRoute('/logs');
    await until(() => expect(text()).toContain('Show more'));
    const before = document.querySelectorAll('tbody tr:not(.details)').length;
    expect(before).toBe(50);

    button('Show more').click();
    await until(() =>
      expect(document.querySelectorAll('tbody tr:not(.details)').length).toBeGreaterThan(before),
    );
    expect(queries.at(-1)?.get('cursor')).toBe('c50');
    await until(() => expect(text()).not.toContain('Show more'));
  });

  it('keeps the rows and offers a retry when "Show more" fails', async () => {
    configureTestApp();
    await openRoute('/logs');
    await until(() => expect(text()).toContain('Show more'));
    server.use(
      http.get(
        '/api/v1/activity/calls',
        () => HttpResponse.json({ error: 'upstream_unavailable' }, { status: 503 }),
        { once: true },
      ),
    );
    button('Show more').click();
    await until(() => expect(text()).toContain('The service is temporarily unavailable.'));
    expect(document.querySelectorAll('tbody tr:not(.details)').length).toBe(50);
    button('Try again').click();
    await until(() => expect(text()).not.toContain('The service is temporarily unavailable.'));
  });

  it('shows one error for the whole page when the list cannot be read', async () => {
    server.use(
      http.get('/api/v1/activity/calls', () =>
        HttpResponse.json(
          { error: 'upstream_unavailable', requestId: 'abcdef12-0000-0000-0000-000000000000' },
          { status: 503 },
        ),
      ),
    );
    configureTestApp();
    await openRoute('/logs');
    await until(() => expect(text()).toContain('Could not load the data.'));
    expect(text()).toContain('abcdef12');
    expect(document.querySelector('table')).toBeNull();
  });

  it('shows an empty state', async () => {
    server.use(http.get('/api/v1/activity/calls', () => HttpResponse.json([])));
    configureTestApp();
    await openRoute('/logs');
    await until(() => expect(text()).toContain('No calls in the selected period.'));
  });

  it('ignores an answer to a filter the user has already changed', async () => {
    let first = true;
    server.use(
      http.get('/api/v1/activity/calls', async () => {
        if (first) {
          first = false;
          await new Promise((resolve) => setTimeout(resolve, 150));
          return HttpResponse.json([call({ tool: 'jira__stale_answer' })]);
        }
        return HttpResponse.json([call({ tool: 'jira__fresh_answer' })]);
      }),
    );
    configureTestApp();
    await openRoute('/logs');
    select('logs-group', 'ok');
    await until(() => expect(text()).toContain('jira__fresh_answer'));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(text()).not.toContain('jira__stale_answer');
  });

  it('shows control characters in a resource as markers, not as invisible text', async () => {
    server.use(
      http.get('/api/v1/activity/calls', () =>
        HttpResponse.json([
          call({ resource: { type: 'Jira::Issue', id: `ABC${String.fromCodePoint(0x202e)}1` } }),
        ]),
      ),
    );
    configureTestApp();
    await openRoute('/logs');
    await until(() => expect(text()).toContain('Jira ABC[U+202E]1'));
  });

  it('starts again from the first page when the cursor has expired (400)', async () => {
    configureTestApp();
    await openRoute('/logs');
    await until(() => expect(text()).toContain('Show more'));
    const cursors: (string | null)[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname === '/api/v1/activity/calls') {
        cursors.push(url.searchParams.get('cursor'));
      }
    });
    server.use(
      http.get(
        '/api/v1/activity/calls',
        () => HttpResponse.json({ error: 'invalid_request' }, { status: 400 }),
        { once: true },
      ),
    );
    button('Show more').click();
    await until(() => expect(text()).toContain('The list is out of date.'));
    expect(text()).not.toContain('Invalid input');
    button('Load from the start').click();
    await until(() => expect(text()).not.toContain('The list is out of date.'));
    await until(() => expect(text()).toContain('Show more'));
    expect(cursors).toEqual(['c50', null]);
  });

  it('shows hidden characters in the tool name and the filter as markers', async () => {
    server.use(
      http.get('/api/v1/activity/calls', () =>
        HttpResponse.json([
          call({
            tool: `jira__get${String.fromCodePoint(0x202e)}issue`,
            filter: 'systems=a\u200bb',
          }),
        ]),
      ),
    );
    configureTestApp();
    await openRoute('/logs');
    await until(() => expect(text()).toContain('jira__get[U+202E]issue'));
    expect(text()).toContain('systems=a[U+200B]b');
  });

  it('has a filter column: the normalized filter of the address, or "bez filtra"', async () => {
    configureTestApp();
    await openRoute('/logs');
    await until(() => expect(text()).toContain('Waiting for confirmation'));

    const header = Array.from(document.querySelectorAll('thead th')).map((cell) =>
      cell.textContent?.trim(),
    );
    expect(header).toContain('Filter');
    const cells = Array.from(document.querySelectorAll('td.filter')).map((cell) =>
      text(cell).trim(),
    );
    expect(cells).toContain('systems=confluence,jira');
    expect(cells).toContain('systems=opensearch&access=write');
    expect(cells).toContain('no filter');
  });

  it('explains a call cut by the filter of the address and treats the old value as unknown', async () => {
    configureTestApp();
    await openRoute('/logs');
    await until(() => expect(text()).toContain('Refused (outside the address filter)'));
    expect(resultInfo('denied_filter_scope').explanation).toContain(
      'A filter in the address only narrows',
    );
    expect(resultInfo('denied_link_scope').label).toBe('Other result');
  });
});
