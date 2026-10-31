import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthenticatorService, AuthenticatorStatus } from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { stepUpUrlFor } from '../../core/auth-urls';
import { BrowserNavigation } from '../../core/browser-navigation';
import { SessionService } from '../../core/session.service';
import { ResumeIntentStore } from '../../core/resume-intent';
import { ConfirmDialog, ConfirmDialogData } from '../../shared/confirm-dialog';
import { ErrorNotice } from '../../shared/error-notice';
import { Notice } from '../../shared/notice';

/** Path of the page that hosts this section; the return from the IdP lands here. */
export const CONNECTIONS_PATH = '/connections';
export const MFA_RETURN_QUERY = 'mfa';

/**
 * Authenticator block of My connections (mockups 03, 24, 30): not registered, active, locked for a
 * while, or switched off by the daily limit, with removal behind a fresh MFA (CC-093). A block is lifted
 * only by time; there is no unlock action (CC-091).
 */
@Component({
  selector: 'app-authenticator-section',
  imports: [DatePipe, MatButtonModule, RouterLink, ErrorNotice, Notice],
  templateUrl: './authenticator-section.html',
  styleUrl: './authenticator-section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthenticatorSection implements OnInit {
  private readonly api = inject(AuthenticatorService);
  private readonly dialog = inject(MatDialog);
  private readonly navigation = inject(BrowserNavigation);
  private readonly resume = inject(ResumeIntentStore);
  private readonly session = inject(SessionService);

  readonly status = input.required<AuthenticatorStatus>();
  /** True right after the return from the IdP that the removal asked for. */
  readonly mfaConfirmed = input(false);
  /** The registration changed on the server; the page loads it again. */
  readonly changed = output();

  protected readonly busy = signal(false);
  protected readonly failure = signal<ApiFailure | null>(null);
  protected readonly removed = signal(false);
  /** The removal was confirmed before the MFA and is carried out after the return without a second click. */
  protected readonly resumed = signal(false);
  protected readonly today = new Date().toDateString();

  protected isToday(iso: string): boolean {
    return new Date(iso).toDateString() === this.today;
  }

  ngOnInit(): void {
    const intent = this.mfaConfirmed()
      ? this.resume.take('remove-authenticator', this.session.username())
      : null;
    const current = this.status();
    // Only the registration that was shown in the dialog is removed: a new one made meanwhile is not.
    if (intent && current.state === 'active' && current.registeredAt === intent.registeredAt) {
      this.resumed.set(true);
      void this.performRemoval();
    }
  }

  protected async remove(): Promise<void> {
    if (this.busy()) {
      return;
    }
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: {
            title: $localize`:@@authRemove.title:Usunąć Authenticator?`,
            message: $localize`:@@authRemove.message:Bez Authenticatora agent nie wykona operacji nieodwracalnych. Usunięcie wymaga potwierdzenia tożsamości (MFA).`,
            confirmLabel: $localize`:@@authRemove.confirm:Usuń`,
            destructive: true,
          },
        })
        .afterClosed(),
    );
    if (!confirmed) {
      return;
    }
    await this.performRemoval();
  }

  private async performRemoval(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.failure.set(null);
    this.removed.set(false);
    try {
      await firstValueFrom(this.api.deleteMyAuthenticator());
      this.removed.set(true);
      this.changed.emit();
    } catch (error) {
      const failure = toApiFailure(error);
      if (failure.code === 'step_up_required' && !this.mfaConfirmed()) {
        this.resume.save(
          { kind: 'remove-authenticator', registeredAt: this.status().registeredAt ?? '' },
          this.session.username(),
        );
        this.navigation.assign(
          stepUpUrlFor(
            failure.stepUpUrl,
            `${CONNECTIONS_PATH}?${MFA_RETURN_QUERY}=ok`,
            this.navigation.origin,
          ),
        );
        return;
      }
      this.failure.set(failure);
    } finally {
      this.resumed.set(false);
      this.busy.set(false);
    }
  }
}
