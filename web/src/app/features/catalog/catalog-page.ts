import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  CatalogService,
  ConnectionsService,
  PortalCatalogServer,
  SystemId,
} from '../../api/generated';
import { ApiFailure, PortalErrorCode, toApiFailure } from '../../core/api-error';
import { isHttpUrl } from '../../core/auth-urls';
import { BrowserNavigation } from '../../core/browser-navigation';
import { LOADING, LoadState } from '../../core/load-state';
import { ConfirmDialog, ConfirmDialogData } from '../../shared/confirm-dialog';
import { ErrorNotice } from '../../shared/error-notice';
import { isSystemId, systemName } from '../../shared/labels';
import { Notice } from '../../shared/notice';
import { CatalogActionEvent, CatalogServerCard } from './catalog-server-card';

/** Codes the OAuth callback may put in ?connectError= (CC-022); anything else is shown generically. */
const CONNECT_ERRORS: readonly PortalErrorCode[] = [
  'identity_mismatch',
  'flow_invalid',
  'provider_error',
];

type Banner = { kind: 'success'; text: string } | { kind: 'error'; failure: ApiFailure };

@Component({
  selector: 'app-catalog-page',
  imports: [CatalogServerCard, ErrorNotice, Notice, MatProgressBarModule],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogPage {
  private readonly catalogApi = inject(CatalogService);
  private readonly connectionsApi = inject(ConnectionsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly navigation = inject(BrowserNavigation);

  protected readonly catalog = signal<LoadState<PortalCatalogServer[]>>(LOADING);
  protected readonly banner = signal<Banner | null>(null);
  protected readonly busyServer = signal<string | null>(null);

  constructor() {
    this.readCallbackResult();
    void this.load();
  }

  protected async load(): Promise<void> {
    this.catalog.set(LOADING);
    try {
      const catalog = await firstValueFrom(this.catalogApi.getPortalCatalog());
      this.catalog.set({ status: 'ready', value: catalog.servers });
    } catch (error) {
      this.catalog.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  protected async onAction({ server, action }: CatalogActionEvent): Promise<void> {
    switch (action) {
      case 'copy_link':
        this.copyLink(server);
        return;
      case 'connect_oauth':
        await this.startOAuth(server.system);
        return;
      case 'add_secret':
      case 'reconnect':
        await this.router.navigate(['/connect', server.system]);
        return;
      case 'disconnect':
        await this.disconnect(server.system);
        return;
      default:
        return;
    }
  }

  private copyLink(server: PortalCatalogServer): void {
    const copied = this.clipboard.copy(server.url);
    this.snackBar.open(
      copied
        ? $localize`:@@catalog.linkCopied:Skopiowano adres serwera ${systemName(server.system)}:system:.`
        : $localize`:@@catalog.linkCopyFailed:Nie udało się skopiować adresu. Adres: ${server.url}:url:`,
      undefined,
      { duration: 5000 },
    );
  }

  private async startOAuth(system: SystemId): Promise<void> {
    this.busyServer.set(system);
    try {
      const { authorizeUrl } = await firstValueFrom(
        this.connectionsApi.startConnectOAuth(system, { returnPath: '/catalog' }),
      );
      if (!isHttpUrl(authorizeUrl)) {
        this.banner.set({ kind: 'error', failure: { code: 'internal_error', status: 200 } });
        return;
      }
      this.navigation.assign(authorizeUrl);
    } catch (error) {
      this.banner.set({ kind: 'error', failure: toApiFailure(error) });
    } finally {
      this.busyServer.set(null);
    }
  }

  private async disconnect(system: SystemId): Promise<void> {
    const name = systemName(system);
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: {
            title: $localize`:@@disconnect.title:Odłączyć konto ${name}:system:?`,
            message: $localize`:@@disconnect.message:Portal usunie zapisane poświadczenie. Narzędzia tego systemu przestaną działać, dopóki nie połączysz konta ponownie.`,
            confirmLabel: $localize`:@@disconnect.confirm:Odłącz`,
          },
        })
        .afterClosed(),
    );
    if (!confirmed) {
      return;
    }
    this.busyServer.set(system);
    try {
      await firstValueFrom(this.connectionsApi.disconnect(system));
      this.banner.set({
        kind: 'success',
        text: $localize`:@@disconnect.done:Odłączono konto ${name}:system:.`,
      });
      await this.load();
    } catch (error) {
      this.banner.set({ kind: 'error', failure: toApiFailure(error) });
    } finally {
      this.busyServer.set(null);
    }
  }

  /** Result of the OAuth callback redirect (CC-022), shown once and then removed from the URL. */
  private readCallbackResult(): void {
    const params = this.route.snapshot.queryParamMap;
    const connected = params.get('connected');
    const connectError = params.get('connectError');
    if (connected === null && connectError === null) {
      return;
    }
    if (connectError !== null) {
      const code = (CONNECT_ERRORS as readonly string[]).includes(connectError)
        ? (connectError as PortalErrorCode)
        : 'internal_error';
      this.banner.set({ kind: 'error', failure: { code, status: 0 } });
    } else if (isSystemId(connected)) {
      this.banner.set({
        kind: 'success',
        text: $localize`:@@catalog.oauthConnected:Połączono konto ${systemName(connected)}:system:.`,
      });
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { connected: null, connectError: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
