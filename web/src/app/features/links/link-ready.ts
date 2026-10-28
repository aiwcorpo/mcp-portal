import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { ClientConfigs } from '../../api/generated';

interface ConfigTab {
  key: keyof ClientConfigs;
  label: string;
  hint: string;
}

/** URL, client configuration snippets and a summary of a virtual server (mockup 14). */
@Component({
  selector: 'app-link-ready',
  imports: [MatButtonModule, MatTabsModule],
  templateUrl: './link-ready.html',
  styleUrl: './link-ready.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkReady {
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);

  readonly url = input.required<string>();
  readonly clientConfigs = input.required<ClientConfigs>();
  readonly tools = input.required<readonly string[]>();

  protected readonly tabs: readonly ConfigTab[] = [
    {
      key: 'claudeCode',
      label: 'Claude Code',
      hint: $localize`:@@ready.hintClaude:Uruchom w terminalu`,
    },
    {
      key: 'copilot',
      label: 'Copilot',
      hint: $localize`:@@ready.hintCopilot:Wklej do pliku .vscode/mcp.json`,
    },
    {
      key: 'codex',
      label: 'Codex',
      hint: $localize`:@@ready.hintCodex:Dodaj do pliku ~/.codex/config.toml`,
    },
  ];
  protected readonly active = signal(0);
  protected readonly activeConfig = computed(
    () => this.clientConfigs()[this.tabs[this.active()].key],
  );

  protected copy(text: string, what: string): void {
    const copied = this.clipboard.copy(text);
    this.snackBar.open(
      copied
        ? $localize`:@@ready.copied:Skopiowano: ${what}:what:.`
        : $localize`:@@ready.copyFailed:Nie udało się skopiować. Zaznacz tekst i skopiuj go ręcznie.`,
      undefined,
      { duration: 4000 },
    );
  }

  protected readonly urlLabel = $localize`:@@ready.urlCopied:adres linku`;
  protected readonly configLabel = $localize`:@@ready.configCopied:konfiguracja`;
}
