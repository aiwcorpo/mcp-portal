import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AdminService, KillSwitch, RegistryServer } from '../../api/generated';
import { toApiFailure } from '../../core/api-error';
import { NotificationService } from '../../core/notification.service';
import { stepUpUrlFor } from '../../core/auth-urls';
import { BrowserNavigation } from '../../core/browser-navigation';
import { LOADING, LoadState } from '../../core/load-state';
import { ResumeIntentStore } from '../../core/resume-intent';
import { SessionService } from '../../core/session.service';
import { ConfirmDialog, ConfirmDialogData } from '../../shared/confirm-dialog';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { SafeTextPipe } from '../../shared/safe-text.pipe';
import { neutraliseText } from '../../shared/untrusted-text';
import { AdminNav } from './admin-nav';
import { AdminSystemNames } from './system-names';
import { KILL_SWITCHES_PATH } from './admin-path';

/** The longest reason the contract takes (KillSwitchRequest.reason). */
export const REASON_MAX = 200;

interface Data {
  switches: KillSwitch[];
  servers: RegistryServer[];
}

interface Row {
  entry: KillSwitch;
  key: string;
  scope: string;
  target: string;
  toolName: string | null;
  serverName: string;
}

const keyOf = (serverId: string, tool: string | null | undefined): string =>
  `${serverId}/${tool ?? ''}`;

/**
 * "Emergency switches" (A9, CC-194): what an administrator has switched off, with switching off a server or one tool
 * and lifting a switch. Switching off needs no second factor because an incident must not wait for one; lifting needs a
 * fresh MFA, and the lift is carried out by itself after the return from the IdP (U12).
 */
