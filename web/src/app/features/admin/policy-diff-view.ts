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
import { AdminService, ApprovePoliciesResult, PendingPolicies } from '../../api/generated';
import { AdminStepUp } from '../../core/admin-step-up';
import { NotificationService } from '../../core/notification.service';
import { toApiFailure } from '../../core/api-error';
import { LOADING, LoadState } from '../../core/load-state';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { StateLine } from '../../shared/state-line';
import { SafeTextPipe } from '../../shared/safe-text.pipe';
import { PolicyDiff, diffPolicies } from './policy-diff';

export interface PolicyApprovalIntent {
  op: 'approve-policies';
  serverId: string;
  hash: string;
}

/**
 * The policies and resource types a server reported, next to the approved ones, and the approval of the pending hash.
 * Until it is approved the tools of the server are blocked. Approving needs a fresh MFA; after the return from the IdP
 * the approval of the same hash is carried out by itself, and a changed hash is not (the administrator reads again).
 */
@Component({
  selector: 'app-policy-diff',
  imports: [MatButtonModule, LoadError, Loading, StateLine, SafeTextPipe],
  templateUrl: './policy-diff-view.html',
  styleUrls: ['./diff-code.scss', './policy-diff-view.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PolicyDiffView implements OnInit {
  private readonly adminApi = inject(AdminService);
  private readonly notifications = inject(NotificationService);
  private readonly stepUp = inject(AdminStepUp);

  readonly serverId = input.required<string>();
  readonly serverName = input.required<string>();
  /** A hash approved before the MFA; carried out here when it is still the pending one. */
  readonly resume = input<PolicyApprovalIntent | null>(null);
  readonly resumeHandled = output();
  readonly approved = output<ApprovePoliciesResult>();

  protected readonly pending = signal<LoadState<PendingPolicies>>(LOADING);
  protected readonly approving = signal(false);
  protected readonly changedMeanwhile = signal(false);
  protected readonly resumeRefused = signal(false);
  /** Set while the approval carried out after the return from the IdP runs; a repeated step-up request is then an error. */
  private resuming = false;

  protected readonly view = computed<{ value: PendingPolicies; diff: PolicyDiff } | null>(() => {
    const state = this.pending();
    return state.status === 'ready'
      ? { value: state.value, diff: diffPolicies(state.value) }
      : null;
  });

  ngOnInit(): void {
    void this.start();
  }

  private async start(): Promise<void> {
    await this.load();
    const intent = this.resume();
    const view = this.view();
    if (intent && intent.serverId === this.serverId()) {
      if (view && view.value.pendingHash === intent.hash) {
        this.resuming = true;
        try {
          await this.approve();
        } finally {
          this.resuming = false;
        }
      } else {
        this.resumeRefused.set(true);
      }
      this.resumeHandled.emit();
    }
  }

  protected async load(): Promise<void> {
    this.pending.set(LOADING);
    try {
      this.pending.set({
        status: 'ready',
        value: await firstValueFrom(this.adminApi.getAdminPendingServerPolicies(this.serverId())),
      });
    } catch (error) {
      this.pending.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  protected async approve(): Promise<void> {
    const view = this.view();
    // The hash covers lines the cut view never showed, so the administrator would approve text not seen.
    if (!view || this.approving() || view.diff.truncated) {
      return;
    }
    const hash = view.value.pendingHash;
    this.approving.set(true);
    try {
      const result = await firstValueFrom(
        this.adminApi.approveAdminServerPolicies(this.serverId(), { policiesHash: hash }),
      );
      this.approved.emit(result);
    } catch (error) {
      const failure = toApiFailure(error);
      const intent: PolicyApprovalIntent = {
        op: 'approve-policies',
        serverId: this.serverId(),
        hash,
      };
      if (this.stepUp.redirectIfRequired(failure, '/admin', intent, this.resuming)) {
        return;
      }
      if (failure.code === 'hash_mismatch') {
        this.changedMeanwhile.set(true);
        await this.load();
      } else {
        this.notifications.failure(failure);
      }
    } finally {
      this.approving.set(false);
    }
  }
}
