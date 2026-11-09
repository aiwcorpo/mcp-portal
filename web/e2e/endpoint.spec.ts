import { expect, test } from './fixtures';

const BASE = 'https://mcp.aiwcorpo.pl/mcp';

test('the whole platform has one address, with the Claude Code, Copilot and Codex configuration', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/endpoint');
  await expect(page.getByRole('heading', { level: 1, name: 'MCP address' })).toBeVisible();
  await expect(page.getByLabel('MCP address', { exact: true })).toHaveValue(BASE);
  await expect(page.getByText('The configuration contains no token or password.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'My links' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Copy MCP address' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(BASE);

  await page.getByRole('button', { name: 'Copy (Claude Code)' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `claude mcp add --transport http aiwcorpo-mcp "${BASE}"`,
  );

  await page.getByRole('tab', { name: 'Copilot' }).click();
  await page.getByRole('button', { name: 'Copy (Copilot)' }).click();
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual({
    servers: { 'aiwcorpo-mcp': { type: 'http', url: BASE } },
  });

  await page.getByRole('tab', { name: 'Codex' }).click();
  await page.getByRole('button', { name: 'Copy (Codex)' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `[mcp_servers.aiwcorpo-mcp]\nurl = "${BASE}"\n`,
  );
});

test('systems, read-only and exclusions give a canonical address without saving anything', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/api/')) {
      writes.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.goto('/endpoint');
  const address = page.getByLabel('MCP address', { exact: true });
  await expect(address).toHaveValue(BASE);

  await page.getByRole('checkbox', { name: /^Jira/ }).check();
  await page.getByLabel('Read-only').check();
  await expect(address).toHaveValue(`${BASE}?systems=jira&access=read`);
  await expect(page.getByText('Filter in the address: 24 of 512 bytes')).toBeVisible();

  await page.getByLabel('All except selected').check();
  await page.getByLabel('Read and changes').check();
  await page.getByRole('checkbox', { name: /jira__delete_issue/ }).check();
  await expect(address).toHaveValue(`${BASE}?systems=jira&exclude=jira__delete_issue`);

  await page.getByRole('button', { name: 'Copy (Claude Code)' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `claude mcp add --transport http aiwcorpo-mcp "${BASE}?systems=jira&exclude=jira__delete_issue"`,
  );

  await page.getByRole('button', { name: 'No filter' }).click();
  await expect(address).toHaveValue(BASE);
  expect(writes).toEqual([]);
});

test('the warning about prompt injection is on the page, next to the address', async ({ page }) => {
  await page.goto('/endpoint');
  await expect(page.getByLabel('MCP address', { exact: true })).toHaveValue(BASE);
  await expect(page.getByText('One session reaches all selected systems')).toBeVisible();
});

test('the list of tools in the address stops at 512 bytes, with a hint instead of a request', async ({
  page,
}) => {
  await page.goto('/endpoint?mockScenario=wide');
  const address = page.getByLabel('MCP address', { exact: true });
  await expect(address).toHaveValue(BASE);
  await expect(page.getByTestId('size-warning')).toContainText('About 53 tools');

  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/me/mcp-endpoint')) {
      requests.push(request.url());
    }
  });
  for (let index = 0; index < 16; index += 1) {
    await page
      .getByRole('checkbox', {
        name: new RegExp(`jira__report_number_${String(index).padStart(2, '0')}_for_quarter`),
      })
      .check();
  }
  await expect(page.getByTestId('query-problem')).toContainText('bytes');
  await expect(page.getByText('The address will appear once the selection fits within the limit.')).toBeVisible();
  await page.waitForTimeout(500);
  const settled = requests.length;
  await page.waitForTimeout(500);
  expect(requests.length).toBe(settled);
  for (const url of requests) {
    expect(new URL(url).searchParams.get('tools')?.length ?? 0).toBeLessThanOrEqual(506);
  }

  await page.getByLabel('All except selected').check();
  await expect(address).toHaveValue(BASE);
  await expect(page.getByTestId('query-problem')).toHaveCount(0);

  await page.getByLabel('Read-only').check();
  await page.getByRole('checkbox', { name: /^Jira/ }).check();
  await expect(address).toHaveValue(`${BASE}?systems=jira&access=read`);
  await expect(page.getByTestId('size-warning')).toHaveCount(0);
});

test('the old links page leads to the address page', async ({ page }) => {
  await page.goto('/links');
  await expect(page).toHaveURL(/\/endpoint$/);
  await expect(page.getByRole('heading', { level: 1, name: 'MCP address' })).toBeVisible();
});
