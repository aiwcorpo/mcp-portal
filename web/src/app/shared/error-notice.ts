import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ApiFailure } from '../core/api-error';
import { failureMessage } from '../core/error-messages';
import { Notice } from './notice';

/** Renders an API failure through its code only; backend `message` text is never shown. */
@Component({
  selector: 'app-error-notice',
  imports: [Notice, MatButtonModule],
  template: `
    <app-notice kind="error">
      <p class="message">{{ message() }}</p>
      @if (requestRef(); as ref) {
        <p class="request-ref">
          <ng-container i18n="@@common.requestRef">Identyfikator do zgłoszenia:</ng-container>
          <code>{{ ref }}</code>
        </p>
      }
      @if (retryable()) {
        <button mat-stroked-button type="button" (click)="retry.emit()" i18n="@@common.retry">
          Spróbuj ponownie
        </button>
      }
    </app-notice>
  `,
  styles: `
    .message {
      margin: 0;
    }
    .request-ref {
      margin-top: 6px;
      color: var(--pm-muted);
      font-size: 12px;
    }
    .request-ref code {
      margin-left: 0.4em;
    }
    button {
      margin-top: 10px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorNotice {
  readonly failure = input.required<ApiFailure>();
  readonly retryable = input(false);
  readonly retry = output();
  protected readonly message = computed(() => failureMessage(this.failure()));
  protected readonly requestRef = computed(() => requestReference(this.failure()));
}

/** First 8 characters of the request id, as the contract asks the UI to show next to an error (CC-087). */
export function requestReference(failure: ApiFailure): string | null {
  return failure.requestId ? failure.requestId.slice(0, 8) : null;
}
