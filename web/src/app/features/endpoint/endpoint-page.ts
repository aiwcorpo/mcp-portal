import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  CatalogService,
  CatalogTool,
  McpEndpoint,
  McpEndpointService,
  PortalCatalogServer,
} from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { LOADING, LoadState } from '../../core/load-state';
import {
  FilterAccess,
  FilterProblem,
  MAX_QUERY_BYTES,
  composeFilter,
  endpointParameters,
} from '../../core/mcp-filter';
import { TOOLS_LIST_PAGE_SIZE, TOOL_LIST_WARNING_THRESHOLD } from '../../core/tool-list-warning';
import { ErrorNotice } from '../../shared/error-notice';
import { riskLabel, systemName } from '../../shared/labels';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';
import { AuthenticatorBanner } from '../authenticator/authenticator-banner';
import { EndpointReady } from './endpoint-ready';

/** Why a tool does not count towards the address; null when it does. */
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

type AccessChoice = 'all' | FilterAccess;
export type ToolMode = 'only' | 'except';

/** A moment to wait after the last click before the BFF is asked, so a series of clicks is one request. */
export const ENDPOINT_DEBOUNCE_MS = 250;

interface ToolRow {
  tool: CatalogTool;
  block: ToolBlock;
}

interface ToolGroup {
  server: PortalCatalogServer;
  name: string;
  rows: ToolRow[];
}

interface SystemOption {
  system: string;
  name: string;
  count: number;
}

/**
 * The address of the whole platform, with an optional filter (`systems`, `tools`, `access`, `exclude`). Nothing is
 * saved: the page asks `GET /me/mcp-endpoint` for the canonical address and the client configuration (CC-175).
 * The query is limited to 512 bytes, so the page counts them and does not ask for an address it could not build
 * (CC-185).
 */
