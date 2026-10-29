import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AccessRequestsService } from '../api/generated';
import { ApiFailure, toApiFailure } from './api-error';
import { isAllowedRedirect } from './auth-urls';
import { BrowserNavigation } from './browser-navigation';

export type AccessRequestResult =
  | { kind: 'redirected' }
  | { kind: 'created'; requestId: string }
  | { kind: 'unavailable' }
  | { kind: 'failed'; failure: ApiFailure };

@Injectable({ providedIn: 'root' })
export class AccessRequestFlow {
  private readonly accessRequestsApi = inject(AccessRequestsService);
  private readonly navigation = inject(BrowserNavigation);

  /**
   * The IGA either hands back a form to open (https only) or creates the request itself (C13). A request
   * that is already pending answers with the id of that one (CC-096), so `created` means "there is a
   * request with this id", not "a new one was made".
   */
  async createRequest(entitlement: string): Promise<AccessRequestResult> {
    try {
      const result = await firstValueFrom(
        this.accessRequestsApi.createAccessRequest({ entitlement }),
      );
      if ('requestUrl' in result) {
        if (!isAllowedRedirect(result.requestUrl)) {
          return { kind: 'failed', failure: { code: 'internal_error', status: 200 } };
        }
        this.navigation.assign(result.requestUrl);
        return { kind: 'redirected' };
      }
      return { kind: 'created', requestId: result.requestId };
    } catch (error) {
      return { kind: 'failed', failure: toApiFailure(error) };
    }
  }
}
