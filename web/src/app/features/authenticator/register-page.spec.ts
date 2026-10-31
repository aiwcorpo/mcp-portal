import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HttpResponse, http } from 'msw';
import { SessionService } from '../../core/session.service';
import { ResumeIntentStore } from '../../core/resume-intent';
import { MOCK_TOTP_SEED } from '../../../mocks/m3-mock';
import { currentCode } from '../../../mocks/totp';
import { useMockApi } from '../../../testing/mock-api';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';

const GROUPED_KEY = 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ';

function codeInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('#enroll-code')!;
}

function typeCode(value: string): void {
  const input = codeInput();
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

/** Nothing of the seed may be anywhere the user, the history or another page could read it. */
function expectSeedNowhere(): void {
  const everywhere = [
    document.body.innerHTML,
    document.title,
    location.href,
    JSON.stringify({ ...localStorage }),
    JSON.stringify({ ...sessionStorage }),
    JSON.stringify(history.state),
    document.cookie,
  ].join('\n');
  expect(everywhere).not.toContain(MOCK_TOTP_SEED);
  expect(everywhere).not.toContain(GROUPED_KEY);
  expect(everywhere).not.toContain('otpauth');
}

describe('AuthenticatorRegisterPage', () => {
  const { server, store } = useMockApi();

  async function toScanStep() {
    store.update({ mfaFresh: true });
    const navigation = configureTestApp();
    const harness = await openRoute('/authenticator/register');
    await until(() => expect(text()).toContain('Zarejestruj Authenticator'));
    button('Dalej').click();
    await until(() => expect(text()).toContain('Dodaj konto w aplikacji'));
    return { navigation, harness };
  }

  it('walks through the four steps and shows the seed only in step 2', async () => {
    const { harness } = await toScanStep();

    expect(text()).toContain('1. Informacja');
    expect(text()).toContain('2. Skanowanie');
    expect(text()).toContain('Kod QR i klucz pokazujemy tylko teraz.');
    expect(text()).toMatch(/ważna jeszcze (09|10):\d{2}\./);
    expect(document.querySelector('app-qr-code svg[role="img"] path')?.getAttribute('d')).toMatch(
      /^M\d/,
    );
    expect(document.querySelector('[data-testid="enrollment-key"]')?.textContent).toBe(GROUPED_KEY);
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('Skanowanie');
    expect(text()).not.toContain('Pokaż ponownie');
    expect(TestBed.inject(Router).url).toBe('/authenticator/register');
    expect(document.title).not.toContain(MOCK_TOTP_SEED);

    button('Dalej').click();
    await until(() => expect(text()).toContain('Wpisz pierwszy kod'));
    expectSeedNowhere();
    expect(document.querySelector('app-qr-code')).toBeNull();

    typeCode(await currentCode(MOCK_TOTP_SEED));
    button('Sprawdź').click();
    await harness.fixture.whenStable();
    await until(() => expect(text()).toContain('Authenticator zarejestrowany'));
    expect(text()).toContain('Od teraz operacje nieodwracalne potwierdzasz kodem z aplikacji.');
    expect(store.state.authenticator.state).toBe('active');
    expectSeedNowhere();
  });

  it('keeps the key out of the DOM again after going back from step 3 and after leaving the page', async () => {
    const { harness } = await toScanStep();
    button('Dalej').click();
    await until(() => expect(text()).toContain('Wpisz pierwszy kod'));
    button('Wstecz').click();
    await until(() => expect(text()).toContain('Zarejestruj Authenticator'));
    expectSeedNowhere();

    store.update({ mfaFresh: true });
    button('Dalej').click();
    await until(() => expect(document.querySelector('app-qr-code')).not.toBeNull());
    await harness.navigateByUrl('/catalog');
    expectSeedNowhere();
  });

  it('drops the seed from the DOM synchronously when the page is hidden for the back-forward cache', async () => {
    await toScanStep();
    window.dispatchEvent(new Event('pagehide'));
    // No waiting: a frozen page never gets a later change detection.
    expect(document.querySelector('app-qr-code')).toBeNull();
    expectSeedNowhere();
    expect(text()).toContain('Zarejestruj Authenticator');
  });

  it('sends the user to the IdP for a fresh MFA and comes back to the same page', async () => {
    const navigation = configureTestApp();
    await TestBed.inject(SessionService).load();
    await openRoute('/authenticator/register');
    await until(() => expect(text()).toContain('Zarejestruj Authenticator'));
    button('Dalej').click();

    await until(() => expect(navigation.assign).toHaveBeenCalled());
    const target = new URL(navigation.assign.mock.calls[0][0], location.origin);
    expect(target.pathname).toBe('/api/v1/auth/login');
    expect(target.searchParams.get('stepUp')).toBe('true');
    expect(target.searchParams.get('returnPath')).toBe('/authenticator/register?mfa=ok');
    expect(JSON.parse(sessionStorage.getItem('mcp-portal-resume') ?? '{}').intent).toEqual({
      kind: 'enroll-authenticator',
    });
  });

  it('after the return from the MFA that the click asked for, starts the registration without a second click (U12)', async () => {
    store.update({ mfaFresh: true });
    configureTestApp();
    await TestBed.inject(SessionService).load();
    TestBed.inject(ResumeIntentStore).save(
      { kind: 'enroll-authenticator' },
      TestBed.inject(SessionService).username(),
    );
    await openRoute('/authenticator/register?mfa=ok');

    await until(() => expect(text()).toContain('Dodaj konto w aplikacji'));
    expect(store.state.enrollStarts).toBe(1);
    expect(sessionStorage.getItem('mcp-portal-resume')).toBeNull();
  });

  it('starts only once: a reload of the page after the resumed start waits for a click again', async () => {
    store.update({ mfaFresh: true });
    configureTestApp();
    await TestBed.inject(SessionService).load();
    TestBed.inject(ResumeIntentStore).save(
      { kind: 'enroll-authenticator' },
      TestBed.inject(SessionService).username(),
    );
    const harness = await openRoute('/authenticator/register?mfa=ok');
    await until(() => expect(text()).toContain('Dodaj konto w aplikacji'));

    await harness.navigateByUrl('/catalog');
    await harness.navigateByUrl('/authenticator/register?mfa=ok');
    await until(() => expect(text()).toContain('Kontynuuj rejestrację'));
    expect(store.state.enrollStarts).toBe(1);
  });

  it('after the return from the MFA without the intent of this tab (a link with ?mfa=ok) waits for a click', async () => {
    store.update({ mfaFresh: true });
    configureTestApp();
    await openRoute('/authenticator/register?mfa=ok');
    await until(() => expect(text()).toContain('Tożsamość potwierdzona.'));
    expect(TestBed.inject(Router).url).toBe('/authenticator/register');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(store.state.enrollStarts).toBe(0);
    expect(text()).not.toContain('Dodaj konto w aplikacji');

    button('Kontynuuj rejestrację').click();
    await until(() => expect(text()).toContain('Dodaj konto w aplikacji'));
  });

  it('shows the error instead of another redirect when the start is refused right after the MFA', async () => {
    const navigation = configureTestApp();
    await openRoute('/authenticator/register?mfa=ok');
    await until(() => expect(text()).toContain('Kontynuuj rejestrację'));
    button('Kontynuuj rejestrację').click();
    await until(() =>
      expect(text()).toContain('Ta operacja wymaga ponownego uwierzytelnienia (MFA).'),
    );
    expect(navigation.assign).not.toHaveBeenCalled();
    expect(text()).toContain('Zarejestruj Authenticator');
  });

  it('says so when a registration is already active', async () => {
    store.update({ authenticator: { state: 'active', registeredAt: '2026-10-27T09:00:00Z' } });
    configureTestApp();
    await openRoute('/authenticator/register');
    await until(() => expect(text()).toContain('Authenticator jest już zarejestrowany'));
    expect(text()).toContain('Usunięcie wymaga potwierdzenia tożsamości (MFA).');
    expect(text()).not.toContain('Dalej');
  });

  it('handles 409 already_registered returned by the start', async () => {
    server.use(
      http.post('/api/v1/authenticator/enrollment', () =>
        HttpResponse.json({ error: 'already_registered' }, { status: 409 }),
      ),
    );
    configureTestApp();
    await openRoute('/authenticator/register');
    await until(() => expect(text()).toContain('Zarejestruj Authenticator'));
    button('Dalej').click();
    await until(() => expect(text()).toContain('Authenticator jest już zarejestrowany'));
  });

  it('shows 429 and lets the user retry from step 1', async () => {
    server.use(
      http.post('/api/v1/authenticator/enrollment', () =>
        HttpResponse.json(
          { error: 'rate_limited' },
          { status: 429, headers: { 'Retry-After': '120' } },
        ),
      ),
    );
    configureTestApp();
    await openRoute('/authenticator/register');
    await until(() => expect(text()).toContain('Zarejestruj Authenticator'));
    button('Dalej').click();
    await until(() => expect(text()).toContain('Za dużo żądań. Spróbuj ponownie za 120 s.'));
    expect(text()).toContain('1. Informacja');
    expect(button('Dalej').disabled).toBe(false);
  });

  it('keeps step 3 open after a wrong code and validates the shape before sending', async () => {
    await toScanStep();
    button('Dalej').click();
    await until(() => expect(text()).toContain('Wpisz pierwszy kod'));

    typeCode('481');
    button('Sprawdź').click();
    await until(() => expect(text()).toContain('Kod ma 6 cyfr.'));

    typeCode('000000');
    button('Sprawdź').click();
    await until(() => expect(text()).toContain('Kod nieprawidłowy.'));
    expect(codeInput().getAttribute('aria-invalid')).toBe('true');
    expect(text()).toContain('Wpisz kod widoczny w aplikacji przy koncie "MCP Platform".');
  });

  it('ends the registration after three wrong codes', async () => {
    await toScanStep();
    button('Dalej').click();
    await until(() => expect(text()).toContain('Wpisz pierwszy kod'));
    for (const attempt of [1, 2]) {
      typeCode('000000');
      button('Sprawdź').click();
      await until(() => expect(store.state.enrollment?.wrong).toBe(attempt));
      await until(() => expect(button('Sprawdź').getAttribute('aria-disabled')).not.toBe('true'));
      expect(text()).toContain('Kod nieprawidłowy.');
    }
    typeCode('000000');
    button('Sprawdź').click();
    await until(() => expect(text()).toContain('Rejestracja wygasła albo wpisano 3 błędne kody.'));
    expect(text()).toContain('Usuń w aplikacji konto "MCP Platform" dodane przed chwilą.');
    expectSeedNowhere();

    store.update({ mfaFresh: true });
    button('Zacznij od nowa').click();
    await until(() => expect(text()).toContain('Zarejestruj Authenticator'));
  });

  it('expires on its own when the ten minutes run out, and clears the seed', async () => {
    server.use(
      http.post('/api/v1/authenticator/enrollment', () =>
        HttpResponse.json(
          {
            enrollmentId: 'enr_short',
            otpauthUri: `otpauth://totp/MCP%20Platform:jkowalski?secret=${MOCK_TOTP_SEED}`,
            secret: MOCK_TOTP_SEED,
            expiresAt: new Date(Date.now() + 1200).toISOString(),
          },
          { status: 201 },
        ),
      ),
    );
    configureTestApp();
    await openRoute('/authenticator/register');
    await until(() => expect(text()).toContain('Zarejestruj Authenticator'));
    button('Dalej').click();
    await until(() => expect(text()).toContain('Dodaj konto w aplikacji'));
    await until(() => expect(text()).toContain('Rejestracja wygasła albo wpisano 3 błędne kody.'));
    expectSeedNowhere();
  });

  it('copies the key without spaces', async () => {
    const copy = vi.fn(() => true);
    configureTestApp();
    TestBed.configureTestingModule({ providers: [{ provide: Clipboard, useValue: { copy } }] });
    store.update({ mfaFresh: true });
    await openRoute('/authenticator/register');
    await until(() => expect(text()).toContain('Zarejestruj Authenticator'));
    button('Dalej').click();
    await until(() => expect(text()).toContain('Dodaj konto w aplikacji'));
    button('Kopiuj').click();
    await until(() => expect(text()).toContain('Klucz skopiowany do schowka.'));
    expect(copy).toHaveBeenCalledWith(MOCK_TOTP_SEED);
  });

  describe('the clipboard', () => {
    function clipboardWith(content: string | Error) {
      const writeText = vi.fn(() => Promise.resolve());
      const readText = vi.fn(() =>
        content instanceof Error ? Promise.reject(content) : Promise.resolve(content),
      );
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText, writeText },
      });
      return { readText, writeText };
    }

    async function copyThenContinue() {
      configureTestApp();
      TestBed.configureTestingModule({
        providers: [{ provide: Clipboard, useValue: { copy: () => true } }],
      });
      store.update({ mfaFresh: true });
      await openRoute('/authenticator/register');
      await until(() => expect(text()).toContain('Zarejestruj Authenticator'));
      button('Dalej').click();
      await until(() => expect(text()).toContain('Dodaj konto w aplikacji'));
      button('Kopiuj').click();
      await until(() => expect(text()).toContain('Klucz skopiowany do schowka.'));
      button('Dalej').click();
      await until(() => expect(text()).toContain('Wpisz pierwszy kod'));
    }

    afterEach(() => Reflect.deleteProperty(navigator, 'clipboard'));

    it('is overwritten with an empty text when it still holds the key', async () => {
      const clipboard = clipboardWith(MOCK_TOTP_SEED);
      await copyThenContinue();
      await until(() => expect(clipboard.writeText).toHaveBeenCalledWith(''));
      expect(text()).not.toContain('Wyczyść schowek');
    });

    it('is left alone when it holds something else', async () => {
      const clipboard = clipboardWith('another text');
      await copyThenContinue();
      await until(() => expect(clipboard.readText).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(clipboard.writeText).not.toHaveBeenCalled();
      expect(text()).not.toContain('Wyczyść schowek');
    });

    it('asks the user to clear it when the browser does not let the page read it', async () => {
      const clipboard = clipboardWith(new Error('NotAllowedError'));
      await copyThenContinue();
      await until(() =>
        expect(text()).toContain('Klucz został skopiowany do schowka. Wyczyść schowek'),
      );
      expect(clipboard.writeText).not.toHaveBeenCalled();
    });

    it('says nothing when the key was never copied', async () => {
      const clipboard = clipboardWith(MOCK_TOTP_SEED);
      configureTestApp();
      store.update({ mfaFresh: true });
      await openRoute('/authenticator/register');
      await until(() => expect(text()).toContain('Zarejestruj Authenticator'));
      button('Dalej').click();
      await until(() => expect(text()).toContain('Dodaj konto w aplikacji'));
      button('Dalej').click();
      await until(() => expect(text()).toContain('Wpisz pierwszy kod'));
      expect(clipboard.readText).not.toHaveBeenCalled();
      expect(text()).not.toContain('Wyczyść schowek');
    });
  });
});
