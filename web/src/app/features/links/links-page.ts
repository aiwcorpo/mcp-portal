import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PortalVirtualServer, VirtualServersService } from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { LOADING, LoadState } from '../../core/load-state';
import { ConfirmDialog, ConfirmDialogData } from '../../shared/confirm-dialog';
import { ErrorNotice } from '../../shared/error-notice';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';

@Component({
  selector: 'app-links-page',
  imports: [MatButtonModule, RouterLink, ErrorNotice, LoadError, Loading, Notice],
  templateUrl: './links-page.html',
  styleUrl: './links-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinksPage {
  private readonly api = inject(VirtualServersService);
  private readonly dialog = inject(MatDialog);

  protected readonly links = signal<LoadState<PortalVirtualServer[]>>(LOADING);
  protected readonly busy = signal<string | null>(null);
  protected readonly failure = signal<ApiFailure | null>(null);
  protected readonly done = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.links.set(LOADING);
    try {
      this.links.set({
        status: 'ready',
        value: await firstValueFrom(this.api.listMyVirtualServers()),
      });
    } catch (error) {
      this.links.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  protected async remove(link: PortalVirtualServer): Promise<void> {
    if (this.busy()) {
      return;
    }
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: {
            title: $localize`:@@links.deleteTitle:Usunąć link "${link.displayName}:name:"?`,
            message: $localize`:@@links.deleteMessage:Agenci używający adresu /v/${link.slug}:slug:/mcp stracą dostęp. Tego nie można cofnąć.`,
            confirmLabel: $localize`:@@links.deleteConfirm:Usuń link`,
            destructive: true,
          },
        })
        .afterClosed(),
    );
    if (!confirmed) {
      return;
    }
    this.busy.set(link.slug);
    this.failure.set(null);
    this.done.set(null);
    try {
      await firstValueFrom(this.api.deleteMyVirtualServer(link.slug));
      this.done.set($localize`:@@links.deleted:Usunięto link "${link.displayName}:name:".`);
      await this.load();
    } catch (error) {
      this.failure.set(toApiFailure(error));
    } finally {
      this.busy.set(null);
    }
  }
}
