import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { AdminService, PendingTool, Risk } from '../../api/generated';
import { failureMessage } from '../../core/error-messages';
import { NotificationService } from '../../core/notification.service';
import { parseKeepingNumbers } from './raw-json';
import { SafeTextPipe } from '../../shared/safe-text.pipe';
import { toApiFailure } from '../../core/api-error';
import { LOADING, LoadState } from '../../core/load-state';
import { stepUpUrlFor } from '../../core/auth-urls';
import { BrowserNavigation } from '../../core/browser-navigation';
import { SessionService } from '../../core/session.service';
import { ResumeIntentStore, ResumeOf } from '../../core/resume-intent';
import { ConfirmDialog, ConfirmDialogData } from '../../shared/confirm-dialog';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';
import { riskLabel, riskOrUnclassified } from '../../shared/labels';
import { ADMIN_PATH } from './admin-path';
import { Classification } from './classification';
import { ClassifyDialog, ClassifyDialogData } from './classify-dialog';
import {
  RISK_ORDER,
  annotationHints,
  diffDefinitions,
  riskChange,
  riskChangeText,
} from './definition-diff';

/** What the gateway says when it refuses the classification itself; the dialog opens again with the reason. */
const CLASSIFICATION_REASONS: ReadonlySet<string> = new Set([
  'classification_inconsistent',
  'classification_required',
  'classification_not_allowed',
]);

type Outcome =
  | { kind: 'done' }
  | { kind: 'classification-refused'; message: string }
  | { kind: 'lowering-required' }
  | { kind: 'stopped' };

/**
 * The approved and the pending definition of one tool, side by side, and the approval of the pending one.
 * The approval carries the hash that was shown, so a definition that changed meanwhile is refused (409) and
 * the diff is read again instead of approving something nobody looked at.
 */
