import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { SessionService } from '../../core/session.service';
import { Notice } from '../../shared/notice';

@Component({
  selector: 'app-login-panel',
  imports: [MatButtonModule, Notice],
  template: `
    <h1 i18n="@@login.title">Zaloguj się do Portalu MCP</h1>
    @switch (reason()) {
      @case ('expired') {
        <app-notice kind="info" i18n="@@login.expired"
          >Sesja wygasła. Zaloguj się ponownie, żeby kontynuować.</app-notice
        >
      }
      @case ('logged_out') {
        <app-notice kind="success" i18n="@@login.loggedOut">Wylogowano.</app-notice>
      }
    }
    <p i18n="@@login.text">
      Portal używa firmowego logowania (SSO). Po zalogowaniu zobaczysz serwery MCP, do których masz
      uprawnienia, i połączysz z nimi swoje konta.
    </p>
    <button mat-flat-button type="button" (click)="session.login()" i18n="@@login.button">
      Zaloguj się
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPanel {
  protected readonly session = inject(SessionService);
  readonly reason = input<'not_logged_in' | 'expired' | 'logged_out'>('not_logged_in');
}
