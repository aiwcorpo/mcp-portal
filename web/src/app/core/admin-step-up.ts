import { Injectable, inject } from '@angular/core';
import { ApiFailure } from './api-error';
import { stepUpUrlFor } from './auth-urls';
import { BrowserNavigation } from './browser-navigation';
import { DRAFT_MAX, ResumeIntentStore } from './resume-intent';
import { SessionService } from './session.service';

/**
 * What every write of the administration does with `401 step_up_required`: remember the unsaved form (without secrets)
 * and send the browser to the IdP for a fresh MFA, with the same page as the return address. After the return the page
 * takes the draft back with {@link takeDraft}; the administrator saves again, once.
 */
@Injectable({ providedIn: 'root' })
export class AdminStepUp {
  private readonly navigation = inject(BrowserNavigation);
  private readonly resumeStore = inject(ResumeIntentStore);
  private readonly session = inject(SessionService);

  /**
   * True when the browser is on its way to the IdP; false when the failure is no step-up request, or when the page was
   * itself reached by a return from the IdP (`returned`): a second request then means the login was no MFA, and the
   * page shows the error instead of sending the administrator round again.
   */
  redirectIfRequired(
    failure: ApiFailure,
    page: string,
    draft?: unknown,
    returned = false,
  ): boolean {
    if (failure.code !== 'step_up_required' || returned) {
      return false;
    }
    if (draft !== undefined) {
      const text = JSON.stringify(draft);
      if (text.length <= DRAFT_MAX) {
        this.resumeStore.save({ kind: 'admin-draft', page, draft: text }, this.session.username());
      }
    }
    this.navigation.assign(
      stepUpUrlFor(failure.stepUpUrl, `${page}?mfa=ok`, this.navigation.origin),
    );
    return true;
  }

  /** The form kept before the step-up of this page, or null (another page, another user, too old, nothing kept). */
  takeDraft<T>(page: string): T | null {
    const intent = this.resumeStore.take('admin-draft', this.session.username());
    if (!intent || intent.page !== page) {
      return null;
    }
    try {
      return JSON.parse(intent.draft) as T;
    } catch {
      return null;
    }
  }
}