@Component({
  selector: 'app-tool-diff',
  imports: [SafeTextPipe, MatButtonModule, LoadError, Loading, Notice],
  templateUrl: './tool-diff.html',
  styleUrl: './tool-diff.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolDiff {
  private readonly adminApi = inject(AdminService);
  private readonly notifications = inject(NotificationService);
  private readonly http = inject(HttpClient);
  private readonly navigation = inject(BrowserNavigation);
  private readonly dialog = inject(MatDialog);
  private readonly resumeStore = inject(ResumeIntentStore);
  private readonly session = inject(SessionService);

  readonly serverId = input.required<string>();
  /** Tool name in the registry (without the gateway prefix). */
  readonly tool = input.required<string>();
  /** Gateway-prefixed name, for texts and labels. */
  readonly toolName = input.required<string>();
  /** True right after the return from the fresh MFA: a second step_up_required is then an error, not a loop. */
  readonly mfaReturned = input(false);
  /**
   * The approval that was confirmed in the dialogs before the MFA. It is carried out once, right after the
   * definition is read again, and only when the hash is the one the administrator looked at.
   */
  readonly resume = input<ResumeOf<'approve-tool'> | null>(null);
  /** The resumed approval was handled (carried out or refused), so the page can forget it. */
  readonly resumeHandled = output();
  readonly approved = output();
  /** The definition is no longer pending (approved elsewhere, or gone from the registry). */
  readonly gone = output();

  protected readonly riskName = riskLabel;
  protected readonly noVersion = $localize`:@@admin.noVersion:no version`;
  protected readonly pending = signal<LoadState<PendingTool>>(LOADING);
  protected readonly approving = signal(false);
  protected readonly changedMeanwhile = signal(false);
  /** The definition changed while the administrator was at the IdP; nothing was approved. */
  protected readonly resumeRefused = signal(false);
  private resumeDone = false;
  /** Hash that the gateway refused with 422: it is never approved, so the button stays off for it. */
  private readonly refusedHash = signal<string | null>(null);

  protected readonly view = computed(() => {
    const state = this.pending();
    if (state.status !== 'ready') {
      return null;
    }
    const { approvedEntry, pendingEntry } = state.value;
    const change = riskChange(approvedEntry, pendingEntry);
    const diff = diffDefinitions(approvedEntry, pendingEntry);
    return {
      value: state.value,
      diff,
      riskText: riskChangeText(change, approvedEntry, pendingEntry),
      // The gateway's flag (the risk floor, CC-167) is the authority; the local comparison only adds to it.
      riskLowered: state.value.riskLowered === true || change === 'lowered',
      riskFrom: approvedEntry?.risk ?? null,
      riskTo: pendingEntry.risk ?? null,
      // An adapter entry has no risk of its own: the administrator gives it in the dialog, before the approval.
      fromAdapter: state.value.source === 'adapter',
      previous:
        approvedEntry?.risk && approvedEntry.action
          ? { risk: approvedEntry.risk, action: approvedEntry.action }
          : null,
      hints: annotationHints(pendingEntry),
      // The hash covers more than the diff shows (the definition name, the server's credential block), so an
      // approved tool whose hash changed without a visible line is a change the administrator cannot see.
      hiddenChange:
        approvedEntry !== null &&
        approvedEntry.definitionHash !== state.value.pendingHash &&
        !diff.changed,
      hashConsistent: state.value.pendingHash === pendingEntry.definitionHash,
      isNew: approvedEntry === null,
      fromServer: state.value.source === 'server',
    };
  });
  protected readonly blocked = computed(() => {
    const state = this.pending();
    const view = this.view();
    return (
      state.status === 'ready' &&
      view !== null &&
      (state.value.pendingHash === this.refusedHash() || !view.hashConsistent)
    );
  });

  constructor() {
    effect(() => {
      this.serverId();
      this.tool();
      untracked(() => void this.load());
    });
  }

  protected async load(): Promise<void> {
    this.pending.set(LOADING);
    try {
      // Read as text: a number beyond 2^53 must reach the diff as written, not rounded by JSON.parse.
      const body = await firstValueFrom(
        this.http.get(
          `/api/v1/admin/registry/servers/${encodeURIComponent(this.serverId())}/tools/${encodeURIComponent(this.tool())}/pending`,
          { responseType: 'text' },
        ),
      );
      this.pending.set({ status: 'ready', value: parseKeepingNumbers<PendingTool>(body) });
      await this.resumeApproval();
    } catch (error) {
      const failure = toApiFailure(error);
      this.pending.set({ status: 'error', failure });
      if (failure.code === 'not_found_or_denied') {
        this.gone.emit();
      }
    }
  }

  protected async approve(): Promise<void> {
    const state = this.pending();
    const view = this.view();
    if (state.status !== 'ready' || !view || this.approving() || this.blocked()) {
      return;
    }
    if (view.fromServer && !(await this.confirmServerSource())) {
      return;
    }
    if (view.hiddenChange && !(await this.confirmHiddenChange())) {
      return;
    }
    if (!view.fromAdapter) {
      if (view.riskLowered && !(await this.confirmRiskLowering(view.riskFrom, view.riskTo))) {
        return;
      }
      await this.send(null, view.riskLowered);
      return;
    }
    await this.approveClassified(view);
  }

  /**
   * A tool of an adapter is approved together with the classification the administrator gives it. The gateway may still
   * refuse the pair (422), and the dialog then opens again with the choice and the reason, so nothing has to be retyped.
   */
  private async approveClassified(view: NonNullable<ReturnType<typeof this.view>>): Promise<void> {
    let retry: ClassifyDialogData['retry'] = null;
    for (;;) {
      const choice = await this.askClassification(view, retry);
      if (!choice) {
        return;
      }
      // A lower classification than the one given earlier is a lowering like any other (CC-167): the fresh MFA comes first.
      const lowering =
        view.riskLowered ||
        (view.riskFrom !== null && RISK_ORDER[choice.risk] < RISK_ORDER[view.riskFrom]);
      if (lowering && !(await this.confirmRiskLowering(view.riskFrom, choice.risk))) {
        return;
      }
      let outcome = await this.send(choice, lowering);
      if (outcome.kind === 'lowering-required') {
        // The gateway did not flag the entry (riskLowered), yet refuses the classification as a lowering (422 risk_lowered):
        // it is one, so the administrator confirms it and the request goes again with acceptRiskLowering (and the fresh MFA).
        if (!(await this.confirmRiskLowering(view.riskFrom, choice.risk))) {
          return;
        }
        outcome = await this.send(choice, true);
      }
      if (outcome.kind !== 'classification-refused') {
        return;
      }
      retry = { choice, message: outcome.message };
    }
  }

  private async askClassification(
    view: NonNullable<ReturnType<typeof this.view>>,
    retry: ClassifyDialogData['retry'],
  ): Promise<Classification | null> {
    const chosen = await firstValueFrom(
      this.dialog
        .open<ClassifyDialog, ClassifyDialogData, Classification>(ClassifyDialog, {
          data: { toolName: this.toolName(), hints: view.hints, previous: view.previous, retry },
        })
        .afterClosed(),
    );
    return chosen ?? null;
  }

  private async resumeApproval(): Promise<void> {
    const intent = this.resume();
    if (
      !intent ||
      this.resumeDone ||
      intent.serverId !== this.serverId() ||
      intent.tool !== this.tool()
    ) {
      return;
    }
    this.resumeDone = true;
    const state = this.pending();
    const view = this.view();
    const same =
      state.status === 'ready' &&
      view !== null &&
      !this.blocked() &&
      state.value.pendingHash === intent.hash &&
      // A lowering that was confirmed stays confirmed only if the definition still lowers the risk.
      (view.fromAdapter
        ? intent.classification !== undefined
        : intent.classification === undefined && view.riskLowered === intent.acceptRiskLowering);
    if (same) {
      await this.send(intent.classification ?? null, intent.acceptRiskLowering);
    } else {
      this.resumeRefused.set(true);
    }
    this.resumeHandled.emit();
  }

  /** The request itself, after every dialog was answered (now or before the MFA). */
  private async send(classification: Classification | null, lowering: boolean): Promise<Outcome> {
    const state = this.pending();
    const view = this.view();
    if (state.status !== 'ready' || !view || this.approving()) {
      return { kind: 'stopped' };
    }
    this.approving.set(true);
    this.changedMeanwhile.set(false);
    const approvedHash = state.value.pendingHash;
    try {
      await firstValueFrom(
        this.adminApi.approveAdminTool(this.serverId(), this.tool(), {
          definitionHash: approvedHash,
          // Sent only when true: an older gateway rejects the field.
          ...(lowering ? { acceptRiskLowering: true } : {}),
          ...(classification ?? {}),
        }),
      );
      this.approved.emit();
      return { kind: 'done' };
    } catch (error) {
      const failure = toApiFailure(error);
      if (failure.code === 'hash_mismatch') {
        await this.load();
        this.changedMeanwhile.set(true);
      } else if (failure.code === 'step_up_required' && !this.mfaReturned()) {
        this.resumeStore.save(
          {
            kind: 'approve-tool',
            serverId: this.serverId(),
            tool: this.tool(),
            hash: approvedHash,
            acceptRiskLowering: lowering,
            ...(classification ? { classification } : {}),
          },
          this.session.username(),
        );
        this.navigation.assign(
          stepUpUrlFor(failure.stepUpUrl, `${ADMIN_PATH}?mfa=ok`, this.navigation.origin),
        );
      } else if (
        failure.code === 'manifest_rejected' &&
        classification &&
        failure.reason &&
        CLASSIFICATION_REASONS.has(failure.reason)
      ) {
        return { kind: 'classification-refused', message: failureMessage(failure) };
      } else if (
        failure.code === 'manifest_rejected' &&
        failure.reason === 'risk_lowered' &&
        classification &&
        !lowering
      ) {
        return { kind: 'lowering-required' };
      } else if (failure.code === 'manifest_rejected') {
        this.refusedHash.set(approvedHash);
        this.notifications.failure(failure);
      } else if (failure.code === 'not_found_or_denied') {
        this.gone.emit();
      } else {
        this.notifications.failure(failure);
      }
      return { kind: 'stopped' };
    } finally {
      this.approving.set(false);
    }
  }

  private async confirmRiskLowering(from: Risk | null, to: Risk | null): Promise<boolean> {
    const name = this.toolName();
    const target = to ? riskLabel(to) : riskOrUnclassified(undefined);
    const change = from
      ? $localize`:@@admin.riskLoweringConfirm.change:from ${riskLabel(from)}:from: to ${target}:to:`
      : $localize`:@@admin.riskLoweringConfirm.floor:below the highest level reported so far (now ${target}:to:)`;
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: {
            title: $localize`:@@admin.riskLoweringConfirm.title:Approve risk lowering?`,
            message: $localize`:@@admin.riskLoweringConfirm.message:The tool ${name}:tool: lowers its risk ${change}:change:. After approval the new level takes effect, and for tools that were irreversible a code from the Authenticator is no longer required. Approve only if the change is intended.`,
            confirmLabel: $localize`:@@admin.riskLoweringConfirm.confirm:Approve risk lowering`,
            destructive: true,
          },
        })
        .afterClosed(),
    );
    return confirmed === true;
  }

  private async confirmHiddenChange(): Promise<boolean> {
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: {
            title: $localize`:@@admin.hiddenConfirm.title:Approve a change you cannot see?`,
            message: $localize`:@@admin.hiddenConfirm.message:The definition hash is different, but no shown line changed. The change concerns an element outside the view, for example the server credential. Approve only if you know the reason.`,
            confirmLabel: $localize`:@@admin.hiddenConfirm.confirm:Approve anyway`,
            destructive: true,
          },
        })
        .afterClosed(),
    );
    return confirmed === true;
  }

  private async confirmServerSource(): Promise<boolean> {
    const name = this.toolName();
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: {
            title: $localize`:@@admin.serverConfirm.title:Approve a definition reported by the server?`,
            message: $localize`:@@admin.serverConfirm.message:A running server presented the definition of ${name}:tool:, not the CI pipeline. Nobody reviewed it in code. Approve it only if the description and schema match what you expect.`,
            confirmLabel: $localize`:@@admin.serverConfirm.confirm:Approve`,
            destructive: true,
          },
        })
        .afterClosed(),
    );
    return confirmed === true;
  }
}
