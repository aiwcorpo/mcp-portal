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
    expect(text(fixture.nativeElement)).toContain('Sign in with your company account.');
    expect(button('Sign in with your company account', fixture.nativeElement)).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it.each<[LoginErrorCode, string]>([
    ['cancelled', 'Sign-in cancelled.'],
    ['idp_error', 'The sign-in service is not responding. Try again in a moment.'],
    ['session_expired', 'Session expired. Sign in again.'],
    ['step_up_failed', 'Could not verify your identity. Try registering again.'],
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

    button('Sign in with your company account', fixture.nativeElement).click();

    expect(session.loginError()).toBeNull();
    await until(() => expect(navigation.assign).toHaveBeenCalled());
  });

  it('says so after logout and after an expired session', async () => {
    configureTestApp();
    const loggedOut = render('logged_out');
    await loggedOut.whenStable();
    expect(text(loggedOut.nativeElement)).toContain('Signed out.');

    const expired = render('expired');
    await expired.whenStable();
    expect(text(expired.nativeElement)).toContain('Session expired. Sign in again.');
  });
});
