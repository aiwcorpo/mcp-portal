import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Tone } from './labels';
import { StateIcon, StateKind } from './state-icon';

/** Status shown as text with a colour, never colour alone (WCAG 1.4.1); a problem also gets its icon (mockup 40). */
@Component({
  selector: 'app-status-badge',
  imports: [StateIcon],
  template: `<span [class]="'state-' + tone()">
    @if (icon(); as kind) {
      <app-state-icon [kind]="kind" />
    }
    {{ label() }}</span
  >`,
  styles: `
    span {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBadge {
  readonly label = input.required<string>();
  readonly tone = input<Tone>('neutral');
  protected readonly icon = computed((): StateKind | null => {
    switch (this.tone()) {
      case 'warn':
        return 'warning';
      case 'error':
        return 'error';
      default:
        return null;
    }
  });
}
