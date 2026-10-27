import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

/** Only the colour preference is stored in the browser; nothing session- or user-related. */
const STORAGE_KEY = 'mcp-portal-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly media = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media?.matches ?? false);
  private readonly chosen = signal<ThemeMode | null>(this.readStored());

  readonly mode = computed<ThemeMode>(
    () => this.chosen() ?? (this.systemDark() ? 'dark' : 'light'),
  );

  constructor() {
    this.media?.addEventListener?.('change', (event) => this.systemDark.set(event.matches));
    effect(() => {
      const root = this.document.documentElement;
      const chosen = this.chosen();
      root.classList.toggle('theme-dark', chosen === 'dark');
      root.classList.toggle('theme-light', chosen === 'light');
    });
  }

  toggle(): void {
    const next: ThemeMode = this.mode() === 'dark' ? 'light' : 'dark';
    this.chosen.set(next);
    try {
      this.document.defaultView?.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked (private mode, policy): the choice lasts until reload.
    }
  }

  private readStored(): ThemeMode | null {
    try {
      const value = this.document.defaultView?.localStorage.getItem(STORAGE_KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return null;
    }
  }
}
