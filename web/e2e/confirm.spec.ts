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
    page.getByRole('heading', { level: 1, name: 'Operacja nieodwracalna czeka na kod' }),
  ).toBeVisible();
  await viewed;

  await expect(page.getByText('Confluence DEV / 48213')).toBeVisible();
  await expect(page.getByText('confluence__delete_page')).toBeVisible();
  const names = await page.locator('.facts dt code').allInnerTexts();
  expect(names).toEqual(['pageId', 'spaceKey', 'title', 'versionComment']);
  await expect(page.getByText('(obcięto)')).toBeVisible();
  await expect(page.getByText('wpisz w sesji agenta kod z aplikacji MCP Platform')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zatwierdź' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Odrzuć' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Nawigacja główna' })).toHaveCount(0);
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
  await expect(page.getByRole('button', { name: 'Anuluj operację' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(posts.filter((url) => url.endsWith('/viewed'))).toEqual([]);
});

test('another operation replacing this one turns the page into "nieaktualny"', async ({ page }) => {
  await page.goto(PREVIEW);
  await expect(page.getByRole('button', { name: 'Anuluj operację' })).toBeVisible();
  await page.evaluate(() =>
    (
      window as never as { __portalMock: { supersedeConfirmation(): void } }
    ).__portalMock.supersedeConfirmation(),
  );
  await expect(page.getByText('Ten link jest nieaktualny.')).toBeVisible({ timeout: 12_000 });
  await expect(page.getByRole('button', { name: 'Anuluj operację' })).toHaveCount(0);
});

test('an unknown link says "nieaktualny"', async ({ page }) => {
  await page.goto('/confirm/cnf_does_not_exist');
  await expect(page.getByText('Ten link jest nieaktualny.')).toBeVisible();
});

test('the countdown follows the clock', async ({ page }) => {
  await page.clock.install();
  await page.goto(PREVIEW);
  await expect(page.getByText(/wygasa za 0[12]:\d{2}/)).toBeVisible();
  await page.clock.fastForward('01:00');
  await expect(page.getByText(/wygasa za 01:0\d/)).toBeVisible();
});

test('cancel the operation from the preview', async ({ page }) => {
  await page.goto(PREVIEW);
  await page.getByRole('button', { name: 'Anuluj operację' }).click();
  await expect(page.getByText('Operacja anulowana.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Ten link jest nieaktualny.')).toBeVisible();
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
  expect(characters.text.indexOf('cleanup')).toBeLessThan(characters.text.indexOf('gnp.exe'));
  expect(characters.direction).toBe('ltr');
  expect(characters.bidi).toBe('isolate');
  expect(characters.whiteSpace).toBe('pre-wrap');
  await expect(page.getByText('Wartości zawierają znaki sterujące.')).toBeVisible();

  const lines = await value.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size;
  });
  expect(lines).toBeGreaterThanOrEqual(2);
});
