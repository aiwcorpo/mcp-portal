import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ThemeService } from '../core/theme.service';

/**
 * Works like the language switch next to it: the button names the theme it switches to, so the way back is always
 * written on it. A label naming the current theme gave no hint that a second press undoes the first.
 */
@Component({
  selector: 'app-theme-switch',
  imports: [MatButtonModule],
  template: `
    <button mat-button type="button" class="head-button" (click)="change()">
      @if (target() === 'light') {
        <ng-container i18n="@@shell.themeLight">Light mode</ng-container>
      } @else {
        <ng-container i18n="@@shell.themeDark">Dark mode</ng-container>
      }
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeSwitch {
  private readonly theme = inject(ThemeService);
  protected readonly target = computed(() => (this.theme.mode() === 'dark' ? 'light' : 'dark'));

  protected change(): void {
    this.theme.select(this.target());
  }
}
