import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PortalVirtualServer, VirtualServersService } from '../../api/generated';
import { toApiFailure } from '../../core/api-error';
import { LOADING, LoadState } from '../../core/load-state';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { LinkReady } from './link-ready';

/** Configuration of an existing link ("Pokaż konfigurację", mockup 08). */
@Component({
  selector: 'app-link-config-page',
  imports: [MatButtonModule, RouterLink, LinkReady, LoadError, Loading],
  template: `
    <p class="back"><a routerLink="/links" i18n="@@linkConfig.back">&larr; Moje linki</a></p>
    @let state = link();
    @if (state.status === 'loading') {
      <app-loading />
    } @else if (state.status === 'error') {
      <app-load-error [failure]="state.failure" (retry)="load()" />
    } @else {
      <h1 i18n="@@linkConfig.title">Konfiguracja linku "{{ state.value.displayName }}"</h1>
      <div class="body">
        <app-link-ready
          [url]="state.value.url"
          [clientConfigs]="state.value.clientConfigs"
          [tools]="state.value.tools"
        />
      </div>
      <div class="foot">
        <a mat-flat-button routerLink="/links" i18n="@@linkConfig.toList">Wróć do listy</a>
      </div>
    }
  `,
  styles: `
    .back {
      margin-bottom: 14px;
    }
    .back a {
      color: var(--pm-muted);
      text-decoration: none;
    }
    h1 {
      margin-bottom: 20px;
    }
    .foot {
      max-width: 860px;
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--pm-border);
      text-align: right;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkConfigPage {
  private readonly api = inject(VirtualServersService);

  readonly slug = input.required<string>();
  protected readonly link = signal<LoadState<PortalVirtualServer>>(LOADING);

  constructor() {
    effect(() => {
      this.slug();
      untracked(() => void this.load());
    });
  }

  protected async load(): Promise<void> {
    this.link.set(LOADING);
    try {
      const links = await firstValueFrom(this.api.listMyVirtualServers());
      const found = links.find((candidate) => candidate.slug === this.slug());
      this.link.set(
        found
          ? { status: 'ready', value: found }
          : { status: 'error', failure: { code: 'not_found_or_denied', status: 404 } },
      );
    } catch (error) {
      this.link.set({ status: 'error', failure: toApiFailure(error) });
    }
  }
}
