import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, forkJoin } from 'rxjs';
import {
  CatalogService,
  CatalogTool,
  PortalCatalogServer,
  PortalVirtualServerCreated,
  VirtualServersService,
} from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { neutraliseText } from '../../shared/untrusted-text';
import { ConnectionActions } from '../../core/connection-actions.service';
import { canRequestTool } from '../catalog/catalog-actions';
import { LOADING, LoadState } from '../../core/load-state';
import { ErrorNotice } from '../../shared/error-notice';
import { riskLabel, systemName } from '../../shared/labels';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';
import { nonBlankValidator } from '../connect/secret-form';
import { AuthenticatorBanner } from '../authenticator/authenticator-banner';
import { LinkReady } from './link-ready';
import { SLUG_PATTERN, suggestSlug } from './slug';

type Step = 'name' | 'tools' | 'ready';

/** Why a tool cannot be put into a link; null when it can. */
export type ToolBlock = 'disabled' | 'denied' | 'not_connected' | 'reconnect_required' | null;

export function toolBlock(server: PortalCatalogServer, tool: CatalogTool): ToolBlock {
  if (tool.disabled) {
    return 'disabled';
  }
  if (tool.access === 'denied') {
    return 'denied';
  }
  if (server.status === 'not_connected' || server.status === 'reconnect_required') {
    return server.status;
  }
  return null;
}

interface ToolRow {
  tool: CatalogTool;
  block: ToolBlock;
}

interface ToolGroup {
  server: PortalCatalogServer;
  name: string;
  rows: ToolRow[];
}

interface WizardData {
  servers: PortalCatalogServer[];
  takenSlugs: ReadonlySet<string>;
}

