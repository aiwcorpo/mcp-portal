import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthenticatorService, AuthenticatorStatus } from '../../api/generated';
import { StateLine } from '../../shared/state-line';

/** A status that cannot be read gives null: the state only adds a hint, the page works without it. */
export async function readAuthenticatorStatus(
  api: AuthenticatorService,
): Promise<AuthenticatorStatus | null> {
  try {
    return await firstValueFrom(api.getMyAuthenticator());
  } catch {
    return null;
  }
}

/**
 * At a tool that needs a code from the Authenticator (mockups 23, 12, 40): no registration, a registration
 * switched off by the daily limit, or a block that only time lifts. Without a problem it shows the projected
 * note about the code instead.
 */
@Component({
  selector: 'app-authenticator-state',
  imports: [DatePipe, RouterLink, StateLine],
  template: `
    @let current = status();
    @if (current?.state === 'none') {
      <app-state kind="warning">
        <ng-container i18n="@@authState.none">You have no Authenticator</ng-container>
        <span aria-hidden="true"> &middot; </span>
        <a routerLink="/authenticator/register" i18n="@@authState.register">Register</a>
      </app-state>
    } @else if (current?.state === 'disabled') {
      <app-state kind="warning">
        <ng-container i18n="@@authState.disabled"
          >Authenticator switched off after 20 wrong codes</ng-container
        >
        <span aria-hidden="true"> &middot; </span>
        <a routerLink="/authenticator/register" i18n="@@authState.registerAgain">Register again</a>
      </app-state>
    } @else if (current?.lockedUntil; as until) {
      <app-state kind="warning">
        <ng-container i18n="@@authState.locked"
          >Locked until {{ until | date: 'HH:mm' }}</ng-container
        >
      </app-state>
    } @else {
      <ng-content />
    }
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthenticatorState {
  readonly status = input<AuthenticatorStatus | null>(null);
}
