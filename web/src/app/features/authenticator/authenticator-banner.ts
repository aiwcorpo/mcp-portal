import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthenticatorService, AuthenticatorStatus } from '../../api/generated';
import { Notice } from '../../shared/notice';

/**
 * Tells the user that tools needing a code from the Authenticator will not work yet (mockups 23, 12):
 * no registration, a registration switched off by the daily limit, or a block that only time lifts.
 * A status that cannot be read shows nothing: the banner only adds a hint, the page works without it.
 */
@Component({
  selector: 'app-authenticator-banner',
  imports: [DatePipe, RouterLink, Notice],
  template: `
    @let current = status();
    @if (needed() && current) {
      @if (current.state === 'none') {
        <app-notice kind="warning">
          <ng-container i18n="@@authBanner.none"
            >"Delete" tools need a code from the Authenticator, and you have not registered
            it yet.</ng-container
          >&ngsp;<a routerLink="/authenticator/register" i18n="@@authBanner.register"
            >Register Authenticator</a
          >
        </app-notice>
      } @else if (current.state === 'disabled') {
        <app-notice kind="warning">
          <ng-container i18n="@@authBanner.disabled"
            >The Authenticator is switched off after 20 wrong codes in one day, so "Delete"
            tools will not work.</ng-container
          >&ngsp;<a routerLink="/authenticator/register" i18n="@@authBanner.registerAgain"
            >Register again</a
          >
        </app-notice>
      } @else if (current.lockedUntil) {
        <app-notice kind="warning">
          <ng-container i18n="@@authBanner.locked"
            >The Authenticator is locked until {{ current.lockedUntil | date: 'HH:mm' }} after 5
            wrong codes. "Delete" tools will work after that time.</ng-container
          >
        </app-notice>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthenticatorBanner {
  private readonly api = inject(AuthenticatorService);

  /** True when a tool that needs a confirmation code is on the page. */
  readonly needed = input(false);
  protected readonly status = signal<AuthenticatorStatus | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.status.set(await firstValueFrom(this.api.getMyAuthenticator()));
    } catch {
      this.status.set(null);
    }
  }
}
