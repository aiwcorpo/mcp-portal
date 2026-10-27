import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService, Me, MeService } from '../api/generated';
import { ApiFailure, toApiFailure } from './api-error';
import { loginUrl } from './auth-urls';
import { BrowserNavigation } from './browser-navigation';

export type SessionState =
  | { status: 'loading' }
  | { status: 'authenticated'; me: Me }
  | { status: 'anonymous'; reason: 'not_logged_in' | 'expired' | 'logged_out' }
  | { status: 'error'; failure: ApiFailure };

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly meApi = inject(MeService);
  private readonly authApi = inject(AuthService);
  private readonly navigation = inject(BrowserNavigation);
  private readonly router = inject(Router);

  private readonly stateSignal = signal<SessionState>({ status: 'loading' });
  readonly state = this.stateSignal.asReadonly();
  readonly me = computed(() => {
    const state = this.stateSignal();
    return state.status === 'authenticated' ? state.me : null;
  });
  readonly isAdmin = computed(() => this.me()?.isAdmin ?? false);

  async load(): Promise<void> {
    this.stateSignal.set({ status: 'loading' });
    try {
      const me = await firstValueFrom(this.meApi.getMe());
      this.stateSignal.set({ status: 'authenticated', me });
    } catch (error) {
      const failure = toApiFailure(error);
      this.stateSignal.set(
        failure.code === 'unauthenticated'
          ? { status: 'anonymous', reason: 'not_logged_in' }
          : { status: 'error', failure },
      );
    }
  }

  /** Called by the HTTP interceptor when any API call reports that the session is gone. */
  markExpired(): void {
    if (this.stateSignal().status === 'authenticated') {
      this.stateSignal.set({ status: 'anonymous', reason: 'expired' });
    }
  }

  login(returnPath: string = this.router.url): void {
    this.navigation.assign(loginUrl(returnPath));
  }

  async logout(): Promise<ApiFailure | null> {
    try {
      await firstValueFrom(this.authApi.logout());
    } catch (error) {
      const failure = toApiFailure(error);
      if (failure.code !== 'unauthenticated') {
        return failure;
      }
    }
    this.stateSignal.set({ status: 'anonymous', reason: 'logged_out' });
    await this.router.navigateByUrl('/');
    return null;
  }
}
