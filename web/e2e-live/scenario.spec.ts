import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env['LIVE_SHOTS_DIR'];
const PASSWORD = process.env['LIVE_ALICE_PASSWORD'];
const BASE = process.env['LIVE_BASE_URL'] ?? 'http://localhost:18740';

test.skip(!PASSWORD, 'set LIVE_ALICE_PASSWORD (make users in mcp-platform-dev)');

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  const original = page.viewportSize();
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 740 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: true });
  }
  if (original) await page.setViewportSize(original);
}

test('alice: login, catalog, PAT, OAuth, address page with a filter, cleanup, logout', async ({
  page,
  context,
}) => {
  const problems: string[] = [];
  // The login screen probes /api/v1/me without a session; the 401 is the expected answer.
  const isAnonymousProbe = (url: string): boolean => url.endsWith('/api/v1/me');
  page.on('console', (message) => {
    if (message.location().url && isAnonymousProbe(message.location().url)) return;
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  const requestIds: string[] = [];
  page.on('response', (response) => {
    if (
      response.url().includes('/api/') &&
      response.status() >= 400 &&
      !(response.status() === 401 && isAnonymousProbe(response.url()))
    ) {
      problems.push(
        `HTTP ${response.status()} ${response.url()} X-Request-Id=${response.headers()['x-request-id']}`,
      );
    }
    const id = response.headers()['x-request-id'];
    if (id && response.url().includes('/api/')) requestIds.push(id);
  });

  await test.step('login through Keycloak', async () => {
    await page.goto('/');
    await shot(page, '01-login');
    await page.getByRole('button', { name: 'Sign in with your company account' }).click();
    await page.fill('#username', 'alice');
    await page.fill('#password', PASSWORD!);
    await page.locator('#kc-login').click();
    await expect(page.getByRole('heading', { level: 1, name: 'MCP servers' })).toBeVisible();
  });

  await test.step('remove leftovers of an interrupted run', async () => {
    await page.goto('/connections');
    await expect(page.getByRole('rowheader', { name: 'GitLab' })).toBeVisible();
    const gitlab = page.getByRole('button', { name: 'Disconnect (GitLab)' });
    if (await gitlab.isVisible()) {
      await gitlab.click();
      await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
      await expect(page.getByText('Disconnected account GitLab.')).toBeVisible();
    }
  });

  await test.step('catalog lists 5 systems with statuses', async () => {
    await page.goto('/catalog');
    const bodies = page.locator('tbody');
    await expect(bodies).toHaveCount(5);
    for (const name of ['OpenSearch', 'GitLab', 'Confluence', 'Service Desk', 'Jira']) {
      await expect(page.getByRole('rowheader', { name })).toBeVisible();
    }
    await expect(page.getByText('Not connected').first()).toBeVisible();
    await shot(page, '02-catalog');
  });

  await test.step('save the Jira PAT and see the backend user', async () => {
    // A connected system offers only "Disconnect"; saving a PAT again needs the disconnect first.
    await page.goto('/connections');
    await expect(page.getByRole('rowheader', { name: 'Jira' })).toBeVisible();
    const disconnectJira = page.getByRole('button', { name: 'Disconnect (Jira)' });
    if (await disconnectJira.isVisible()) {
      await disconnectJira.click();
      await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
      await expect(page.getByText('Disconnected account Jira.')).toBeVisible();
    }
    await page.goto('/connect/jira');
    await expect(page.getByRole('heading', { level: 1, name: 'Connect Jira' })).toBeVisible();
    await page.getByLabel('PAT token', { exact: true }).fill('alice-pat');
    await shot(page, '03-pat-form');
    await page.getByRole('button', { name: 'Check and save' }).click();
    await expect(page.getByText(/Connected to Jira as \S+\./)).toBeVisible();
    await shot(page, '04-pat-saved');
    const storage = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(storage).not.toContain('alice-pat');
    expect(await page.content()).not.toContain('alice-pat');
  });

  await test.step('GitLab OAuth: denial, then success as alice', async () => {
    await page.goto('/catalog');
    await page.getByRole('button', { name: 'Connect with OAuth (GitLab)' }).click();
    await page.waitForURL(/:18741\/oauth\/authorize/);
    await page.getByRole('link', { name: 'Deny' }).click();
    await expect(page.getByRole('alert')).toContainText('Connecting to GitLab cancelled.');
    await shot(page, '05-oauth-cancelled');

    await page.getByRole('button', { name: 'Connect with OAuth (GitLab)' }).click();
    await page.waitForURL(/:18741\/oauth\/authorize/);
    await page.getByRole('link', { name: 'Authorize as alice' }).click();
    await expect(page.getByText(/Connected to GitLab as \S+\./)).toBeVisible();
    await shot(page, '06-oauth-connected');
  });

  await test.step('address page: the whole platform, then a filter', async () => {
    await page.goto('/endpoint');
    await expect(page.getByRole('heading', { level: 1, name: 'MCP address' })).toBeVisible();
    const address = page.getByLabel('MCP address', { exact: true });
    await expect(address).toHaveValue(`${BASE}/mcp`);
    await shot(page, '07-endpoint-whole-platform');

    await page.getByRole('checkbox', { name: /^Jira/ }).check();
    await page.getByLabel('Read-only').check();
    await expect(address).toHaveValue(`${BASE}/mcp?systems=jira&access=read`);
    await shot(page, '08-endpoint-filter');

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy (Claude Code)' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `claude mcp add --transport http aiwcorpo-mcp "${BASE}/mcp?systems=jira&access=read"`,
    );
    await shot(page, '09-endpoint-copied');

    await page.goto('/links');
    await expect(page).toHaveURL(/\/endpoint$/);
  });

  await test.step('browser hygiene: cookies and storage', async () => {
    // Keycloak shares the host "localhost" (cookies ignore ports); the portal's own are path "/".
    const cookies = await context.cookies('http://localhost:18740');
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies.filter((c) => c.path === '/')) {
      expect(cookie.name, JSON.stringify(cookie)).toMatch(/^__Host-/);
    }
    const stored = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      all: JSON.stringify({ ...localStorage, ...sessionStorage }),
    }));
    expect(stored.all).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(stored.all).not.toMatch(/access_token|refresh_token|id_token/i);
  });

  await test.step('cleanup: disconnect GitLab', async () => {
    await page.goto('/connections');
    await page.getByRole('button', { name: 'Disconnect (GitLab)' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByText('Disconnectono konto GitLab.')).toBeVisible();
  });

  await test.step('logout', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in with your company account' })).toBeVisible();
    await shot(page, '11-logged-out');
  });

  expect(requestIds.length).toBeGreaterThan(0);
  expect(problems, 'console errors, CSP violations, failed API calls').toEqual([]);
});
