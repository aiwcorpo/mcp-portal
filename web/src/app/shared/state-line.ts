import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { StateIcon, StateKind } from './state-icon';

/**
 * A state that lasts, shown next to the element it concerns: icon, one sentence and, after " · ", an optional
 * link or action (mockups 40 and 44). It is not a notification and has no box. Errors use role=alert so screen
 * readers announce them at once; the rest use role=status.
 */
@Component({
  selector: 'app-state',
  imports: [StateIcon],
  template: `
    <div
      class="state"
      [class]="'tone-' + kind()"
      [attr.role]="kind() === 'error' ? 'alert' : 'status'"
    >
      <app-state-icon class="icon" [kind]="kind()" />
      <div class="body"><ng-content /></div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-block: 8px;
    }
    .state {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      color: var(--pm-muted);
    }
    .tone-warning {
      color: var(--pm-warn);
    }
    .tone-error {
      color: var(--pm-danger);
    }
    .icon {
      padding-top: 3px;
    }
    .body {
      min-width: 0;
      overflow-wrap: anywhere;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StateLine {
  readonly kind = input<StateKind>('info');
}
