import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import { AccessRequest, AccessRequestStatus, AccessRequestsService } from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { isAllowedRedirect } from '../../core/auth-urls';
import { ConnectionActions } from '../../core/connection-actions.service';
import { LOADING, LoadState } from '../../core/load-state';
import { ErrorNotice } from '../../shared/error-notice';
import { Tone } from '../../shared/labels';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';
import { entitlementTitle } from './entitlement-labels';

const STATUS: Record<AccessRequestStatus, { label: () => string; tone: Tone }> = {
  pending: { label: () => $localize`:@@request.status.pending:Oczekuje`, tone: 'warn' },
  approved: { label: () => $localize`:@@request.status.approved:Zaakceptowany`, tone: 'ok' },
  rejected: { label: () => $localize`:@@request.status.rejected:Odrzucony`, tone: 'error' },
  cancelled: { label: () => $localize`:@@request.status.cancelled:Anulowany`, tone: 'neutral' },
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
  imports: [DatePipe, MatButtonModule, ErrorNotice, LoadError, Loading, Notice],
  templateUrl: './requests-page.html',
  styleUrl: './requests-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestsPage {
  private readonly api = inject(AccessRequestsService);
  private readonly actions = inject(ConnectionActions);

  protected readonly requests = signal<LoadState<AccessRequest[]>>(LOADING);
  protected readonly done = signal<string | null>(null);
  protected readonly failure = signal<ApiFailure | null>(null);

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
    this.failure.set(null);
    const result = await this.actions.requestWithChoice(null);
    if (result?.kind === 'created') {
      this.done.set(
        $localize`:@@requests.created:Wniosek ${result.requestId}:id: jest w systemie uprawnień. Jego stan sprawdzisz tutaj.`,
      );
      await this.load();
    }
  }
}
