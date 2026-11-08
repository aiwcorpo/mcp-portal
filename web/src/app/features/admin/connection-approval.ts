import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import { AdminService, PendingConnection, ServerConfig, TlsMode } from '../../api/generated';
import { AdminStepUp } from '../../core/admin-step-up';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { ErrorNotice } from '../../shared/error-notice';
import { Notice } from '../../shared/notice';
import { SafeTextPipe } from '../../shared/safe-text.pipe';
import { ConnectionFacts } from './connection-facts';
import { PLAIN_HTTP_RISK, pendingReasonText, tlsModeLabel } from './server-connection';

/** The approval of a connection carried across the trip to the IdP for a fresh MFA. */
export interface ConnectionApprovalIntent {
  op: 'approve-connection';
  serverId: string;
  tlsMode: TlsMode;
  fingerprint: string | null;
}

/**
 * The card of a server whose connection waits for approval (the first one, or a certificate that changed). It shows
 * what the gateway saw and sends back the fingerprint the administrator looked at, so a certificate that changes in
 * between is refused (409 connection_changed) instead of approved unseen. Approving needs a fresh MFA; after the return
 * from the IdP the same pending connection is approved by itself, a different one is not.
 */
@Component({
  selector: 'app-connection-approval',
  imports: [MatButtonModule, ConnectionFacts, ErrorNotice, Notice, SafeTextPipe],
  templateUrl: './connection-approval.html',
  styleUrl: './connection-approval.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionApproval implements OnInit {
  private readonly adminApi = inject(AdminService);
  private readonly stepUp = inject(AdminStepUp);

  readonly server = input.required<ServerConfig>();
  readonly serverName = input.required<string>();
  /** An approval started before the MFA; carried out here when the pending connection is still the one it named. */
  readonly resume = input<ConnectionApprovalIntent | null>(null);
  readonly resumeHandled = output();
  readonly approved = output<ServerConfig>();
  /** The pending connection is gone or another one; the page reads the servers again. */
  readonly stale = output();

  protected readonly pending = computed<PendingConnection | null>(
    () => this.server().pendingConnection,
  );
  /** `ca` can be traded for `pinned`; the other proposals have no alternative. */
  protected readonly choices = computed<TlsMode[]>(() =>
    this.pending()?.tlsMode === 'ca'
      ? ['ca', 'pinned']
      : this.pending()
        ? [this.pending()!.tlsMode]
        : [],
  );
  private readonly chosen = signal<TlsMode | null>(null);
  protected readonly mode = computed<TlsMode | null>(() => {
    const choice = this.chosen();
    return choice && this.choices().includes(choice) ? choice : (this.pending()?.tlsMode ?? null);
  });
  protected readonly plain = computed(() => this.pending()?.tlsMode === 'plain');
  protected readonly plainWarning = PLAIN_HTTP_RISK;
  protected readonly reasonText = computed(() => {
    const pending = this.pending();
    return pending ? pendingReasonText(pending.reason) : '';
  });
  protected readonly modeLabel = tlsModeLabel;
  protected readonly approving = signal(false);
  protected readonly failure = signal<ApiFailure | null>(null);
  protected readonly resumeRefused = signal(false);
  /** Set while the approval carried out after the return from the IdP runs; a repeated step-up request is then an error. */
  private resuming = false;

  ngOnInit(): void {
    const intent = this.resume();
    if (!intent || intent.serverId !== this.server().serverId) {
      return;
    }
    const pending = this.pending();
    if (
      pending &&
      pending.fingerprint === intent.fingerprint &&
      this.choices().includes(intent.tlsMode)
    ) {
      this.chosen.set(intent.tlsMode);
      this.resuming = true;
      void this.approve().finally(() => {
        this.resuming = false;
        this.resumeHandled.emit();
      });
    } else {
      this.resumeRefused.set(true);
      this.resumeHandled.emit();
    }
  }

  protected choose(mode: TlsMode): void {
    this.chosen.set(mode);
  }

  protected async approve(): Promise<void> {
    const pending = this.pending();
    const mode = this.mode();
    if (!pending || !mode || this.approving()) {
      return;
    }
    this.approving.set(true);
    this.failure.set(null);
    const serverId = this.server().serverId;
    try {
      const updated = await firstValueFrom(
        this.adminApi.approveAdminServerConnection(serverId, {
          tlsMode: mode,
          fingerprint: pending.fingerprint,
        }),
      );
      this.approved.emit(updated);
    } catch (error) {
      const failure = toApiFailure(error);
      const intent: ConnectionApprovalIntent = {
        op: 'approve-connection',
        serverId,
        tlsMode: mode,
        fingerprint: pending.fingerprint,
      };
      if (this.stepUp.redirectIfRequired(failure, '/admin', intent, this.resuming)) {
        return;
      }
      this.failure.set(failure);
      if (failure.code === 'connection_changed' || failure.code === 'no_pending_connection') {
        this.stale.emit();
      }
    } finally {
      this.approving.set(false);
    }
  }
}
