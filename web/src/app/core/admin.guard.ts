import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanMatchFn } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { SessionService } from './session.service';

/**
 * The initial navigation runs before GET /me returns, so the guard waits for the session instead of
 * reading a still-empty state. The BFF enforces admin rights again on every admin endpoint.
 */
export const adminGuard: CanMatchFn = () => {
  const session = inject(SessionService);
  return toObservable(session.state).pipe(
    filter((state) => state.status !== 'loading'),
    take(1),
    map(() => session.isAdmin()),
  );
};
