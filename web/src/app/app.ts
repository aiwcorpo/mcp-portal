import { ChangeDetectionStrategy, Component, DOCUMENT, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiFailure } from './core/api-error';
import { APP_NAME } from './core/page-title.strategy';
import { SessionService } from './core/session.service';
import { ThemeService } from './core/theme.service';
import { LoginPanel } from './features/login/login-panel';
import { ErrorNotice } from './shared/error-notice';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatProgressBarModule,
    LoginPanel,
    ErrorNotice,
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
  }

  protected focusMain(): void {
    this.document.getElementById('main')?.focus();
  }

  protected async logout(): Promise<void> {
    this.logoutFailure.set(await this.session.logout());
  }
}
