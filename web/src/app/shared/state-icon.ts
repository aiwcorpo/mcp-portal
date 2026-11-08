import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type StateKind = 'success' | 'error' | 'warning' | 'info';

/** Icon of a message type; the colour comes from the surrounding text, so the type is never conveyed by colour alone. */
@Component({
  selector: 'app-state-icon',
  template: `
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      @switch (kind()) {
        @case ('success') {
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        }
        @case ('error') {
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5.5M12 16.5v.5" />
        }
        @case ('warning') {
          <path d="M12 3.5l9.5 16.5h-19z" />
          <path d="M12 10v4M12 17v.5" />
        }
        @default {
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5.5M12 7.5v.5" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StateIcon {
  readonly kind = input.required<StateKind>();
}
