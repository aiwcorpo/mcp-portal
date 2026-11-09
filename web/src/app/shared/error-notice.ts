import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ApiFailure } from '../core/api-error';
import { failureMessage } from '../core/error-messages';
import { StateLine } from './state-line';
import { neutraliseText } from './untrusted-text';

/** Renders an API failure through its code; the only backend text shown is the `message` of a rejected administrator write, neutralised. */
@Component({
  selector: 'app-error-notice',
  imports: [StateLine],
  template: `
    <app-state kind="error">
      <span class="message">{{ message() }}</span>
      @if (detail(); as text) {
        <p class="detail">{{ text }}</p>
      }
      @if (requestRef(); as ref) {
        <p class="request-ref">
          <ng-container i18n="@@common.requestRef">Reference for support:</ng-container>
          <code>{{ ref }}</code>
        </p>
      }
      @if (retryable()) {
        <span aria-hidden="true"> &middot; </span>
        <button type="button" class="action" (click)="retry.emit()" i18n="@@common.retry">
          Try again
        </button>
      }
    </app-state>
  `,
  styles: `
    .message {
      margin: 0;
    }
    .detail {
      margin: 6px 0 0;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      unicode-bidi: isolate;
    }
    .request-ref {
      margin-top: 6px;
      color: var(--pm-muted);
      font-size: 12px;
    }
    .request-ref code {
      margin-left: 0.4em;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorNotice {
  readonly failure = input.required<ApiFailure>();
  readonly retryable = input(false);
  readonly retry = output();
  protected readonly message = computed(() => failureMessage(this.failure()));
  /** The gateway's own words for a rejected administrator write, as inert text; the page's own text stays above it. */
  protected readonly detail = computed(() => {
    const message = this.failure().message;
    return message ? neutraliseText(message).text : null;
  });
  protected readonly requestRef = computed(() => requestReference(this.failure()));
}

/** First 8 characters of the request id, as the contract asks the UI to show next to an error (CC-087). */
export function requestReference(failure: ApiFailure): string | null {
  return failure.requestId ? failure.requestId.slice(0, 8) : null;
}
