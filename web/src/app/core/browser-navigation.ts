import { DOCUMENT, Injectable, inject } from '@angular/core';

/**
 * Full-page navigation outside the SPA (BFF login, OAuth provider). Separate service so tests and the
 * mock API can observe or simulate the redirect instead of leaving the page.
 */
@Injectable({ providedIn: 'root' })
export class BrowserNavigation {
  private readonly document = inject(DOCUMENT);

  get origin(): string {
    return this.document.location.origin;
  }

  assign(url: string): void {
    this.document.location.assign(url);
  }
}
