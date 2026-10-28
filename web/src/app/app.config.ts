import { provideHttpClient, withInterceptors, withNoXsrfProtection } from '@angular/common/http';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { MAT_BUTTON_CONFIG } from '@angular/material/button';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';
import { provideApi } from './api/generated';
import { routes } from './app.routes';
import { PageTitleStrategy } from './core/page-title.strategy';
import { sessionExpiryInterceptor } from './core/session-expiry.interceptor';
import { xsrfInterceptor } from './core/xsrf.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    { provide: TitleStrategy, useClass: PageTitleStrategy },
    // Same-origin relative calls: xsrfInterceptor attaches X-XSRF-TOKEN from the CSRF cookie (C12).
    provideHttpClient(
      withNoXsrfProtection(),
      withInterceptors([xsrfInterceptor, sessionExpiryInterceptor]),
    ),
    provideApi({ basePath: '' }),
    // A busy button keeps focus (aria-disabled) instead of dropping it to <body>; handlers check busy.
    { provide: MAT_BUTTON_CONFIG, useValue: { disabledInteractive: true } },
  ],
};
