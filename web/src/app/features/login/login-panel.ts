import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { LoginErrorCode } from '../../api/generated';
import { SessionService } from '../../core/session.service';
import { LocaleSwitch } from '../../shared/locale-switch';

type Reason = 'not_logged_in' | 'expired' | 'logged_out';

const LOGIN_ERROR_TEXT: Record<LoginErrorCode, () => string> = {
  cancelled: () => $localize`:@@login.err.cancelled:Sign-in cancelled.`,
  idp_error: () =>
    $localize`:@@login.err.idp_error:The sign-in service is not responding. Try again in a moment.`,
  session_expired: () =>
    $localize`:@@login.err.session_expired:Session expired. Sign in again.`,
  step_up_failed: () =>
    $localize`:@@login.err.step_up_failed:Could not verify your identity. Try registering again.`,
};

/** Sign-in screen (mockups 00, 23, 25). The error line comes from a closed list, never from the URL text. */
@Component({
  selector: 'app-login-panel',
  imports: [MatButtonModule, LocaleSwitch],
  template: `
    <section class="login" aria-labelledby="login-title">
      <h1 id="login-title" i18n="@@login.title">Portal MCP</h1>
      <p class="muted" i18n="@@login.text">Sign in with your company account.</p>
      <button mat-flat-button type="button" class="login-button" (click)="session.login()">
        <ng-container i18n="@@login.button">Sign in with your company account</ng-container>
      </button>
      @if (message(); as text) {
        <p class="message" [class.info]="!error()" role="alert">{{ text }}</p>
      }
      <app-locale-switch />
    </section>
  `,
  styles: `
    .login {
      display: grid;
      align-content: center;
      justify-items: start;
      gap: 14px;
      width: min(320px, 100%);
      min-height: min(60vh, 520px);
      margin: 0 auto;
    }
    h1 {
      font-size: 18px;
    }
    .login-button {
      width: 100%;
      margin-top: 4px;
    }
    .message {
      color: var(--pm-danger);
    }
    .message.info {
      color: var(--pm-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPanel {
  protected readonly session = inject(SessionService);
  readonly reason = input<Reason>('not_logged_in');

  protected readonly error = computed(() => this.session.loginError());
  protected readonly message = computed(() => {
    const code = this.error();
    if (code) {
      return LOGIN_ERROR_TEXT[code]();
    }
    switch (this.reason()) {
      case 'expired':
        return $localize`:@@login.expired:Session expired. Sign in again.`;
      case 'logged_out':
        return $localize`:@@login.loggedOut:Signed out.`;
      default:
        return null;
    }
  });
}
