import { test as base, expect } from '@playwright/test';

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

export { expect };
