import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  Injector,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, skip } from 'rxjs';
import { ApiFailure } from './core/api-error';
import { APP_NAME } from './core/page-title.strategy';
import { SessionService } from './core/session.service';
import { ThemeService } from './core/theme.service';
import { LoginPanel } from './features/login/login-panel';
import { ErrorNotice } from './shared/error-notice';
import { LoadError } from './shared/load-error';
import { Loading } from './shared/loading';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    LoginPanel,
    ErrorNotice,
    Loading,
    LoadError,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly session = inject(SessionService);
  protected readonly theme = inject(ThemeService);
  private readonly document = inject(DOCUMENT);

  protected readonly appName = APP_NAME;
  protected readonly logoutFailure = signal<ApiFailure | null>(null);

  constructor() {
    void this.session.load();
    // After an in-app navigation, focus moves to the new content instead of staying on a link that
    // may no longer exist; the first navigation is the page load and keeps the browser default.
    const injector = inject(Injector);
    inject(Router)
      .events.pipe(
        filter((event) => event instanceof NavigationEnd),
        skip(1),
        takeUntilDestroyed(),
      )
      .subscribe(() => afterNextRender(() => this.focusMain(), { injector }));
  }

  protected focusMain(): void {
    this.document.getElementById('main')?.focus();
  }

  protected async logout(): Promise<void> {
    this.logoutFailure.set(await this.session.logout());
  }
}
