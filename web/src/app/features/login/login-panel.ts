import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { LoginErrorCode } from '../../api/generated';
import { SessionService } from '../../core/session.service';

type Reason = 'not_logged_in' | 'expired' | 'logged_out';

const LOGIN_ERROR_TEXT: Record<LoginErrorCode, () => string> = {
  cancelled: () => $localize`:@@login.err.cancelled:Logowanie anulowane.`,
  idp_error: () =>
    $localize`:@@login.err.idp_error:Usługa logowania nie odpowiada. Spróbuj za chwilę.`,
  session_expired: () =>
    $localize`:@@login.err.session_expired:Sesja wygasła. Zaloguj się ponownie.`,
  step_up_failed: () =>
    $localize`:@@login.err.step_up_failed:Nie udało się potwierdzić tożsamości. Spróbuj zarejestrować ponownie.`,
};

/** Sign-in screen (mockups 00, 23, 25). The error line comes from a closed list, never from the URL text. */
@Component({
  selector: 'app-login-panel',
  imports: [MatButtonModule],
  template: `
    <section class="login" aria-labelledby="login-title">
      <h1 id="login-title" i18n="@@login.title">Portal MCP</h1>
      <p class="muted" i18n="@@login.text">Zaloguj się kontem firmowym.</p>
      <button mat-flat-button type="button" class="login-button" (click)="session.login()">
        <ng-container i18n="@@login.button">Zaloguj przez konto firmowe</ng-container>
      </button>
      @if (message(); as text) {
        <p class="message" [class.info]="!error()" role="alert">{{ text }}</p>
      }
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
        return $localize`:@@login.expired:Sesja wygasła. Zaloguj się ponownie.`;
      case 'logged_out':
        return $localize`:@@login.loggedOut:Wylogowano.`;
      default:
        return null;
    }
  });
}
