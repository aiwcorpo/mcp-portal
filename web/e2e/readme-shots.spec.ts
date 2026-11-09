import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { JIRA_CONFIRMATION_ID, MOCK_TOTP_SEED } from '../src/mocks/m3-mock';
import { expect, startEnrollment, test } from './fixtures';

/**
 * Screenshots for the README of the repository, taken from the mock build in English and in Polish: the data are the
 * examples of the contracts (a made-up user, made-up systems), no real account and no token appears. Off by default:
 * `npm run screenshots` writes them to ../docs/screenshots/en and ../docs/screenshots/pl, same file names in both.
 */
const DIRECTORY = process.env['README_SHOTS_DIR'];

type Lang = 'en' | 'pl';

function units(file: string, element: 'source' | 'target'): Map<string, string> {
  const result = new Map<string, string>();
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(
    /<unit id="([^"]+)">[\s\S]*?<source>([\s\S]*?)<\/source>(?:\s*<target>([\s\S]*?)<\/target>)?/g,
  )) {
    const value = element === 'source' ? match[2] : match[3];
    if (value !== undefined) {
      result.set(match[1], normalise(value));
    }
  }
  return result;
}

function normalise(xml: string): string {
  return xml
    .replace(/<ph [^>]*\/>/g, '{}')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const SOURCE = units('src/locale/messages.xlf', 'source');
const POLISH = units('src/locale/messages.pl.xlf', 'target');
const TRANSLATIONS = new Map<string, string>();
for (const [id, english] of SOURCE) {
  const polish = POLISH.get(id);
  if (polish !== undefined) {
    TRANSLATIONS.set(english, polish);
  }
}

/** The UI text in the language of the run: English is the source text, Polish is looked up in messages.pl.xlf. */
function textIn(lang: Lang, english: string): string {
  if (lang === 'en') {
    return english;
  }
  const direct = TRANSLATIONS.get(english);
  if (direct !== undefined) {
    return direct;
  }
  const parametrised = /^(.*?) \((.+)\)$/.exec(english);
  const template = parametrised ? TRANSLATIONS.get(`${parametrised[1]} ({})`) : undefined;
  if (parametrised && template !== undefined) {
    return template.replace('{}', parametrised[2]);
  }
  const suffixed = /^(.*?)([:(].*)$/.exec(english);
  const base = suffixed ? TRANSLATIONS.get(suffixed[1].trim()) : undefined;
  if (suffixed && base !== undefined) {
    return `${base}${english.includes('(') && suffixed[2].startsWith('(') ? ' ' : ''}${suffixed[2]}`;
  }
  throw new Error(`no Polish translation for "${english}"`);
}

for (const lang of ['en', 'pl'] as const) {
  test.describe(`README screenshots (${lang})`, () => {
    test.skip(!DIRECTORY, 'set README_SHOTS_DIR to take screenshots');
    test.skip(
      ({ viewport }) => (viewport?.width ?? 0) < 1000,
      'the README shows the desktop layout',
    );

    // Many pictures per test and a busy workstation: the default 30 s is too tight.
    test.setTimeout(120_000);

    const t = (english: string) => textIn(lang, english);

    async function shot(page: Page, name: string, fullPage = false): Promise<void> {
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
      await page.screenshot({ path: join(DIRECTORY ?? '.', lang, `${name}.png`), fullPage });
    }

    test.use({ viewport: { width: 1280, height: 800 }, locale: lang === 'pl' ? 'pl-PL' : 'en-US' });

    // The documentation asks for the light theme; the portal opens dark by default (core/theme.service.ts).
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('mcp-portal-theme', 'light'));
    });

    test('user screens', async ({ page }) => {
      await page.goto('/?mockSession=out');
      await expect(
        page.getByRole('button', { name: t('Sign in with your company account') }),
      ).toBeVisible();
      await shot(page, '01-sign-in');

      await page.goto('/catalog?mockSession=in');
      await expect(page.getByRole('rowheader', { name: 'Gitlab' })).toBeVisible();
      await page.getByRole('button', { name: `${t('Show tools')} (Jira)` }).click();
      await shot(page, '02-mcp-servers');

      await page.goto('/connections?mockAuthenticator=active');
      await expect(page.getByRole('heading', { name: 'Authenticator' })).toBeVisible();
      await shot(page, '03-system-connections');

      await page.goto('/connections?mockSecretMissing=in');
      await expect(page.getByText(t('stopped working, reconnect the account'))).toBeVisible();
      await shot(page, '04-connection-error');

      await page.goto('/connect/jira?mockBasic=in');
      await page
        .getByLabel(t('Login in the system (for example the account email address)'))
        .fill('anna.nowak@firma.pl');
      await expect(page.getByLabel(t('Password or API token'))).toBeVisible();
      await shot(page, '09-form-with-login');

      await page.goto('/endpoint');
      await page.getByRole('checkbox', { name: /^Jira/ }).check();
      await page.getByLabel(t('Read-only')).check();
      // "MCP address" has two Polish translations (title case and lower case), so match both.
      await expect(page.getByRole('textbox', { name: /^(MCP address|Adres MCP)$/ })).toHaveValue(
        /systems=jira/,
      );
      await shot(page, '05-mcp-address');
    });

    test('administration screens', async ({ page }) => {
      await page.goto('/admin?mockAdmin=in');
      await page
        .getByRole('button', { name: `${t('Show differences')} (confluence__update_page)` })
        .click();
      await expect(page.getByText(t('Before (1.3.0)'))).toBeVisible();
      await shot(page, '06-admin-differences');

      await page.goto('/admin?mockAdmin=in&mockAdapter=in');
      await page
        .getByRole('button', { name: `${t('Show differences')} (jira__edit_comment)` })
        .click();
      await page
        .getByRole('button', { name: `${t('Classify and approve')} (jira__edit_comment)` })
        .click();
      const dialog = page.getByRole('dialog', { name: t('Tool classification') });
      await dialog.getByLabel(/READ_ONLY/).check();
      await expect(dialog.getByLabel(/read:/)).toBeVisible();
      await shot(page, '07-tool-classification');
      await dialog.getByRole('button', { name: t('Cancel') }).click();

      await switchOffUpdateIssue(page);
      await shot(page, '08-emergency-switch');
    });

    async function switchOffUpdateIssue(page: Page): Promise<void> {
      await page.goto('/admin/kill-switches?mockAdmin=in');
      await page.getByLabel(t('Server'), { exact: true }).selectOption('mcp-jira');
      await page.getByLabel(t('Tool'), { exact: true }).selectOption('update_issue');
      await page
        .getByLabel(t('Reason'), { exact: true })
        .fill('Writes break the workflow after the Jira update');
      await page.getByRole('button', { name: t('Switch off'), exact: true }).click();
      await page
        .getByRole('dialog', { name: t('Switch off now?') })
        .getByRole('button', { name: t('Switch off') })
        .click();
      await expect(
        page.getByRole('button', { name: `${t('Lift')} (jira__update_issue)` }),
      ).toBeVisible();
    }

    test('confirmation screens', async ({ page }) => {
      // The key is the invented seed of the mock build (a made-up value, not a secret of any account).
      await page.goto('/authenticator/register?mockAuthenticator=none');
      await startEnrollment(page, t('Next'), t('Add the account in the app'));
      await expect(page.getByTestId('enrollment-key')).toContainText(MOCK_TOTP_SEED.slice(0, 4));
      await shot(page, '10-authenticator-register-qr');

      await page.getByRole('button', { name: t('Next') }).click();
      await page.getByLabel(t('Code from the app (6 digits)')).fill('000000');
      await page.getByRole('button', { name: t('Check') }).click();
      await expect(page.getByText(t('Invalid code.'))).toBeVisible();
      await shot(page, '11-authenticator-register-code');

      await page.goto('/connections?mockAuthenticator=active');
      await expect(page.getByRole('heading', { name: 'Authenticator' })).toBeVisible();
      await expect(page.getByRole('button', { name: t('Remove') })).toBeVisible();
      await shot(page, '12a-authenticator-active');
      await page.goto('/connections?mockAuthenticator=locked');
      await expect(
        page.getByText(
          t('A lock is lifted only by time. Removing and registering again does not shorten it.'),
        ),
      ).toBeVisible();
      await shot(page, '12b-authenticator-locked');
      await page.goto('/connections?mockAuthenticator=disabled');
      await expect(page.getByRole('link', { name: t('Register again') }).first()).toBeVisible();
      await shot(page, '12c-authenticator-disabled');

      await page.goto(`/confirm/${JIRA_CONFIRMATION_ID}`);
      await expect(page.getByText('ABC-1182').first()).toBeVisible();
      await expect(page.getByText(/0[12]:\d{2}/)).toBeVisible();
      await shot(page, '13-confirmation-preview');

      await page.getByRole('button', { name: t('Cancel operation') }).click();
      await expect(page.getByRole('heading', { name: t('Operation cancelled.') })).toBeVisible();
      await shot(page, '14a-operation-cancelled');

      // The mock keeps its state in a cookie; dropping it makes the cancelled operation pending again.
      await page.context().clearCookies();
      // Polling is paused on a hidden page; otherwise the mock answers 404 first and the page says "out of date".
      await page.addInitScript(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        });
      });
      await page.clock.install();
      await page.goto(`/confirm/${JIRA_CONFIRMATION_ID}`);
      await expect(page.getByText(/0[12]:\d{2}/)).toBeVisible();
      await page.clock.fastForward('02:05');
      await expect(page.getByRole('heading', { name: t('Time is up.') })).toBeVisible();
      await shot(page, '14b-operation-expired');
    });

    test('connection, log and request screens', async ({ page }) => {
      await page.goto('/connect/jira');
      await expect(page.getByLabel(t('PAT token'), { exact: true })).toBeVisible();
      await page.getByText(t('How to create the narrowest possible token')).click();
      await page.getByLabel(t('Token expiry date (optional)')).fill('2027-01-31');
      await expect(
        page.getByText(t('We will mark the token as expiring 7 days before the date.')),
      ).toBeVisible();
      await shot(page, '15-add-token-jira', true);

      await page.goto('/logs');
      await page
        .getByRole('button', { name: `${t('Show details')}: confluence__delete_page` })
        .first()
        .click();
      await expect(page.getByText(t('Request ID')).first()).toBeVisible();
      await shot(page, '16-audit-logs');

      await page.goto('/requests');
      await page.getByRole('button', { name: t('Submit request') }).click();
      const first = page.getByRole('dialog', { name: t('Submit request') });
      await first.getByLabel(t('System')).selectOption('confluence');
      await first.getByLabel(t('Entitlement')).selectOption('mcp-confluence-read');
      await first.getByRole('button', { name: t('Submit request') }).click();
      await page.getByRole('button', { name: t('Close message') }).click();
      await expect(page.getByRole('row', { name: /mcp-confluence-read/ })).toContainText(
        t('Pending'),
      );
      await shot(page, '17a-requests-list');
      await page.getByRole('button', { name: t('Submit request') }).click();
      const dialog = page.getByRole('dialog', { name: t('Submit request') });
      await dialog.getByLabel(t('System')).selectOption('jira');
      await dialog.getByLabel(t('Entitlement')).selectOption({ index: 1 });
      await shot(page, '17b-requests-form');

      await page.goto('/catalog?mockIga=groups&mockScenario=mixed');
      await expect(
        page.getByText(t('Access is granted by the platform administrator.')).first(),
      ).toBeVisible();
      await shot(page, '17c-requests-not-accepted');
    });

    test('adding a server, approving its connection, its details', async ({ page }) => {
      await page.goto('/admin/servers?mockAdmin=in');
      await page.getByRole('button', { name: t('Add server') }).click();
      await page.getByLabel(t('Address of the MCP endpoint')).fill('http://mcp-inner:8080/mcp');
      await page.getByRole('button', { name: t('Save'), exact: true }).click();
      await expect(
        page.getByText(t('An http address needs the "Allow plain HTTP" option.')),
      ).toBeVisible();
      await shot(page, '26-add-server');

      await page.goto('/admin?mockAdmin=in');
      await expect(
        page.locator('app-connection-approval', { hasText: /Notes/ }).first(),
      ).toBeVisible();
      await shot(page, '27-connection-approval', true);

      await page.goto('/admin/servers?mockAdmin=in');
      await page.getByRole('button', { name: `${t('Details')} (mcp-gitlab)` }).click();
      await expect(page.getByRole('heading', { name: /mcp-gitlab/ })).toBeVisible();
      await shot(page, '28-server-details-plain', true);
    });

    test('servers, systems, scope mapping, overrides and policies', async ({ page }) => {
      await page.goto('/admin/servers?mockAdmin=in');
      await expect(page.getByRole('rowheader', { name: /mcp-jira/ })).toBeVisible();
      await shot(page, '21-servers');

      await page.goto('/admin/systems?mockAdmin=in');
      await page.getByRole('button', { name: `${t('Edit')} (jira)` }).click();
      await page.getByLabel(t('Base address'), { exact: true }).fill('https://jira-new.internal');
      await expect(page.getByLabel(t('Client secret'))).toBeVisible();
      await shot(page, '22-system-address-changed');

      await page.goto('/admin/scope-mapping?mockAdmin=in');
      await page.getByRole('button', { name: t('Add group') }).click();
      await expect(page.getByLabel(t('Group'), { exact: true })).toHaveCount(3);
      await page.getByLabel(t('Group'), { exact: true }).last().fill('mcp-team-docs');
      await page.getByLabel(t('Scopes (one per line)')).last().fill('Mystery::Place/x');
      await page.getByRole('button', { name: t('Save mapping') }).click();
      await expect(page.getByRole('alert').first()).toBeVisible();
      await shot(page, '23-scope-mapping-errors');

      await page.goto('/admin/overrides?mockAdmin=in');
      await expect(
        page.getByRole('rowheader', { name: /override-block-drop-table/ }),
      ).toBeVisible();
      await shot(page, '24-overrides');

      await page.goto('/admin?mockAdmin=in&mockPolicies=in');
      await page
        .getByRole('button', { name: `${t('Show differences')} (Jira, ${t('policies')})` })
        .click();
      await expect(page.getByText(t('Policies and schema'))).toBeVisible();
      await shot(page, '25-policies-pending', true);
    });

    test('administration approval dialogs and the step-up return', async ({ page }) => {
      await page.goto('/admin?mockAdmin=in');
      await page
        .getByRole('button', { name: `${t('Show differences')} (jira__delete_issue)` })
        .click();
      await shot(page, '18a-risk-lowering-list');
      await page
        .getByRole('button', { name: `${t('Approve risk lowering')} (jira__delete_issue)` })
        .click();
      await expect(page.getByRole('dialog', { name: t('Approve risk lowering?') })).toBeVisible();
      await shot(page, '18b-risk-lowering-dialog');

      await page.goto('/admin?mockAdmin=in');
      await page
        .getByRole('button', { name: `${t('Show differences')} (jira__update_issue)` })
        .click();
      await expect(page.getByText(t('Source: server.'))).toBeVisible();
      await page
        .getByRole('button', { name: `${t('Approve definition')} (jira__update_issue)` })
        .click();
      await expect(
        page.getByRole('dialog', { name: t('Approve a definition reported by the server?') }),
      ).toBeVisible();
      await shot(page, '19-server-definition-dialog');

      await switchOffUpdateIssue(page);
      await page.goto('/admin/kill-switches');
      await page.getByRole('button', { name: `${t('Lift')} (jira__update_issue)` }).click();
      await page
        .getByRole('dialog', { name: t('Lift the switch?') })
        .getByRole('button', { name: t('Lift switch') })
        .click();
      await expect(page.getByText(/^(Identity confirmed|Tożsamość potwierdzona)\./)).toBeVisible();
      await shot(page, '20-step-up-return');
    });
  });
}
