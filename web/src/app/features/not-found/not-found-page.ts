import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink],
  template: `
    <h1 i18n="@@notFound.title">Nie ma takiej strony</h1>
    <p>
      <ng-container i18n="@@notFound.text"
        >Adres jest niepoprawny albo nie masz dostępu do tego widoku.</ng-container
      >
      <a routerLink="/catalog" i18n="@@notFound.toCatalog">Przejdź do katalogu</a>
    </p>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {}
