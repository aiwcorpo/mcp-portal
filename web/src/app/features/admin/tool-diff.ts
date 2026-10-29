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
import { AdminService, PendingTool, Risk, ServerId } from '../../api/generated';
import { parseKeepingNumbers } from './raw-json';
import { SafeTextPipe } from '../../shared/safe-text.pipe';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { LOADING, LoadState } from '../../core/load-state';
import { stepUpUrlFor } from '../../core/auth-urls';
import { BrowserNavigation } from '../../core/browser-navigation';
import { ConfirmDialog, ConfirmDialogData } from '../../shared/confirm-dialog';
import { ErrorNotice } from '../../shared/error-notice';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';
import { riskLabel } from '../../shared/labels';
import { ADMIN_PATH } from './admin-path';
import { diffDefinitions, riskChange, riskChangeText } from './definition-diff';

/**
 * The approved and the pending definition of one tool, side by side, and the approval of the pending one.
 * The approval carries the hash that was shown, so a definition that changed meanwhile is refused (409) and
 * the diff is read again instead of approving something nobody looked at.
 */
@Component({
  selector: 'app-tool-diff',
  imports: [SafeTextPipe, MatButtonModule, ErrorNotice, LoadError, Loading, Notice],
  templateUrl: './tool-diff.html',
  styleUrl: './tool-diff.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolDiff {
  private readonly adminApi = inject(AdminService);
  private readonly http = inject(HttpClient);
  private readonly navigation = inject(BrowserNavigation);
  private readonly dialog = inject(MatDialog);

  readonly serverId = input.required<ServerId>();
  /** Tool name in the registry (without the gateway prefix). */
  readonly tool = input.required<string>();
  /** Gateway-prefixed name, for texts and labels. */
  readonly toolName = input.required<string>();
  /** True right after the return from the fresh MFA: a second step_up_required is then an error, not a loop. */
  readonly mfaReturned = input(false);
  readonly approved = output();
  /** The definition is no longer pending (approved elsewhere, or gone from the registry). */
  readonly gone = output();

  protected readonly riskName = riskLabel;
  protected readonly noVersion = $localize`:@@admin.noVersion:brak wersji`;
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
    const diff = diffDefinitions(approvedEntry, pendingEntry);
    return {
      value: state.value,
      diff,
      riskText: riskChangeText(change, approvedEntry, pendingEntry),
      // The gateway's flag (the risk floor, CC-167) is the authority; the local comparison only adds to it.
      riskLowered: state.value.riskLowered === true || change === 'lowered',
      riskFrom: approvedEntry?.risk ?? null,
      riskTo: pendingEntry.risk,
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
    this.failure.set(null);
    try {
      // Read as text: a number beyond 2^53 must reach the diff as written, not rounded by JSON.parse.
      const body = await firstValueFrom(
        this.http.get(
          `/api/v1/admin/registry/servers/${encodeURIComponent(this.serverId())}/tools/${encodeURIComponent(this.tool())}/pending`,
          { responseType: 'text' },
        ),
      );
      this.pending.set({ status: 'ready', value: parseKeepingNumbers<PendingTool>(body) });
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
    if (view.riskLowered && !(await this.confirmRiskLowering(view.riskFrom, view.riskTo))) {
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
          // Sent only when true: an older gateway rejects the field.
          ...(view.riskLowered ? { acceptRiskLowering: true } : {}),
        }),
      );
      this.approved.emit();
    } catch (error) {
      const failure = toApiFailure(error);
      if (failure.code === 'hash_mismatch') {
        await this.load();
        this.changedMeanwhile.set(true);
      } else if (failure.code === 'step_up_required' && !this.mfaReturned()) {
        this.navigation.assign(
          stepUpUrlFor(failure.stepUpUrl, `${ADMIN_PATH}?mfa=ok`, this.navigation.origin),
        );
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

  private async confirmRiskLowering(from: Risk | null, to: Risk): Promise<boolean> {
    const name = this.toolName();
    const change = from
      ? $localize`:@@admin.riskLoweringConfirm.change:z ${riskLabel(from)}:from: na ${riskLabel(to)}:to:`
      : $localize`:@@admin.riskLoweringConfirm.floor:poniżej najwyższego dotąd zgłoszonego poziomu (teraz ${riskLabel(to)}:to:)`;
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: {
            title: $localize`:@@admin.riskLoweringConfirm.title:Zatwierdzić obniżenie ryzyka?`,
            message: $localize`:@@admin.riskLoweringConfirm.message:Narzędzie ${name}:tool: obniża ryzyko ${change}:change:. Po zatwierdzeniu nowy poziom staje się obowiązujący, a dla narzędzi, które były nieodwracalne, przestaje być wymagany kod z Authenticatora. Zatwierdź tylko, jeśli zmiana jest zamierzona.`,
            confirmLabel: $localize`:@@admin.riskLoweringConfirm.confirm:Zatwierdź obniżenie ryzyka`,
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
            title: $localize`:@@admin.hiddenConfirm.title:Zatwierdzić zmianę, której nie widać?`,
            message: $localize`:@@admin.hiddenConfirm.message:Skrót definicji jest inny, a żadna pokazana linia się nie zmieniła. Zmiana dotyczy elementu spoza widoku, na przykład poświadczenia serwera. Zatwierdź tylko, jeśli znasz jej przyczynę.`,
            confirmLabel: $localize`:@@admin.hiddenConfirm.confirm:Zatwierdź mimo to`,
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