@Component({
  selector: 'app-endpoint-page',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    RouterLink,
    AuthenticatorBanner,
    EndpointReady,
    ErrorNotice,
    LoadError,
    Loading,
    Notice,
  ],
  templateUrl: './endpoint-page.html',
  styleUrl: './endpoint-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EndpointPage {
  private readonly catalogApi = inject(CatalogService);
  private readonly endpointApi = inject(McpEndpointService);
  protected readonly warningThreshold = inject(TOOL_LIST_WARNING_THRESHOLD);

  protected readonly catalog = signal<LoadState<PortalCatalogServer[]>>(LOADING);
  protected readonly endpoint = signal<LoadState<McpEndpoint>>(LOADING);
  /** The address on screen belongs to an older choice while the next one is being fetched. */
  protected readonly refreshing = signal(false);

  protected readonly systems = signal<ReadonlySet<string>>(new Set());
  protected readonly access = signal<AccessChoice>('all');
  protected readonly toolMode = signal<ToolMode>('only');
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  protected readonly query = signal('');

  protected readonly maxBytes = MAX_QUERY_BYTES;
  protected readonly pageSize = TOOLS_LIST_PAGE_SIZE;
  protected readonly riskLabel = riskLabel;

  protected readonly servers = computed(() => {
    const state = this.catalog();
    return state.status === 'ready' ? state.value : [];
  });

  protected readonly systemOptions = computed<SystemOption[]>(() =>
    this.servers().map((server) => ({
      system: server.system,
      name: systemName(server.system),
      count: server.tools.filter((tool) => toolBlock(server, tool) === null).length,
    })),
  );

  /** Tools that the chosen systems leave on the list (all of them when no system is ticked). */
  private readonly inScope = computed(() => {
    const chosen = this.systems();
    return this.servers().filter((server) => !chosen.size || chosen.has(server.system));
  });

  protected readonly groups = computed<ToolGroup[]>(() => {
    const needle = this.query().trim().toLowerCase();
    return this.inScope()
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

  /** Ticked tools that are still on the list; one that left with its system or became blocked is not sent. */
  protected readonly effectivePicked = computed(() => {
    const picked = this.picked();
    return this.inScope()
      .flatMap((server) =>
        server.tools.filter((tool) => toolBlock(server, tool) === null).map((tool) => tool.name),
      )
      .filter((name) => picked.has(name));
  });

  protected readonly composed = computed(() => {
    const picked = this.effectivePicked();
    const access = this.access();
    return composeFilter({
      systems: [...this.systems()],
      tools: this.toolMode() === 'only' ? picked : [],
      access: access === 'all' ? null : access,
      exclude: this.toolMode() === 'except' ? picked : [],
    });
  });

  protected readonly problemText = computed(() => problemMessage(this.composed().problem));

  protected readonly needsAuthenticator = computed(() =>
    this.servers().some((server) =>
      server.tools.some((tool) => tool.requiresConfirmation && toolBlock(server, tool) === null),
    ),
  );

  private generation = 0;
  private firstRequest = true;

  constructor() {
    void this.loadCatalog();
    effect((onCleanup) => {
      const composed = this.composed();
      if (composed.problem) {
        return;
      }
      const timer = setTimeout(
        () => void this.fetchEndpoint(composed.query),
        this.firstRequest ? 0 : ENDPOINT_DEBOUNCE_MS,
      );
      this.firstRequest = false;
      onCleanup(() => clearTimeout(timer));
    });
  }

  protected async loadCatalog(): Promise<void> {
    this.catalog.set(LOADING);
    try {
      this.catalog.set({
        status: 'ready',
        value: (await firstValueFrom(this.catalogApi.getPortalCatalog())).servers,
      });
    } catch (error) {
      this.catalog.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  protected async retryEndpoint(): Promise<void> {
    this.endpoint.set(LOADING);
    await this.fetchEndpoint(this.composed().query);
  }

  private async fetchEndpoint(filter: string): Promise<void> {
    const generation = ++this.generation;
    this.refreshing.set(true);
    const { systems, tools, access, exclude } = endpointParameters(filter);
    try {
      const result = await firstValueFrom(
        this.endpointApi.getMcpEndpoint(systems, tools, access, exclude),
      );
      if (generation === this.generation) {
        this.endpoint.set({ status: 'ready', value: result });
      }
    } catch (error) {
      if (generation === this.generation) {
        this.endpoint.set({ status: 'error', failure: toApiFailure(error) });
      }
    } finally {
      if (generation === this.generation) {
        this.refreshing.set(false);
      }
    }
  }

  protected readonly shown = computed(() => {
    const state = this.endpoint();
    return this.composed().problem === null && state.status === 'ready' ? state.value : null;
  });

  protected isSystemChosen(system: string): boolean {
    return this.systems().has(system);
  }

  protected toggleSystem(system: string, checked: boolean): void {
    this.systems.update((current) => withMember(current, system, checked));
  }

  protected setAccess(value: AccessChoice): void {
    this.access.set(value);
  }

  protected setToolMode(mode: ToolMode): void {
    if (mode !== this.toolMode()) {
      this.toolMode.set(mode);
      this.picked.set(new Set());
    }
  }

  protected isPicked(name: string): boolean {
    return this.picked().has(name);
  }

  protected togglePicked(name: string, checked: boolean): void {
    this.picked.update((current) => withMember(current, name, checked));
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected clearChoice(): void {
    this.systems.set(new Set());
    this.access.set('all');
    this.picked.set(new Set());
    this.query.set('');
  }

  protected failureOf(state: LoadState<unknown>): ApiFailure | null {
    return state.status === 'error' ? state.failure : null;
  }
}

function withMember(
  set: ReadonlySet<string>,
  value: string,
  present: boolean,
): ReadonlySet<string> {
  const next = new Set(set);
  if (present) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return next;
}

function problemMessage(problem: FilterProblem | null): string | null {
  switch (problem) {
    case null:
      return null;
    case 'query_too_long':
      return $localize`:@@endpoint.problem.tooLong:Adres byłby dłuższy niż ${MAX_QUERY_BYTES}:max: bajtów. Zamiast wielu narzędzi wybierz całe systemy albo wyklucz kilka narzędzi.`;
    case 'too_many_entries':
      return $localize`:@@endpoint.problem.tooMany:Za dużo wpisów w jednym parametrze (do 5 systemów, do 100 narzędzi). Wybierz całe systemy albo wyklucz kilka narzędzi.`;
    default:
      return $localize`:@@endpoint.problem.other:Z tego wyboru nie da się złożyć adresu. Zmień wybór.`;
  }
}
