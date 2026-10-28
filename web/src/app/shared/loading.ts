import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Placeholder rows while a list loads (mockup 24); announced once as "Ladowanie". */
@Component({
  selector: 'app-loading',
  template: `
    <div class="loading" role="status">
      <p class="label" i18n="@@common.loadingText">Ładowanie...</p>
      <div class="rows" aria-hidden="true">
        @for (row of rows(); track row) {
          <div class="row">
            <span class="bar wide"></span><span class="bar mid"></span
            ><span class="bar short"></span>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .loading {
      max-width: 720px;
      padding: 16px 0;
    }
    .label {
      margin-bottom: 12px;
      color: var(--pm-muted);
    }
    .row {
      display: grid;
      grid-template-columns: 3fr 2fr 1fr;
      gap: 24px;
      padding: 12px 0;
      border-bottom: 1px solid var(--pm-border);
    }
    .bar {
      height: 10px;
      border-radius: 3px;
      background: var(--pm-surface-2);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Loading {
  readonly rows = input<readonly number[]>([1, 2, 3]);
}
