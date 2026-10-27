import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { CatalogAction, PortalCatalogServer } from '../../api/generated';
import {
  accessLabel,
  actionLabel,
  catalogStatusHint,
  catalogStatusLabel,
  catalogStatusTone,
  riskLabel,
  systemName,
} from '../../shared/labels';
import { StatusBadge } from '../../shared/status-badge';
import { serverActions } from './catalog-actions';

export interface CatalogActionEvent {
  server: PortalCatalogServer;
  action: CatalogAction;
}

@Component({
  selector: 'app-catalog-server-card',
  imports: [MatButtonModule, StatusBadge],
  templateUrl: './catalog-server-card.html',
  styleUrl: './catalog-server-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogServerCard {
  readonly server = input.required<PortalCatalogServer>();
  readonly busy = input(false);
  readonly action = output<CatalogActionEvent>();

  protected readonly toolsOpen = signal(false);
  protected readonly name = computed(() => systemName(this.server().system));
  protected readonly statusLabel = computed(() => catalogStatusLabel(this.server().status));
  protected readonly statusHint = computed(() => catalogStatusHint(this.server().status));
  protected readonly statusTone = computed(() => catalogStatusTone(this.server().status));
  protected readonly actions = computed(() => serverActions(this.server()));
  protected readonly grantedCount = computed(
    () => this.server().tools.filter((tool) => tool.access === 'granted').length,
  );

  protected readonly actionLabel = actionLabel;
  protected readonly riskLabel = riskLabel;
  protected readonly accessLabel = accessLabel;

  protected run(action: CatalogAction): void {
    this.action.emit({ server: this.server(), action });
  }

  protected toggleTools(): void {
    this.toolsOpen.update((open) => !open);
  }
}
