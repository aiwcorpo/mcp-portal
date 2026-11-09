import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, startEnrollment, test } from './fixtures';

async function expectNoViolations(page: Page): Promise<void> {
  // Material fades messages in; axe would measure contrast mid-transition.
  // Only finite animations are awaited (a looping one never finishes); one cancelled meanwhile rejects `finished`.
  // The wait is capped: an animation that is paused never finishes either.
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      ),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]),
  );

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.nodes.map((n) => `${String(n.target)} ${n.any.map((c) => c.message).join(' ')}`).join(', ')}`,
    ),
  ).toEqual([]);
}

/** The portal is dark by default (mockups); both themes are buttons in the header. */
// The switch names the theme it switches to; the portal starts dark.
async function useScheme(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  if (scheme === 'light') {
    await page.getByRole('button', { name: 'Light mode', exact: true }).click();
  }
}

const PAGES = [
  { path: '/catalog', ready: 'MCP servers' },
  { path: '/connect/jira', ready: 'Connect Jira' },
  { path: '/connections', ready: 'System connections' },
  { path: '/authenticator/register', ready: 'Register Authenticator' },
  { path: '/logs', ready: 'Audit logs' },
  { path: '/requests', ready: 'Requests' },
  { path: '/admin?mockAdmin=in', ready: 'Administration' },
  { path: '/admin?mockAdmin=in&mockAdapter=in&mockBatch=in', ready: 'Administration' },
  { path: '/admin/kill-switches?mockAdmin=in', ready: 'Emergency switches' },
  { path: '/admin/servers?mockAdmin=in', ready: 'Servers' },
  { path: '/admin/systems?mockAdmin=in', ready: 'Systems' },
  { path: '/admin/scope-mapping?mockAdmin=in', ready: 'Scope mapping' },
  { path: '/admin/overrides?mockAdmin=in', ready: 'Overrides' },
  { path: '/endpoint', ready: 'MCP address' },
];

for (const scheme of ['dark', 'light'] as const) {
  for (const { path, ready } of PAGES) {
    test(`${path} has no WCAG 2.1 AA violations (${scheme})`, async ({ page }) => {
      await page.goto(path);
      await useScheme(page, scheme);
      await expect(page.getByRole('heading', { level: 1, name: ready })).toBeVisible();
      const closed = page.getByRole('button', { name: /^Show tools/ });
      for (let left = await closed.count(); left > 0; left = await closed.count()) {
        await closed.first().click();
        await expect(closed).toHaveCount(left - 1);
      }
      await expectNoViolations(page);
    });
  }

  test(`the classification dialog, the kill switch with entries and the error state have no violations (${scheme})`, async ({
    page,
  }) => {
    await page.goto('/admin?mockAdmin=in&mockAdapter=in');
    await useScheme(page, scheme);
    await page.getByRole('button', { name: 'Show differences (jira__edit_comment)' }).click();
    await expect(page.getByText('Source: foreign server adapter.')).toBeVisible();
    await expectNoViolations(page);
    await page
      .getByRole('button', { name: 'Classify and approve (jira__edit_comment)' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Tool classification' });
    await dialog.getByLabel('Read READ_ONLY').check();
    await expect(dialog.getByLabel('read: reads data')).toBeVisible();
    await expectNoViolations(page);
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await page.goto('/admin/kill-switches');
    await page.getByLabel('Server', { exact: true }).selectOption('mcp-jira');
    await page.getByLabel('Tool', { exact: true }).selectOption('update_issue');
    await page.getByLabel('Reason', { exact: true }).fill('Writes break the workflow');
    await page.getByRole('button', { name: 'Switch off', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Switch off now?' })
      .getByRole('button', { name: 'Switch off' })
      .click();
    await expect(page.getByText('Switched off: Jira: update_issue.')).toBeVisible();
    await expectNoViolations(page);

    await page.goto('/connect/jira?mockBasic=in');
    await expect(page.getByLabel('Login in the system (for example the account email address)')).toBeVisible();
    await expectNoViolations(page);

    await page.goto('/connections?mockSecretMissing=in');
    await expect(page.getByText('stopped working, reconnect the account')).toBeVisible();
    await expectNoViolations(page);
  });

  test(`the registration steps and every Authenticator state have no violations (${scheme})`, async ({
    page,
  }) => {
    await page.goto('/authenticator/register');
    await useScheme(page, scheme);
    await startEnrollment(page);
    await expect(page.getByTestId('enrollment-key')).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Code from the app (6 digits)').fill('000000');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Invalid code.')).toBeVisible();
    await expectNoViolations(page);
    for (const state of ['none', 'active', 'locked', 'disabled']) {
      await page.goto(`/connections?mockAuthenticator=${state}`);
      await expect(page.getByRole('heading', { name: 'Authenticator' })).toBeVisible();
      await expectNoViolations(page);
    }
    await page.goto('/catalog?mockAuthenticator=none');
    await page.getByRole('button', { name: /^Show tools \(Jira\)/ }).click();
    await expect(page.getByText('You have no Authenticator').first()).toBeVisible();
    await expectNoViolations(page);
  });

  test(`the request dialog and the definition diff have no violations (${scheme})`, async ({
    page,
  }) => {
    await page.goto('/requests');
    await useScheme(page, scheme);
    await page.getByRole('button', { name: 'Submit request' }).click();
    const dialog = page.getByRole('dialog', { name: 'Submit request' });
    await dialog.getByLabel('System').selectOption('jira');
    await dialog.getByLabel('Entitlement').selectOption('mcp-jira-destructive');
    await expect(dialog.getByText('Description from the entitlement system')).toBeVisible();
    await expectNoViolations(page);
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await page.goto('/admin?mockAdmin=in');
    await page.getByRole('button', { name: 'Show differences (jira__update_issue)' }).click();
    await page.getByRole('button', { name: 'Show differences (confluence__update_page)' }).click();
    await expect(page.getByText('Source: server.')).toBeVisible();
    await expectNoViolations(page);
  });

  test(`the preview in every state has no violations (${scheme})`, async ({ page }) => {
    await page.goto('/confirm/cnf_4k9Qe2LxW7tB3mZp');
    await useScheme(page, scheme);
    await expect(page.getByRole('button', { name: 'Cancel operation' })).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole('button', { name: 'Cancel operation' }).click();
    await expect(page.getByText('Operation cancelled.')).toBeVisible();
    await expectNoViolations(page);
    await page.goto('/confirm/cnf_Zb3Qm8TnR5vKd2Wy');
    await expect(page.getByText('Values contain control characters')).toBeVisible();
    await expectNoViolations(page);
    await page.goto('/confirm/cnf_missing');
    await expect(page.getByText('This link is out of date.')).toBeVisible();
    await expectNoViolations(page);
  });

  test(`the log with details and filters has no violations (${scheme})`, async ({ page }) => {
    await page.goto('/logs');
    await useScheme(page, scheme);
    await expect(page.getByText('Waiting for confirmation')).toBeVisible();
    await page.getByRole('button', { name: 'Show details: jira__delete_issue' }).first().click();
    await expectNoViolations(page);
    await page.getByLabel('Result').selectOption({ label: 'Errors' });
    await expect(page.getByRole('cell', { name: 'Error' }).first()).toBeVisible();
    await expectNoViolations(page);
    await page.getByPlaceholder('Search logs').fill('nothing-called-this');
    await expect(page.getByText('No call matches the filters.')).toBeVisible();
    await expectNoViolations(page);
  });

  test(`the address page with a filter and the size warning have no violations (${scheme})`, async ({
    page,
  }) => {
    await page.goto('/endpoint');
    await useScheme(page, scheme);
    await expect(page.getByLabel('MCP address', { exact: true })).toBeVisible();
    await expectNoViolations(page);

    await page.getByRole('checkbox', { name: /^Jira/ }).check();
    await page.getByLabel('Read-only').check();
    await page.getByRole('checkbox', { name: /jira__get_issue/ }).check();
    await expect(page.getByLabel('MCP address', { exact: true })).toHaveValue(/systems=jira/);
    await expectNoViolations(page);
  });

  test(`states without data have no violations (${scheme})`, async ({ page }) => {
    await page.goto('/catalog?mockScenario=errors');
    await useScheme(page, scheme);
    await expect(page.getByRole('alert')).toContainText('Could not load the data.');
    await expectNoViolations(page);

    await page.goto('/catalog?mockScenario=empty');
    await expect(page.getByText('You do not have access to any MCP server yet')).toBeVisible();
    await expectNoViolations(page);

    await page.goto('/no-such-page');
    await expect(page.getByText('Page not found.')).toBeVisible();
    await expectNoViolations(page);

    await page.goto('/?mockSession=out&loginError=idp_error');
    await expect(page.getByText('The sign-in service is not responding.')).toBeVisible();
    await expectNoViolations(page);
  });

  test(`form errors, return banners and dialogs have no violations (${scheme})`, async ({
    page,
  }) => {
    await page.goto('/connect/jira');
    await useScheme(page, scheme);
    await page.getByRole('button', { name: 'Check and save' }).click();
    await expect(page.getByText('Paste the token.')).toBeVisible();
    await expectNoViolations(page);

    await page.getByLabel('PAT token', { exact: true }).fill('invalid-a11y');
    await page.getByRole('button', { name: 'Check and save' }).click();
    await expect(page.getByText('Token is invalid or expired.')).toBeVisible();
    await expectNoViolations(page);

    await page.goto('/catalog?mockOAuth=provider_error');
    await page.getByRole('button', { name: 'Connect (Gitlab)' }).click();
    await expect(page.getByRole('alert')).toContainText('Gitlab did not respond correctly');
    await expectNoViolations(page);

    await page.goto('/connections');
    await page.getByRole('button', { name: 'Disconnect (Jira)' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoViolations(page);
  });
}

test('keyboard only: skip link, tabs, row toggle and an action', async ({ page }) => {
  await page.goto('/catalog');
  await expect(page.getByRole('rowheader', { name: 'Gitlab' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();

  const toggle = page.getByRole('button', { name: 'Show tools (Jira)' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Hide tools (Jira)' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByText('jira__search_issues')).toBeVisible();

  const renew = page.getByRole('button', { name: 'Renew (Jira)' });
  await renew.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/connect\/jira$/);
});

test('keyboard only: the filter can be chosen and the address copied', async ({ page }) => {
  await page.goto('/endpoint');
  await expect(page.getByLabel('MCP address', { exact: true })).toHaveValue(
    'https://mcp.aiwcorpo.pl/mcp',
  );
  await page.getByRole('checkbox', { name: /^Jira/ }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('MCP address', { exact: true })).toHaveValue(
    'https://mcp.aiwcorpo.pl/mcp?systems=jira',
  );
  await page.getByLabel('Read-only').focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('Filter in the address: 24 of 512 bytes')).toBeVisible();
  await page.getByRole('button', { name: 'Copy MCP address' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Copied: MCP address.')).toBeVisible();
});

test('no horizontal scroll at 360 px and no cut-off tab names', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const { path, ready } of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: ready })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);

    const cutOff = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('nav a')).filter((a) => {
          const box = a.getBoundingClientRect();
          return box.right > window.innerWidth || a.scrollWidth > a.clientWidth + 1;
        }).length,
    );
    expect(cutOff, `${path}: tab names`).toBe(0);
  }
});

test('320 px: no WCAG 2.1 AA violations and no horizontal scroll', async ({ page }) => {
  // One test walks every page of the list, and the list now has the administration screens too.
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 320, height: 640 });
  for (const { path, ready } of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: ready })).toBeVisible();
    await expectNoViolations(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test('focus moves to the main content after an in-app navigation', async ({ page }) => {
  await page.goto('/catalog');
  await expect(page.getByRole('rowheader', { name: 'Gitlab' })).toBeVisible();
  await page.getByRole('link', { name: 'System connections' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'System connections' }),
  ).toBeVisible();
  await expect(page.locator('#main')).toBeFocused();
});

test('focus moves to the main content even when the click comes before the first page has loaded', async ({
  page,
}) => {
  await page.goto('/catalog');
  await page.getByRole('link', { name: 'System connections' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'System connections' }),
  ).toBeVisible();
  await expect(page.locator('#main')).toBeFocused();
});
