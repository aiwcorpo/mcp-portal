import { expect, test } from './fixtures';

test('log out and log in again through the BFF endpoints', async ({ page }) => {
  await page.goto('/connections');
  await expect(page.getByText('Jan Kowalski')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('Signed out.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  // logout() shows the login screen first and navigates to "/" (redirected to the catalog) afterwards. A click
  // in between would send the user back to the page they left, so wait for the navigation to settle.
  await expect(page).toHaveURL(/\/catalog$/);

  await page.getByRole('button', { name: 'Sign in with your company account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'MCP servers' })).toBeVisible();
});

const LOGIN_ERRORS = {
  cancelled: 'Sign-in cancelled.',
  idp_error: 'The sign-in service is not responding. Try again in a moment.',
  session_expired: 'Session expired. Sign in again.',
  step_up_failed: 'Could not verify your identity. Try registering again.',
};

for (const [code, message] of Object.entries(LOGIN_ERRORS)) {
  test(`login error ${code} is shown on the login screen`, async ({ page }) => {
    await page.goto(`/?mockSession=out&loginError=${code}`);
    await expect(page.getByRole('button', { name: 'Sign in with your company account' })).toBeVisible();
    await expect(page.getByText(message)).toBeVisible();
  });
}

test('an unknown loginError value shows nothing', async ({ page }) => {
  await page.goto('/?mockSession=out&loginError=%3Cb%3Eboom%3C%2Fb%3E');
  await expect(page.getByRole('button', { name: 'Sign in with your company account' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('connect Gitlab through the provider: the result names the system and the account', async ({
  page,
}) => {
  await page.goto('/catalog');
  await page.getByRole('button', { name: 'Connect (Gitlab)' }).click();

  await expect(page.getByText('Connected to Gitlab as jkowalski.')).toBeVisible();
  await expect(page).toHaveURL(/\/catalog$/);
  const row = page.locator('tbody', { has: page.getByRole('rowheader', { name: 'Gitlab' }) });
  await expect(row).toContainText('Connected');
});

const OAUTH_FAILURES = {
  cancelled: 'Connecting to Gitlab cancelled.',
  flow_invalid: 'The connection link expired or was already used. Start again.',
  provider_error: 'Gitlab did not respond correctly. Try again in a moment.',
};

for (const [outcome, message] of Object.entries(OAUTH_FAILURES)) {
  test(`return from the provider with ${outcome}`, async ({ page }) => {
    await page.goto(`/catalog?mockOAuth=${outcome}`);
    await page.getByRole('button', { name: 'Connect (Gitlab)' }).click();

    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page).toHaveURL(/\/catalog$/);
    await page.getByRole('button', { name: 'Close message' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('empty and error scenarios, with the request id next to the error', async ({ page }) => {
  await page.goto('/catalog?mockScenario=empty');
  await expect(page.getByText('You do not have access to any MCP server yet')).toBeVisible();

  await page.goto('/connections?mockScenario=errors');
  await expect(page.getByRole('alert')).toContainText('Could not load the data.');
  await expect(page.getByRole('alert')).toContainText('The service is temporarily unavailable.');
  await expect(page.getByRole('alert')).toContainText('0192d1b2');
  await expect(page.getByRole('alert')).not.toContainText('0192d1b2-7c3a');
});

test('unknown address shows the 404 state', async ({ page }) => {
  await page.goto('/nie-ma-takiej-strony');
  await expect(page.getByText('Page not found.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to servers' }).click();
  await expect(page).toHaveURL(/\/catalog$/);
});

test('dialog and notification work under the CSP: copy link and disconnect', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/catalog');
  await page.getByRole('button', { name: 'Copy link (Servicedesk)' }).click();
  await expect(page.getByText('Copied the address of the Servicedesk server.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'https://mcp.aiwcorpo.pl/s/mcp-servicedesk/mcp',
  );

  await page.getByRole('link', { name: 'System connections' }).click();
  await page.getByRole('button', { name: 'Disconnect (Jira)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Disconnect account Jira?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByText('Disconnected account Jira.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Jira/ })).toContainText('Add token');
});

test('the catalog filter finds a tool and opens its server', async ({ page }) => {
  await page.goto('/catalog');
  await page.getByRole('searchbox', { name: 'Search for a server or tool' }).fill('delete_issue');
  await expect(page.getByText('jira__delete_issue')).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'Gitlab' })).toHaveCount(0);
  await expect(page.getByText('You have no Authenticator')).toBeVisible();
});
