import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { currentLocale, switchLocale } from '../core/locale';

/**
 * The button names the other language in that language, so it stays readable to someone who cannot read the current
 * one. Switching reloads the page: the texts are registered once, before the application starts.
 */
@Component({
  selector: 'app-locale-switch',
  imports: [MatButtonModule],
  template: `
    <button
      mat-button
      type="button"
      class="head-button"
      [attr.lang]="target"
      (click)="change()"
    >
      {{ label }}
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocaleSwitch {
  protected readonly target = currentLocale() === 'pl' ? 'en' : 'pl';
  protected readonly label = this.target === 'pl' ? 'Polski' : 'English';

  protected change(): void {
    switchLocale(this.target);
  }
}
