import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Tone } from './labels';

/** Status shown as text with a colour, never colour alone (WCAG 1.4.1). */
@Component({
  selector: 'app-status-badge',
  template: `<span [class]="'state-' + tone()">{{ label() }}</span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBadge {
  readonly label = input.required<string>();
  readonly tone = input<Tone>('neutral');
}
