import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { NotificationService } from './core/notification.service';
import { APP_NAME } from './core/page-title.strategy';
import { SessionService } from './core/session.service';
import { ThemeService } from './core/theme.service';
import { LoginPanel } from './features/login/login-panel';
import { LoadError } from './shared/load-error';
import { LocaleSwitch } from './shared/locale-switch';
import { Loading } from './shared/loading';
import { ThemeSwitch } from './shared/theme-switch';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    LoginPanel,
    Loading,
    LoadError,
    LocaleSwitch,
    ThemeSwitch,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly session = inject(SessionService);
  private readonly document = inject(DOCUMENT);
  private readonly notifications = inject(NotificationService);

  protected readonly appName = APP_NAME;
  private readonly router = inject(Router);
  private readonly path = signal(this.router.url.split(/[?#]/)[0]);
  /** The preview of a pending operation is a page of its own without the tabs (mockup 14). */
  protected readonly previewOpen = computed(() => this.path().startsWith('/confirm/'));
  /** Registering the Authenticator belongs to "System connections" (mockups 25-28). */
  protected readonly connectionsActive = computed(
    () => this.path().startsWith('/connections') || this.path().startsWith('/authenticator'),
  );

  constructor() {
    // The switch is only in the signed-in header; the service has to start for the login screen too.
    inject(ThemeService);
    void this.session.load();
    // After an in-app navigation, focus moves to the new content instead of staying on a link that
    // may no longer exist; the first navigation is the page load and keeps the browser default.
    const injector = inject(Injector);
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => this.path.set(event.urlAfterRedirects.split(/[?#]/)[0]));
    this.router.events
      .pipe(
        // Navigation 1 is the page load and keeps the browser's focus. Counting "the first NavigationEnd"
        // instead would swallow the first click when it cancels a slow initial navigation.
        filter((event) => event instanceof NavigationEnd && event.id !== 1),
        takeUntilDestroyed(),
      )
      .subscribe(() => afterNextRender(() => this.focusMain(), { injector }));
  }

  protected focusMain(): void {
    this.document.getElementById('main')?.focus();
  }

  protected async logout(): Promise<void> {
    const failure = await this.session.logout();
    if (failure) {
      this.notifications.failure(failure);
    }
  }
}
