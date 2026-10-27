import { provideHttpClient, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { MAT_BUTTON_CONFIG } from '@angular/material/button';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
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
    // Same-origin relative calls: Angular then attaches X-XSRF-TOKEN from the XSRF-TOKEN cookie (C12).
    provideHttpClient(
      withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }),
      withInterceptors([sessionExpiryInterceptor]),
    ),
    provideApi({ basePath: '' }),
    // A busy button keeps focus (aria-disabled) instead of dropping it to <body>; handlers check busy.
    { provide: MAT_BUTTON_CONFIG, useValue: { disabledInteractive: true } },
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline', subscriptSizing: 'dynamic' },
    },
  ],
};
