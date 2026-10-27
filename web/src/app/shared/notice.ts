import { ChangeDetectionStrategy, Component, input } from '@angular/core';

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
      <ng-content />
    </div>
  `,
  styleUrl: './notice.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Notice {
  readonly kind = input<NoticeKind>('info');
}
