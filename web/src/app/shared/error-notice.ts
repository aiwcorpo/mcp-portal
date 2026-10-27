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
    button {
      margin-top: 8px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorNotice {
  readonly failure = input.required<ApiFailure>();
  readonly retryable = input(false);
  readonly retry = output();
  protected readonly message = computed(() => failureMessage(this.failure()));
}
