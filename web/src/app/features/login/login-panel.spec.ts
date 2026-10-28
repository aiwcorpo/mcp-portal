import { TestBed } from '@angular/core/testing';
import { useMockApi } from '../../../testing/mock-api';
import { button, configureTestApp, text, until } from '../../../testing/test-app';
import { LoginErrorCode } from '../../api/generated';
import { SessionService } from '../../core/session.service';
import { LoginPanel } from './login-panel';

describe('LoginPanel', () => {
  useMockApi();

  function render(reason: 'not_logged_in' | 'expired' | 'logged_out' = 'not_logged_in') {
    const fixture = TestBed.createComponent(LoginPanel);
    fixture.componentRef.setInput('reason', reason);
    return fixture;
  }

  it('matches mockup 00: title, one line, one button', async () => {
    configureTestApp();
    const fixture = render();
    await fixture.whenStable();

    expect(text(fixture.nativeElement)).toContain('Portal MCP');
    expect(text(fixture.nativeElement)).toContain('Zaloguj się kontem firmowym.');
    expect(button('Zaloguj przez konto firmowe', fixture.nativeElement)).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it.each<[LoginErrorCode, string]>([
    ['cancelled', 'Logowanie anulowane.'],
    ['idp_error', 'Usługa logowania nie odpowiada. Spróbuj za chwilę.'],
    ['session_expired', 'Sesja wygasła. Zaloguj się ponownie.'],
    ['step_up_failed', 'Nie udało się potwierdzić tożsamości. Spróbuj zarejestrować ponownie.'],
  ])('loginError=%s', async (code, message) => {
    configureTestApp();
    TestBed.inject(SessionService).loginError.set(code);
    const fixture = render();
    await fixture.whenStable();

    expect(text(fixture.nativeElement)).toContain(message);
  });

  it('clears the error when the user tries again', async () => {
    const navigation = configureTestApp();
    const session = TestBed.inject(SessionService);
    session.loginError.set('cancelled');
    const fixture = render();
    await fixture.whenStable();

    button('Zaloguj przez konto firmowe', fixture.nativeElement).click();

    expect(session.loginError()).toBeNull();
    await until(() => expect(navigation.assign).toHaveBeenCalled());
  });

  it('says so after logout and after an expired session', async () => {
    configureTestApp();
    const loggedOut = render('logged_out');
    await loggedOut.whenStable();
    expect(text(loggedOut.nativeElement)).toContain('Wylogowano.');

    const expired = render('expired');
    await expired.whenStable();
    expect(text(expired.nativeElement)).toContain('Sesja wygasła. Zaloguj się ponownie.');
  });
});
