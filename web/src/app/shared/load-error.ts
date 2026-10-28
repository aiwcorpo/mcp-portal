import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { ApiFailure } from '../core/api-error';
import { failureMessage } from '../core/error-messages';
import { requestReference } from './error-notice';

/** Panel that replaces a list or page that could not be loaded (mockup 24). */
@Component({
  selector: 'app-load-error',
  imports: [MatButtonModule, RouterLink],
  template: `
    <section class="panel" role="alert">
      @switch (failure().code) {
        @case ('access_denied') {
          <h2 i18n="@@loadError.forbidden">Nie masz dostępu do tej strony.</h2>
          <a mat-stroked-button routerLink="/catalog" i18n="@@loadError.toServers"
            >Wróć do serwerów</a
          >
        }
        @case ('not_found_or_denied') {
          <h2 i18n="@@loadError.notFound">Nie ma takiej strony.</h2>
          <a mat-stroked-button routerLink="/catalog" i18n="@@loadError.toServers2"
            >Wróć do serwerów</a
          >
        }
        @default {
          <h2 i18n="@@loadError.title">Nie udało się pobrać danych.</h2>
          <p class="muted">{{ message() }}</p>
          @if (retryable()) {
            <button
              mat-stroked-button
              type="button"
              (click)="retry.emit()"
              i18n="@@loadError.retry"
            >
              Odśwież
            </button>
          }
          @if (requestRef(); as ref) {
            <p class="request-ref muted">
              <ng-container i18n="@@common.requestRef2">Identyfikator do zgłoszenia:</ng-container>
              <code>{{ ref }}</code>
            </p>
          }
        }
      }
    </section>
  `,
  styles: `
    .panel {
      display: grid;
      justify-items: start;
      gap: 12px;
      max-width: 520px;
      padding: 20px;
      border: 1px solid var(--pm-border);
      border-radius: var(--pm-radius);
      background: var(--pm-surface);
    }
    .request-ref {
      font-size: 12px;
    }
    .request-ref code {
      margin-left: 0.4em;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadError {
  readonly failure = input.required<ApiFailure>();
  readonly retryable = input(true);
  readonly retry = output();
  protected readonly message = computed(() => failureMessage(this.failure()));
  protected readonly requestRef = computed(() => requestReference(this.failure()));
}
