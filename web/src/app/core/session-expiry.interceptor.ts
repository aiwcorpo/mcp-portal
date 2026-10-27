import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SessionService } from './session.service';

const ME_PATH = '/api/v1/me';

/**
 * A 401 `unauthenticated` from any API call means the BFF session ended; the shell then shows the
 * login screen. `step_up_required` is also a 401 but belongs to the screen that made the call.
 */
export const sessionExpiryInterceptor: HttpInterceptorFn = (request, next) => {
  const session = inject(SessionService);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !request.url.endsWith(ME_PATH) &&
        (error.error as { error?: unknown } | null)?.error !== 'step_up_required'
      ) {
        session.markExpired();
      }
      return throwError(() => error);
    }),
  );
};
