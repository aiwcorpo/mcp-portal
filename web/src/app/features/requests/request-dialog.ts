import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import { AccessRequestsService, CatalogService, RequestableEntitlement } from '../../api/generated';
import { AccessRequestFlow, AccessRequestResult } from '../../core/access-request-flow';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { LOADING, LoadState } from '../../core/load-state';
import { ErrorNotice } from '../../shared/error-notice';
import { isSystemId, systemName } from '../../shared/labels';
import { SafeTextPipe } from '../../shared/safe-text.pipe';
import { neutraliseText } from '../../shared/untrusted-text';
import { entitlementTitle } from './entitlement-labels';

export interface RequestDialogData {
  /** Preselected system (a server row); null lets the user choose it (the requests page). */
  system: string | null;
}

/**
 * "Submit request" (mockup 18): the entitlements come from the IGA catalog of the chosen system (CC-154) and the
 * description is text of that system, shown as text only. The request itself is then either created or the
 * browser is sent to the IGA form, whatever the adapter does.
 */
@Component({
  selector: 'app-request-dialog',
  imports: [SafeTextPipe, MatDialogModule, MatButtonModule, ErrorNotice],
  templateUrl: './request-dialog.html',
  styleUrl: './request-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestDialog {
  private readonly accessRequestsApi = inject(AccessRequestsService);
  private readonly catalogApi = inject(CatalogService);
  private readonly flow = inject(AccessRequestFlow);
  private readonly dialogRef =
    inject<MatDialogRef<RequestDialog, AccessRequestResult>>(MatDialogRef);
  private readonly data = inject<RequestDialogData>(MAT_DIALOG_DATA);

  /** The systems of the catalog the user sees: runtime data of the gateway, read only when the dialog lets the user choose. */
  protected readonly systems = signal<readonly string[]>([]);
  protected readonly systemName = systemName;
  protected readonly systemChoice = this.data.system === null;
  protected readonly system = signal<string | null>(this.data.system);
  protected readonly entitlements = signal<LoadState<RequestableEntitlement[]> | null>(null);
  protected readonly chosen = signal<string | null>(null);
  protected readonly sending = signal(false);
  protected readonly failure = signal<ApiFailure | null>(null);

  protected readonly options = computed(() => {
    const state = this.entitlements();
    return state?.status === 'ready'
      ? state.value.map((item) => ({
          entitlement: item.entitlement,
          title: entitlementTitle(item.entitlement),
        }))
      : [];
  });
  protected readonly loadFailure = computed(() => {
    const state = this.entitlements();
    return state?.status === 'error' ? state.failure : null;
  });
  protected readonly description = computed(() => {
    const state = this.entitlements();
    const chosen = this.chosen();
    if (state?.status !== 'ready' || chosen === null) {
      return null;
    }
    const text = state.value.find((item) => item.entitlement === chosen)?.description;
    return text ? neutraliseText(text) : null;
  });

  private loadCounter = 0;

  constructor() {
    const initial = this.system();
    if (initial) {
      untracked(() => void this.load(initial));
    } else {
      void this.loadSystems();
    }
  }

  private async loadSystems(): Promise<void> {
    try {
      const catalog = await firstValueFrom(this.catalogApi.getPortalCatalog());
      this.systems.set([...new Set(catalog.servers.map((server) => server.system))].sort());
    } catch (error) {
      this.failure.set(toApiFailure(error));
    }
  }

  protected onSystem(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.failure.set(null);
    this.chosen.set(null);
    if (isSystemId(value)) {
      this.system.set(value);
      void this.load(value);
    } else {
      this.system.set(null);
      this.entitlements.set(null);
    }
  }

  protected onEntitlement(event: Event): void {
    this.chosen.set((event.target as HTMLSelectElement).value || null);
  }

  protected async load(system: string): Promise<void> {
    const attempt = ++this.loadCounter;
    this.entitlements.set(LOADING);
    try {
      const list = await firstValueFrom(this.accessRequestsApi.listRequestableEntitlements(system));
      if (attempt === this.loadCounter) {
        this.entitlements.set({ status: 'ready', value: list });
        this.chosen.set(list.length === 1 ? list[0].entitlement : null);
      }
    } catch (error) {
      if (attempt === this.loadCounter) {
        this.entitlements.set({ status: 'error', failure: toApiFailure(error) });
      }
    }
  }

  protected async submit(): Promise<void> {
    const entitlement = this.chosen();
    if (!entitlement || this.sending()) {
      return;
    }
    this.sending.set(true);
    this.failure.set(null);
    const result = await this.flow.createRequest(entitlement);
    this.sending.set(false);
    if (result.kind === 'failed') {
      this.failure.set(result.failure);
    } else {
      this.dialogRef.close(result);
    }
  }
}