/** Three steps: name -> tools -> ready (no resource narrowing, CC-085). */
@Component({
  selector: 'app-link-wizard-page',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    RouterLink,
    AuthenticatorBanner,
    ErrorNotice,
    LinkReady,
    LoadError,
    Loading,
    Notice,
  ],
  templateUrl: './link-wizard-page.html',
  styleUrl: './link-wizard-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkWizardPage {
  private readonly catalogApi = inject(CatalogService);
  private readonly linksApi = inject(VirtualServersService);
  private readonly connectionActions = inject(ConnectionActions);
  private readonly router = inject(Router);

  protected readonly data = signal<LoadState<WizardData>>(LOADING);
  protected readonly step = signal<Step>('name');
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly query = signal('');
  protected readonly created = signal<PortalVirtualServerCreated | null>(null);
  protected readonly failure = signal<ApiFailure | null>(null);
  protected readonly info = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly slugTaken = signal<string | null>(null);
  protected readonly nameAttempted = signal(false);
  protected readonly toolsAttempted = signal(false);

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, nonBlankValidator, Validators.maxLength(100)],
    }),
    slug: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(SLUG_PATTERN)],
    }),
  });
  private slugEdited = false;

  protected readonly steps = [
    { key: 'name', label: $localize`:@@wizard.step.name:Nazwa` },
    { key: 'tools', label: $localize`:@@wizard.step.tools:Narzędzia` },
    { key: 'ready', label: $localize`:@@wizard.step.ready:Gotowe` },
  ] as const;

  protected readonly groups = computed<ToolGroup[]>(() => {
    const state = this.data();
    if (state.status !== 'ready') {
      return [];
    }
    const needle = this.query().trim().toLowerCase();
    return state.value.servers
      .map((server) => ({
        server,
        name: systemName(server.system),
        rows: server.tools
          .filter(
            (tool) =>
              !needle ||
              tool.name.toLowerCase().includes(needle) ||
              (tool.title ?? '').toLowerCase().includes(needle) ||
              tool.description.toLowerCase().includes(needle),
          )
          .map((tool) => ({ tool, block: toolBlock(server, tool) })),
      }))
      .filter((group) => group.rows.length);
  });

  protected readonly needsAuthenticator = computed(() => {
    const state = this.data();
    return (
      state.status === 'ready' &&
      state.value.servers.some((server) =>
        server.tools.some((tool) => tool.requiresConfirmation && toolBlock(server, tool) === null),
      )
    );
  });

  protected readonly selectedNames = computed(() => {
    const state = this.data();
    if (state.status !== 'ready') {
      return [];
    }
    // A tool that became blocked after the selection (reload after access_denied) cannot be unticked in
    // the list any more, so it must not stay in the request.
    return state.value.servers
      .flatMap((server) =>
        server.tools.filter((tool) => toolBlock(server, tool) === null).map((tool) => tool.name),
      )
      .filter((name) => this.selected().has(name));
  });

  protected readonly riskLabel = riskLabel;
  protected readonly canRequest = canRequestTool;

  constructor() {
    void this.load();
    this.form.controls.name.valueChanges.subscribe((name) => {
      if (!this.slugEdited) {
        this.form.controls.slug.setValue(suggestSlug(name));
      }
    });
    this.form.controls.slug.valueChanges.subscribe(() => this.slugTaken.set(null));
  }

  protected async load(): Promise<void> {
    this.data.set(LOADING);
    try {
      const { catalog, links } = await firstValueFrom(
        forkJoin({
          catalog: this.catalogApi.getPortalCatalog(),
          links: this.linksApi.listMyVirtualServers(),
        }),
      );
      this.data.set({
        status: 'ready',
        value: { servers: catalog.servers, takenSlugs: new Set(links.map((link) => link.slug)) },
      });
    } catch (error) {
      this.data.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  protected onSlugInput(): void {
    this.slugEdited = true;
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /** The slug is checked here against the user's own links; the 409 from the API covers the rest. */
  protected slugError(): string | null {
    const slug = this.form.controls.slug;
    const state = this.data();
    if (this.slugTaken() === slug.value) {
      return $localize`:@@wizard.slugTaken:Ten identyfikator jest już zajęty. Wybierz inny.`;
    }
    if (state.status === 'ready' && state.value.takenSlugs.has(slug.value)) {
      return $localize`:@@wizard.slugTaken2:Ten identyfikator jest już zajęty. Wybierz inny.`;
    }
    if (this.nameAttempted() && slug.invalid) {
      return slug.hasError('required')
        ? $localize`:@@wizard.slugRequired:Podaj identyfikator.`
        : $localize`:@@wizard.slugPattern:Dozwolone są małe litery, cyfry i myślnik; identyfikator nie może zaczynać się ani kończyć myślnikiem (do 63 znaków).`;
    }
    return null;
  }

  protected toNameStep(): void {
    this.failure.set(null);
    this.step.set('name');
  }

  protected toToolsStep(): void {
    this.nameAttempted.set(true);
    if (this.form.invalid || this.slugError()) {
      this.form.markAllAsTouched();
      return;
    }
    this.failure.set(null);
    this.step.set('tools');
  }

  protected isSelected(name: string): boolean {
    return this.selected().has(name);
  }

  protected toggleTool(name: string, checked: boolean): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(name);
      } else {
        next.delete(name);
      }
      return next;
    });
  }

  protected async create(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.toolsAttempted.set(true);
    const tools = this.selectedNames();
    if (!tools.length) {
      return;
    }
    this.saving.set(true);
    this.failure.set(null);
    const { name, slug } = this.form.getRawValue();
    try {
      const result = await firstValueFrom(
        this.linksApi.createMyVirtualServer({ slug, displayName: name.trim(), tools }),
      );
      this.created.set(result);
      this.step.set('ready');
    } catch (error) {
      const failure = toApiFailure(error);
      if (failure.code === 'slug_taken') {
        this.slugTaken.set(slug);
        this.step.set('name');
      } else {
        this.failure.set(failure);
        if (failure.code === 'access_denied') {
          void this.load();
        }
      }
    } finally {
      this.saving.set(false);
    }
  }

  private requesting = false;

  protected async requestAccess(tool: CatalogTool): Promise<void> {
    if (this.requesting) {
      return;
    }
    this.requesting = true;
    try {
      await this.sendRequest(tool);
    } finally {
      this.requesting = false;
    }
  }

  private async sendRequest(tool: CatalogTool): Promise<void> {
    this.info.set(null);
    this.failure.set(null);
    const result = await this.connectionActions.requestAccess(tool);
    if (result.kind === 'created') {
      this.info.set(
        $localize`:@@wizard.requestCreated:Wniosek ${neutraliseText(result.requestId).text}:id: jest w systemie uprawnień. Jego stan sprawdzisz w zakładce Wnioski.`,
      );
    } else if (result.kind === 'failed') {
      this.failure.set(result.failure);
    } else if (result.kind === 'unavailable') {
      this.failure.set({ code: 'internal_error', status: 0 });
    }
  }

  protected async finish(): Promise<void> {
    await this.router.navigate(['/links']);
  }
}
