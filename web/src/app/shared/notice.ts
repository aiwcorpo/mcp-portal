import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type NoticeKind = 'success' | 'error' | 'info';

/**
 * Inline message. Errors use role=alert so screen readers announce them at once; the rest use
 * role=status, which waits for the reader to finish.
 */
@Component({
  selector: 'app-notice',
  template: `
    <div
      class="notice"
      [class]="'notice-' + kind()"
      [attr.role]="kind() === 'error' ? 'alert' : 'status'"
    >
      <div class="body"><ng-content /></div>
      @if (dismissible()) {
        <button
          type="button"
          class="close"
          i18n-aria-label="@@notice.close"
          aria-label="Zamknij komunikat"
          (click)="dismiss.emit()"
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
            <path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
      }
    </div>
  `,
  styleUrl: './notice.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Notice {
  readonly kind = input<NoticeKind>('info');
  readonly dismissible = input(false);
  readonly dismiss = output();
}
