import { test as base, expect, type Page } from '@playwright/test';

/**
 * Every test fails on a CSP violation or an uncaught page error, so the suite also proves that the
 * optimised build runs under the policy from scripts/serve-csp.mjs (no 'unsafe-inline').
 */
export const test = base.extend<{ pageProblems: string[] }>({
  pageProblems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        if (
          message.type() === 'error' &&
          /Content Security Policy|Refused to/i.test(message.text())
        ) {
          problems.push(message.text());
        }
      });
      page.on('pageerror', (error) => problems.push(error.message));
      await use(problems);
      expect(problems, 'CSP violations or page errors').toEqual([]);
    },
    { auto: true },
  ],
});

/**
 * Step 1 of the Authenticator registration: "Next" sends the browser through the (mock) IdP for a fresh
 * MFA and back, where the registration starts by itself (U12).
 */
export async function startEnrollment(
  page: Page,
  next = 'Next',
  heading = 'Add the account in the app',
): Promise<void> {
  await page.getByRole('button', { name: next }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

export { expect };
