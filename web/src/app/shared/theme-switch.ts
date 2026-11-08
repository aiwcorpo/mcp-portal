import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ThemeMode, ThemeService } from '../core/theme.service';

/**
 * Both themes are always on offer, so the way back is visible whichever one is active. A single toggle
 * labelled with one theme gave no hint that a second press undoes the first.
 */
@Component({
  selector: 'app-theme-switch',
  imports: [MatButtonModule],
  template: `
    <div role="group" i18n-aria-label="@@shell.theme" aria-label="Theme">
      <button
        mat-button
        type="button"
        class="head-button"
        [attr.aria-pressed]="theme.mode() === 'light'"
        (click)="choose('light')"
        i18n="@@shell.themeLight"
      >
        Light
      </button>
      <button
        mat-button
        type="button"
        class="head-button"
        [attr.aria-pressed]="theme.mode() === 'dark'"
        (click)="choose('dark')"
        i18n="@@shell.themeDark"
      >
        Dark
      </button>
    </div>
  `,
  styles: `
    button[aria-pressed='true'] {
      --mat-button-text-label-text-color: var(--pm-text);
      font-weight: 500;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeSwitch {
  protected readonly theme = inject(ThemeService);

  protected choose(mode: ThemeMode): void {
    this.theme.select(mode);
  }
}
