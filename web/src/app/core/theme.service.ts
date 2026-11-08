import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

/** Only the colour preference is stored in the browser; nothing session- or user-related. */
const STORAGE_KEY = 'mcp-portal-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly chosen = signal<ThemeMode | null>(this.readStored());

  /** The mockups are dark, so dark is the default whatever the system prefers; light is opt-in. */
  readonly mode = computed<ThemeMode>(() => this.chosen() ?? 'dark');

  constructor() {
    effect(() => {
      const root = this.document.documentElement;
      const mode = this.mode();
      root.classList.toggle('theme-dark', mode === 'dark');
      root.classList.toggle('theme-light', mode === 'light');
    });
  }

  select(next: ThemeMode): void {
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
