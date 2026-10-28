import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found-page',
  imports: [MatButtonModule, RouterLink],
  template: `
    <section class="panel">
      <h1 i18n="@@notFound.title">Nie ma takiej strony.</h1>
      <a mat-stroked-button routerLink="/catalog" i18n="@@notFound.toCatalog">Wróć do serwerów</a>
    </section>
  `,
  styles: `
    .panel {
      display: grid;
      justify-items: start;
      gap: 14px;
      max-width: 520px;
      padding: 20px;
      border: 1px solid var(--pm-border);
      border-radius: var(--pm-radius);
      background: var(--pm-surface);
    }
    h1 {
      font-size: 16px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {}
