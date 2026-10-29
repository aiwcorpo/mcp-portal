import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { CatalogAction, CatalogTool, PortalCatalogServer } from '../../api/generated';
import {
  actionLabel,
  catalogStatusText,
  catalogStatusTone,
  credentialTypeLabel,
  riskLabel,
  systemName,
} from '../../shared/labels';
import { canRequestTool, catalogRowActions, isEmphasised } from './catalog-actions';

export interface CatalogActionEvent {
  server: PortalCatalogServer;
  action: CatalogAction;
}

export interface ToolRequestEvent {
  server: PortalCatalogServer;
  tool: CatalogTool;
}

/** True when the query matches the server name, its id or one of its tools (name, title). */
export function matchesServer(server: PortalCatalogServer, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return (
    systemName(server.system).toLowerCase().includes(needle) ||
    server.serverId.toLowerCase().includes(needle) ||
    server.tools.some((tool) => toolMatches(tool, needle))
  );
}

function toolMatches(tool: CatalogTool, needle: string): boolean {
  return (
    tool.name.toLowerCase().includes(needle) ||
    (tool.title ?? '').toLowerCase().includes(needle) ||
    tool.description.toLowerCase().includes(needle)
  );
}

/** Expandable table of servers (mockups 01, 26); tools of a server are rows under it. */
@Component({
  selector: 'app-catalog-table',
  imports: [MatButtonModule],
  templateUrl: './catalog-table.html',
  styleUrl: './catalog-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogTable {
  readonly servers = input.required<readonly PortalCatalogServer[]>();
  readonly query = input('');
  readonly busy = input<string | null>(null);
  readonly busyTool = input<string | null>(null);
  readonly action = output<CatalogActionEvent>();
  readonly toolRequest = output<ToolRequestEvent>();

  private readonly opened = signal<ReadonlySet<string>>(new Set());

  protected readonly rows = computed(() =>
    this.servers().map((server) => ({
      server,
      name: systemName(server.system),
      login: this.loginLabel(server),
      status: catalogStatusText(server.status, server.connection),
      tone: catalogStatusTone(server.status),
      actions: catalogRowActions(server),
      tools: server.tools,
    })),
  );

  protected readonly showLabel = $localize`:@@catalog.showTools:Pokaż narzędzia`;
  protected readonly hideLabel = $localize`:@@catalog.hideTools:Ukryj narzędzia`;
  protected readonly actionLabel = actionLabel;
  protected readonly riskLabel = riskLabel;
  protected readonly isEmphasised = isEmphasised;
  protected readonly canRequest = canRequestTool;

  protected isOpen(server: PortalCatalogServer): boolean {
    const query = this.query().trim().toLowerCase();
    const matchedByTool =
      query !== '' &&
      !systemName(server.system).toLowerCase().includes(query) &&
      server.tools.some((tool) => toolMatches(tool, query));
    return matchedByTool || this.opened().has(server.serverId);
  }

  protected toggle(server: PortalCatalogServer): void {
    this.opened.update((current) => {
      const next = new Set(current);
      if (!next.delete(server.serverId)) {
        next.add(server.serverId);
      }
      return next;
    });
  }

  protected run(server: PortalCatalogServer, action: CatalogAction): void {
    this.action.emit({ server, action });
  }

  protected requestTool(server: PortalCatalogServer, tool: CatalogTool): void {
    this.toolRequest.emit({ server, tool });
  }

  private loginLabel(server: PortalCatalogServer): string {
    const type = server.connection?.type ?? server.credential?.defaultType;
    return type ? credentialTypeLabel(type) : '';
  }
}
