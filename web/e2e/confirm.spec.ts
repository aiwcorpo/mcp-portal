import { BIDI_CONFIRMATION_ID, DEMO_CONFIRMATION_ID } from '../src/mocks/m3-mock';
import { expect, test } from './fixtures';

const PREVIEW = `/confirm/${DEMO_CONFIRMATION_ID}`;

test('the preview is read only, has no tabs and records the view with an explicit POST', async ({
  page,
}) => {
  const viewed = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().endsWith(`${PREVIEW}/viewed`.replace('/confirm', '/api/v1/confirmations')),
  );
  await page.goto(PREVIEW);
  await expect(
    page.getByRole('heading', { level: 1, name: 'An irreversible operation is waiting for a code' }),
  ).toBeVisible();
  await viewed;

  await expect(page.getByText('Confluence DEV / 48213')).toBeVisible();
  await expect(page.getByText('confluence__delete_page')).toBeVisible();
  const names = await page.locator('.facts dt code').allInnerTexts();
  expect(names).toEqual(['pageId', 'spaceKey', 'title', 'versionComment']);
  await expect(page.getByText('(truncated)')).toBeVisible();
  await expect(page.getByText('enter the code from the MCP Platform app in the agent session')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
});

test('a GET alone never marks the preview as viewed', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') {
      posts.push(request.url());
    }
  });
  await page.addInitScript(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  });
  await page.goto(PREVIEW);
  await expect(page.getByRole('button', { name: 'Cancel operation' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(posts.filter((url) => url.endsWith('/viewed'))).toEqual([]);
});

test('another operation replacing this one turns the page into "out of date"', async ({ page }) => {
  await page.goto(PREVIEW);
  await expect(page.getByRole('button', { name: 'Cancel operation' })).toBeVisible();
  await page.evaluate(() =>
    (
      window as never as { __portalMock: { supersedeConfirmation(): void } }
    ).__portalMock.supersedeConfirmation(),
  );
  await expect(page.getByText('This link is out of date.')).toBeVisible({ timeout: 12_000 });
  await expect(page.getByRole('button', { name: 'Cancel operation' })).toHaveCount(0);
});

test('an unknown link says "out of date"', async ({ page }) => {
  await page.goto('/confirm/cnf_does_not_exist');
  await expect(page.getByText('This link is out of date.')).toBeVisible();
});

test('the countdown follows the clock', async ({ page }) => {
  await page.clock.install();
  await page.goto(PREVIEW);
  await expect(page.getByText(/expires in 0[12]:\d{2}/)).toBeVisible();
  await page.clock.fastForward('01:00');
  await expect(page.getByText(/expires in 01:0\d/)).toBeVisible();
});

test('cancel the operation from the preview', async ({ page }) => {
  await page.goto(PREVIEW);
  await page.getByRole('button', { name: 'Cancel operation' }).click();
  await expect(page.getByText('Operation cancelled.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('This link is out of date.')).toBeVisible();
});

test('a right-to-left override in an argument is shown as a marker and keeps the logical order', async ({
  page,
}) => {
  await page.goto(`/confirm/${BIDI_CONFIRMATION_ID}`);
  const value = page.getByTestId('argument-value').nth(1);
  await expect(value).toContainText('cleanup[U+202E]gnp.exe[U+2066] first line');
  await expect(value).toContainText('second line[U+0007]');
  const characters = await value.evaluate((node) => ({
    text: node.textContent ?? '',
    direction: getComputedStyle(node).direction,
    bidi: getComputedStyle(node).unicodeBidi,
    whiteSpace: getComputedStyle(node).whiteSpace,
  }));
  for (const code of [0x202e, 0x2066, 0x07]) {
    expect(characters.text).not.toContain(String.fromCodePoint(code));
  }

  expect(characters.direction).toBe('ltr');
  // Drawn order, not logical order: the left edges of the characters must grow along the string, which an
  // unneutralised U+202E would break (the text after it would be drawn right to left).
  const lefts = await value.evaluate((node) => {
    const text = node.firstChild as Text;
    const first = (text.data.match(/^[^\n]*/) ?? [''])[0];
    return Array.from(first).map((_, index) => {
      const range = document.createRange();
      range.setStart(text, index);
      range.setEnd(text, index + 1);
      const box = range.getBoundingClientRect();
      return { left: box.left, top: Math.round(box.top) };
    });
  });
  expect(lefts.length).toBeGreaterThan(20);
  for (let index = 1; index < lefts.length; index += 1) {
    const previous = lefts[index - 1];
    const current = lefts[index];
    // A wrapped line starts lower and further left; on the same line the next character is further right.
    expect(current.top > previous.top || current.left > previous.left, `character ${index}`).toBe(
      true,
    );
  }
  expect(characters.bidi).toBe('isolate');
  expect(characters.whiteSpace).toBe('pre-wrap');
  await expect(page.getByText('Values contain control characters.')).toBeVisible();

  const lines = await value.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size;
  });
  expect(lines).toBeGreaterThanOrEqual(2);
});