@Component({
  selector: 'app-kill-switches-page',
  imports: [DatePipe, FormsModule, MatButtonModule, AdminNav, LoadError, Loading, SafeTextPipe],
  templateUrl: './kill-switches-page.html',
  styleUrl: './kill-switches-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KillSwitchesPage implements OnInit {
  private readonly adminApi = inject(AdminService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly navigation = inject(BrowserNavigation);
  private readonly resumeStore = inject(ResumeIntentStore);
  private readonly session = inject(SessionService);
  private readonly systemNames = inject(AdminSystemNames);
  private readonly router = inject(Router);

  /** `mfa=ok` in the URL after the IdP returned from the fresh MFA that lifting a switch needs. */
  readonly mfa = input<string | undefined>();

  protected readonly reasonMax = REASON_MAX;
  protected readonly state = signal<LoadState<Data>>(LOADING);
  protected readonly busy = signal(false);
  /** True only while the resumed lift runs: a second step_up_required then is an error, not a loop (U12). */
  private resuming = false;
  /** The switch changed while the administrator was at the IdP; nothing was lifted. */

  protected readonly serverId = signal('');
  protected readonly tool = signal('');
  protected readonly reason = signal('');

  protected readonly rows = computed<Row[]>(() => {
    const state = this.state();
    return state.status !== 'ready'
      ? []
      : state.value.switches.map((entry) => {
          const server = state.value.servers.find(
            (candidate) => candidate.serverId === entry.serverId,
          );
          const serverName = server ? this.systemNames.name(server.system) : entry.serverId;
          return {
            entry,
            key: keyOf(entry.serverId, entry.tool),
            scope:
              entry.scope === 'server'
                ? $localize`:@@killSwitches.scopeServer:Server`
                : $localize`:@@killSwitches.scopeTool:Tool`,
            target: neutraliseText(
              entry.scope === 'server'
                ? serverName
                : `${server?.system ?? entry.serverId}__${entry.tool ?? ''}`,
            ).text,
            toolName: entry.tool ?? null,
            serverName,
          };
        });
  });
  protected readonly servers = computed(() => {
    const state = this.state();
    return state.status === 'ready'
      ? state.value.servers.map((server) => ({
          id: server.serverId,
          name: this.systemNames.name(server.system),
        }))
      : [];
  });
  protected readonly tools = computed(() => {
    const state = this.state();
    const id = this.serverId();
    const server =
      state.status === 'ready' ? state.value.servers.find((s) => s.serverId === id) : null;
    return server ? server.tools.map((tool) => tool.name) : [];
  });
  protected readonly reasonLeft = computed(() => REASON_MAX - this.reason().length);
  protected readonly canSwitchOff = computed(
    () => this.serverId() !== '' && this.reason().trim().length > 0 && this.reasonLeft() >= 0,
  );

  ngOnInit(): void {
    void this.systemNames.load();
    void this.load().then(() => this.resumeLift());
  }

  protected async load(): Promise<void> {
    this.state.set(LOADING);
    await this.read();
  }

  private async read(): Promise<void> {
    try {
      const [list, servers] = await Promise.all([
        firstValueFrom(this.adminApi.listAdminKillSwitches()),
        firstValueFrom(this.adminApi.getAdminRegistry()),
      ]);
      this.state.set({ status: 'ready', value: { switches: list.switches, servers } });
    } catch (error) {
      this.state.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  protected onServer(value: string): void {
    this.serverId.set(value);
    this.tool.set('');
  }

  protected async switchOff(): Promise<void> {
    const id = this.serverId();
    if (id === '' || !this.canSwitchOff() || this.busy()) {
      return;
    }
    const tool = this.tool() || null;
    const target = tool ? `${this.serverName(id)}: ${tool}` : this.serverName(id);
    const confirmed = await this.confirm({
      title: $localize`:@@killSwitches.offTitle:Switch off now?`,
      message: $localize`:@@killSwitches.offMessage:${target}:target: will stop being available to all users and agents, on every gateway instance within 5 seconds at the latest. Calls that have already started are not interrupted. Switching off needs no identity confirmation; lifting does.`,
      confirmLabel: $localize`:@@killSwitches.offConfirm:Switch off`,
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    this.busy.set(true);
    try {
      const body = { reason: this.reason().trim() };
      await firstValueFrom(
        tool
          ? this.adminApi.putAdminToolKillSwitch(id, tool, body)
          : this.adminApi.putAdminServerKillSwitch(id, body),
      );
      this.notifications.success(
        $localize`:@@killSwitches.offDone:Switched off: ${target}:target:.`,
      );
      this.reason.set('');
      this.tool.set('');
      await this.read();
    } catch (error) {
      this.notifications.failure(toApiFailure(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async lift(row: Row): Promise<void> {
    if (this.busy()) {
      return;
    }
    const target = row.target;
    const confirmed = await this.confirm({
      title: $localize`:@@killSwitches.liftTitle:Lift the switch?`,
      message: $localize`:@@killSwitches.liftMessage:${target}:target: will be available again to users who have entitlements to it. Lifting requires fresh identity confirmation (MFA).`,
      confirmLabel: $localize`:@@killSwitches.liftConfirm:Lift switch`,
    });
    if (confirmed) {
      await this.performLift(row.entry.serverId, row.toolName, target, row.entry.setAt);
    }
  }

  private async performLift(
    serverId: string,
    tool: string | null,
    target: string,
    setAt: string,
  ): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(
        tool
          ? this.adminApi.deleteAdminToolKillSwitch(serverId, tool)
          : this.adminApi.deleteAdminServerKillSwitch(serverId),
      );
      this.notifications.success(
        $localize`:@@killSwitches.liftDone:Lifted switch: ${target}:target:.`,
      );
      await this.read();
    } catch (error) {
      const failure = toApiFailure(error);
      if (failure.code === 'step_up_required' && !this.resuming) {
        this.resumeStore.save(
          { kind: 'lift-kill-switch', serverId, tool, setAt },
          this.session.username(),
        );
        this.navigation.assign(
          stepUpUrlFor(failure.stepUpUrl, `${KILL_SWITCHES_PATH}?mfa=ok`, this.navigation.origin),
        );
        return;
      }
      this.notifications.failure(failure);
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * After the return from the IdP the lift that was confirmed before it is carried out once, without a second click. It
   * is carried out only for a switch that is still on; if somebody lifted it meanwhile nothing is sent.
   */
  private async resumeLift(): Promise<void> {
    if (this.mfa() !== 'ok') {
      return;
    }
    void this.router.navigate([], { queryParams: { mfa: null }, replaceUrl: true });
    const intent = this.resumeStore.take('lift-kill-switch', this.session.username());
    const state = this.state();
    if (!intent || state.status !== 'ready') {
      return;
    }
    const row = this.rows().find(
      (candidate) => candidate.key === keyOf(intent.serverId, intent.tool),
    );
    if (!row) {
      return;
    }
    // Only the switch the administrator saw: one lifted and put on again meanwhile is a new incident with its own reason.
    if (row.entry.setAt !== intent.setAt) {
      this.notifications.error(
        $localize`:@@killSwitches.resumeRefused:The switch changed before you confirmed your identity (someone lifted it and switched it on again), so nothing was lifted. Check the new reason and lift it again.`,
      );
      return;
    }
    this.notifications.success(
      $localize`:@@killSwitches.mfaResumed:Identity confirmed. Lifting the switch you picked before the confirmation.`,
    );
    this.resuming = true;
    try {
      await this.performLift(row.entry.serverId, row.toolName, row.target, row.entry.setAt);
    } finally {
      this.resuming = false;
    }
  }

  private serverName(id: string): string {
    const state = this.state();
    const server =
      state.status === 'ready' ? state.value.servers.find((s) => s.serverId === id) : null;
    return server ? this.systemNames.name(server.system) : id;
  }

  private async confirm(data: ConfirmDialogData): Promise<boolean> {
    const result = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, { data })
        .afterClosed(),
    );
    return result === true;
  }
}
