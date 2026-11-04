import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import { AccessRequest, AccessRequestStatus, AccessRequestsService } from '../../api/generated';
import { toApiFailure } from '../../core/api-error';
import { isAllowedRedirect } from '../../core/auth-urls';
import { ConnectionActions } from '../../core/connection-actions.service';
import { LOADING, LoadState } from '../../core/load-state';
import { Tone } from '../../shared/labels';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';
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
  imports: [SafeTextPipe, DatePipe, MatButtonModule, LoadError, Loading, Notice],
  templateUrl: './requests-page.html',
  styleUrl: './requests-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestsPage {
  private readonly api = inject(AccessRequestsService);
  private readonly actions = inject(ConnectionActions);

  protected readonly requests = signal<LoadState<AccessRequest[]>>(LOADING);
  protected readonly done = signal<string | null>(null);

  protected readonly rows = computed<RequestRow[]>(() => {
    const state = this.requests();
    if (state.status !== 'ready') {
      return [];
    }
    return [...state.value]
      .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))
      .map((request) => ({
        request,
        title: entitlementTitle(request.entitlement),
        status: requestStatusLabel(request.status),
        tone: STATUS[request.status].tone,
        openUrl:
          request.requestUrl && isAllowedRedirect(request.requestUrl) ? request.requestUrl : null,
      }));
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.requests.set(LOADING);
    try {
      const list = await firstValueFrom(this.api.listAccessRequests());
      this.requests.set({ status: 'ready', value: list });
    } catch (error) {
      this.requests.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  protected async newRequest(): Promise<void> {
    this.done.set(null);
    const result = await this.actions.requestWithChoice(null);
    if (result?.kind === 'created') {
      this.done.set(
        $localize`:@@requests.created:Request ${neutraliseText(result.requestId).text}:id: is in the entitlement system. You can check its status here.`,
      );
      await this.load();
    }
  }
}
