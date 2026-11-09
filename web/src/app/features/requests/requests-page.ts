import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import {
  AccessRequest,
  AccessRequestStatus,
  AccessRequestsService,
  CatalogService,
} from '../../api/generated';
import { toApiFailure } from '../../core/api-error';
import { NotificationService } from '../../core/notification.service';
import { isAllowedRedirect } from '../../core/auth-urls';
import { ConnectionActions } from '../../core/connection-actions.service';
import { LOADING, LoadState } from '../../core/load-state';
import { Tone, catalogNames } from '../../shared/labels';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { StateLine } from '../../shared/state-line';
import { SafeTextPipe } from '../../shared/safe-text.pipe';
import { neutraliseText } from '../../shared/untrusted-text';
import { entitlementTitle } from './entitlement-labels';

const STATUS: Record<AccessRequestStatus, { label: () => string; tone: Tone }> = {
  pending: { label: () => $localize`:@@request.status.pending:Pending`, tone: 'warn' },
  approved: { label: () => $localize`:@@request.status.approved:Approved`, tone: 'ok' },
  rejected: { label: () => $localize`:@@request.status.rejected:Rejected`, tone: 'error' },
  cancelled: { label: () => $localize`:@@request.status.cancelled:Cancelled`, tone: 'neutral' },
};

export function requestStatusLabel(status: AccessRequestStatus): string {
  return STATUS[status].label();
}

interface RequestRow {
  request: AccessRequest;
  title: string | null;
  status: string;
  tone: Tone;
  /** The IGA's own page for the request, only when it is a URL the portal may open. */
  openUrl: string | null;
}

/** "Wnioski" (mockup 17): the user's requests from the IGA and the way to file a new one. */
@Component({
  selector: 'app-requests-page',
  imports: [SafeTextPipe, DatePipe, MatButtonModule, LoadError, Loading, StateLine],
  templateUrl: './requests-page.html',
  styleUrl: './requests-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestsPage {
  private readonly api = inject(AccessRequestsService);
  private readonly notifications = inject(NotificationService);
  private readonly actions = inject(ConnectionActions);
  private readonly catalogApi = inject(CatalogService);
  /** Names of the systems from the catalog, read after the list; without them the identifiers are shown. */
  private readonly names = signal<ReadonlyMap<string, string>>(new Map());
  /**
   * Whether some server of the catalog can be asked for access. The dialog offers only systems of the catalog, and
   * the BFF puts request_access there only when the IGA takes requests, so without one there is nothing to submit.
   * A failed catalog read leaves the button: it must not hide on a guess.
   */
  protected readonly canSubmit = signal(true);
  /** The list is shown only after this, so the button or the note about the administrator never swaps in late. */
  private readonly catalogRead = this.loadNames();

  protected readonly requests = signal<LoadState<AccessRequest[]>>(LOADING);

  protected readonly rows = computed<RequestRow[]>(() => {
    const state = this.requests();
    if (state.status !== 'ready') {
      return [];
    }
    return [...state.value]
      .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))
      .map((request) => ({
        request,
        title: entitlementTitle(request.entitlement, this.names()),
        status: requestStatusLabel(request.status),
        tone: STATUS[request.status].tone,
        openUrl:
          request.requestUrl && isAllowedRedirect(request.requestUrl) ? request.requestUrl : null,
      }));
  });

  constructor() {
    void this.load();
  }

  private async loadNames(): Promise<void> {
    try {
      const servers = (await firstValueFrom(this.catalogApi.getPortalCatalog())).servers;
      this.names.set(catalogNames(servers));
      this.canSubmit.set(
        servers.some(
          (server) =>
            server.actions.includes('request_access') || server.actions.includes('view_request'),
        ),
      );
    } catch {
      // The names are an addition; the page shows the identifiers without them.
    }
  }

  protected async load(): Promise<void> {
    this.requests.set(LOADING);
    try {
      const list = await firstValueFrom(this.api.listAccessRequests());
      await this.catalogRead;
      this.requests.set({ status: 'ready', value: list });
    } catch (error) {
      this.requests.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  protected async newRequest(): Promise<void> {
    const result = await this.actions.requestWithChoice(null);
    if (result?.kind === 'created') {
      this.notifications.success(
        $localize`:@@requests.created:Request ${neutraliseText(result.requestId).text}:id: submitted.`,
      );
      await this.load();
    }
  }
}
