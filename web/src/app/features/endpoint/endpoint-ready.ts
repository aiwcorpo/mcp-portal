import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { NotificationService } from '../../core/notification.service';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { StateLine } from '../../shared/state-line';
import { ClientConfigs } from '../../api/generated';

interface ConfigTab {
  key: keyof ClientConfigs;
  label: string;
  hint: string;
}

/** Address of the aggregate endpoint with the client configuration snippets (mockup 14, without the saved link). */
@Component({
  selector: 'app-endpoint-ready',
  imports: [MatButtonModule, MatTabsModule, RouterLink, StateLine],
  templateUrl: './endpoint-ready.html',
  styleUrl: './endpoint-ready.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EndpointReady {
  private readonly clipboard = inject(Clipboard);
  private readonly notifications = inject(NotificationService);

  readonly url = input.required<string>();
  readonly clientConfigs = input.required<ClientConfigs>();
  /** Tools that the address leaves visible, as the BFF counted them; an estimate. */
  readonly toolCount = input.required<number>();

  protected readonly tabs: readonly ConfigTab[] = [
    {
      key: 'claudeCode',
      label: 'Claude Code',
      hint: $localize`:@@ready.hintClaude:Run in a terminal`,
    },
    {
      key: 'copilot',
      label: 'Copilot',
      hint: $localize`:@@ready.hintCopilot:Paste into the .vscode/mcp.json file`,
    },
    {
      key: 'codex',
      label: 'Codex',
      hint: $localize`:@@ready.hintCodex:Add to the ~/.codex/config.toml file`,
    },
  ];
  protected readonly active = signal(0);
  protected readonly activeConfig = computed(
    () => this.clientConfigs()[this.tabs[this.active()].key],
  );

  protected copy(text: string, what: string): void {
    const copied = this.clipboard.copy(text);
    if (copied) {
      this.notifications.success($localize`:@@ready.copied:Copied: ${what}:what:.`);
    } else {
      this.notifications.error(
        $localize`:@@ready.copyFailed:Could not copy. Select the text and copy it manually.`,
      );
    }
  }

  protected readonly urlLabel = $localize`:@@ready.urlCopied:MCP address`;
  protected readonly configLabel = $localize`:@@ready.configCopied:configuration`;
}
