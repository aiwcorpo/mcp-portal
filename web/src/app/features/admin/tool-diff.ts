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
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { AdminService, PendingTool, ServerId } from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { LOADING, LoadState } from '../../core/load-state';
import { ConfirmDialog, ConfirmDialogData } from '../../shared/confirm-dialog';
import { ErrorNotice } from '../../shared/error-notice';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';
import { diffDefinitions, riskChange, riskChangeText } from './definition-diff';

/**
 * The approved and the pending definition of one tool, side by side, and the approval of the pending one.
 * The approval carries the hash that was shown, so a definition that changed meanwhile is refused (409) and
 * the diff is read again instead of approving something nobody looked at.
 */
@Component({
  selector: 'app-tool-diff',
  imports: [MatButtonModule, ErrorNotice, LoadError, Loading, Notice],
  templateUrl: './tool-diff.html',
  styleUrl: './tool-diff.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolDiff {
  private readonly adminApi = inject(AdminService);
  private readonly dialog = inject(MatDialog);

  readonly serverId = input.required<ServerId>();
  /** Tool name in the registry (without the gateway prefix). */
  readonly tool = input.required<string>();
  /** Gateway-prefixed name, for texts and labels. */
  readonly toolName = input.required<string>();
  readonly approved = output();
  /** The definition is no longer pending (approved elsewhere, or gone from the registry). */
  readonly gone = output();

  protected readonly pending = signal<LoadState<PendingTool>>(LOADING);
  protected readonly approving = signal(false);
  protected readonly failure = signal<ApiFailure | null>(null);
  protected readonly changedMeanwhile = signal(false);
  /** Hash that the gateway refused with 422: it is never approved, so the button stays off for it. */
  private readonly refusedHash = signal<string | null>(null);

  protected readonly view = computed(() => {
    const state = this.pending();
    if (state.status !== 'ready') {
      return null;
    }
    const { approvedEntry, pendingEntry } = state.value;
    const change = riskChange(approvedEntry, pendingEntry);
    return {
      value: state.value,
      diff: diffDefinitions(approvedEntry, pendingEntry),
      riskText: riskChangeText(change, approvedEntry, pendingEntry),
      riskLowered: change === 'lowered',
      isNew: approvedEntry === null,
      fromServer: state.value.source === 'server',
    };
  });
  protected readonly blocked = computed(() => {
    const state = this.pending();
    return state.status === 'ready' && state.value.pendingHash === this.refusedHash();
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
    this.failure.set(null);
    try {
      const pending = await firstValueFrom(
        this.adminApi.getAdminPendingTool(this.serverId(), this.tool()),
      );
      this.pending.set({ status: 'ready', value: pending });
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
    this.approving.set(true);
    this.failure.set(null);
    this.changedMeanwhile.set(false);
    const approvedHash = state.value.pendingHash;
    try {
      await firstValueFrom(
        this.adminApi.approveAdminTool(this.serverId(), this.tool(), {
          definitionHash: approvedHash,
        }),
      );
      this.approved.emit();
    } catch (error) {
      const failure = toApiFailure(error);
      if (failure.code === 'hash_mismatch') {
        await this.load();
        this.changedMeanwhile.set(true);
      } else if (failure.code === 'manifest_rejected') {
        this.refusedHash.set(approvedHash);
        this.failure.set(failure);
      } else if (failure.code === 'not_found_or_denied') {
        this.gone.emit();
      } else {
        this.failure.set(failure);
      }
    } finally {
      this.approving.set(false);
    }
  }

  private async confirmServerSource(): Promise<boolean> {
    const name = this.toolName();
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: {
            title: $localize`:@@admin.serverConfirm.title:Zatwierdzić definicję zgłoszoną przez serwer?`,
            message: $localize`:@@admin.serverConfirm.message:Definicję ${name}:tool: przedstawił działający serwer, nie potok CI. Nikt nie przeglądał jej w kodzie. Zatwierdź ją tylko, jeśli opis i schemat są zgodne z oczekiwanym.`,
            confirmLabel: $localize`:@@admin.serverConfirm.confirm:Zatwierdź`,
            destructive: true,
          },
        })
        .afterClosed(),
    );
    return confirmed === true;
  }
}
