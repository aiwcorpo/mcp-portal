import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import {
  AdminService,
  ApprovePoliciesResult,
  KillSwitch,
  RegistryServer,
  RegistryTool,
  ServerConfig,
} from '../../api/generated';
import { toApiFailure } from '../../core/api-error';
import { NotificationService } from '../../core/notification.service';
import { LOADING, LoadState } from '../../core/load-state';
import { SessionService } from '../../core/session.service';
import { HASH, ResumeIntentStore, ResumeOf } from '../../core/resume-intent';
import { Tone, riskOrUnclassified } from '../../shared/labels';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';
import { neutraliseText } from '../../shared/untrusted-text';
import { SafeTextPipe } from '../../shared/safe-text.pipe';
import { AdminNav } from './admin-nav';
import { ConnectionApproval, ConnectionApprovalIntent } from './connection-approval';
import { AdminSystemNames } from './system-names';
import { PolicyApprovalIntent, PolicyDiffView } from './policy-diff-view';
import { ToolDiff } from './tool-diff';

interface ToolRow {
  tool: RegistryTool;
  key: string;
  /** Gateway-prefixed name, the one the catalog and the agents see. */
  name: string;
  title: string;
  pending: boolean;
  state: string;
  tone: Tone;
}

interface ServerRow {
  server: RegistryServer;
  name: string;
  pendingCount: number;
  /** The policies and resource types of the server wait for approval; its tools are blocked until then. */
  policiesPending: boolean;
  changes: string;
  state: string;
  tone: Tone;
  tools: ToolRow[];
}

function changesText(created: number, changed: number): string {
  if (!created && !changed) {
    return '';
  }
  const parts: string[] = [];
  if (created) {
    parts.push($localize`:@@admin.newCount:new: ${created}:count:`);
  }
  if (changed) {
    parts.push($localize`:@@admin.changedCount:changed: ${changed}:count:`);
  }
  return parts.join(', ');
}

function toolRow(server: RegistryServer, tool: RegistryTool, switchedOff: boolean): ToolRow {
  const pending = tool.status === 'pending_approval';
  const risk = riskOrUnclassified(tool.risk);
  const waiting = !pending
    ? $localize`:@@admin.toolApproved:Approved · ${risk}:risk:`
    : tool.riskLowered
      ? $localize`:@@admin.toolRiskLowered:Risk lowering · ${risk}:risk:`
      : tool.change === 'new'
        ? $localize`:@@admin.toolNew:New · ${risk}:risk:`
        : $localize`:@@admin.toolChanged:Changed · ${risk}:risk:`;
  // An emergency switch (CC-194) is the stronger fact: nothing else matters while the tool is off.
  const state = switchedOff
    ? $localize`:@@admin.toolSwitchedOff:Switched off · ${risk}:risk:`
    : waiting;
  return {
    tool,
    key: `${server.serverId}/${tool.name}`,
    name: neutraliseText(`${server.system}__${tool.name}`).text,
    title: neutraliseText(tool.definition.title).text,
    pending,
    state,
    tone: switchedOff || tool.riskLowered ? 'error' : pending ? 'warn' : 'neutral',
  };
}

/**
 * "Administracja" (mockup 07): the registry as the gateway holds it. A new or changed tool is not given to
 * agents until it is approved here; the view only reads and approves, there is no "Reject" (CC-097).
 */
@Component({
  selector: 'app-admin-page',
  imports: [
    SafeTextPipe,
    MatButtonModule,
    AdminNav,
    ConnectionApproval,
    LoadError,
    Loading,
    Notice,
    PolicyDiffView,
    ToolDiff,
  ],
  templateUrl: './admin-page.html',
  styleUrl: './admin-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPage implements OnInit {
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  /** `mfa=ok` in the URL after the IdP returned from the fresh MFA that lowering a risk needs. */
  readonly mfa = input<string | undefined>();
  protected readonly mfaReturned = signal(false);
  /** The approval confirmed before the MFA; its diff opens by itself and the approval is carried out there. */
  protected readonly resumeApproval = signal<ResumeOf<'approve-tool'> | null>(null);
  protected readonly resumedFromMfa = signal(false);
  private readonly resumeStore = inject(ResumeIntentStore);
  private readonly systemNames = inject(AdminSystemNames);
  private readonly session = inject(SessionService);

  private readonly adminApi = inject(AdminService);

  protected readonly showLabel = $localize`:@@admin.showTools:Show tools`;
  protected readonly hideLabel = $localize`:@@admin.hideTools:Hide tools`;
  protected readonly registry = signal<LoadState<RegistryServer[]>>(LOADING);
  /** The emergency switches that are on; a failed read leaves the list empty, the registry is shown anyway. */
  protected readonly switches = signal<readonly KillSwitch[]>([]);
  protected readonly opened = signal<ReadonlySet<string>>(new Set());
  protected readonly closedByUser = signal<ReadonlySet<string>>(new Set());
  protected readonly diffOpen = signal<ReadonlySet<string>>(new Set());
  protected readonly policiesOpen = signal<ReadonlySet<string>>(new Set());
  /** The policy approval confirmed before the MFA; carried out by the diff of that server when its hash is unchanged. */
  protected readonly resumePolicies = signal<PolicyApprovalIntent | null>(null);
  /** Servers of C5: the pending connections come from here, the tools and policies from the registry. */
  protected readonly servers = signal<readonly ServerConfig[]>([]);
  /** The connection approval started before the MFA; carried out by the card of that server. */
  protected readonly resumeConnection = signal<ConnectionApprovalIntent | null>(null);
  protected readonly ignoredEntries = signal<ApprovePoliciesResult['ignoredMappingEntries']>([]);

  protected readonly rows = computed<ServerRow[]>(() => {
    const state = this.registry();
    if (state.status !== 'ready') {
      return [];
    }
    const switches = this.switches();
    return state.value.map((server) => {
      const serverOff = switches.some(
        (entry) => entry.serverId === server.serverId && entry.scope === 'server',
      );
      const tools = server.tools.map((tool) =>
        toolRow(
          server,
          tool,
          serverOff ||
            switches.some(
              (entry) =>
                entry.serverId === server.serverId &&
                entry.scope === 'tool' &&
                entry.tool === tool.name,
            ),
        ),
      );
      const pendingTools = server.tools.filter((tool) => tool.status === 'pending_approval');
      const created = pendingTools.filter((tool) => tool.change === 'new').length;
      const enabled = server.enabled !== false;
      const policiesPending = server.policiesStatus === 'pending_approval';
      return {
        server,
        name: this.systemNames.name(server.system),
        pendingCount: pendingTools.length,
        policiesPending,
        changes: changesText(created, pendingTools.length - created),
        state: serverOff
          ? $localize`:@@admin.serverSwitchedOff:Switched off`
          : !enabled
            ? $localize`:@@admin.serverDisabled:Disabled`
            : pendingTools.length || policiesPending
              ? $localize`:@@admin.serverPending:Pending approval`
              : $localize`:@@admin.serverActive:Active`,
        tone:
          serverOff || !enabled ? 'error' : pendingTools.length || policiesPending ? 'warn' : 'ok',
        tools,
      };
    });
  });
  protected readonly pendingConnections = computed(() =>
    this.servers()
      .filter((server) => server.pendingConnection !== null)
      .map((server) => ({ server, name: this.systemNames.name(server.system) })),
  );
  protected readonly totalPending = computed(() =>
    this.rows().reduce((sum, row) => sum + row.pendingCount, 0),
  );
  protected readonly policiesPendingTotal = computed(
    () => this.rows().filter((row) => row.policiesPending).length,
  );

  constructor() {
    void this.systemNames.load();
    void this.load();
  }

  ngOnInit(): void {
    if (this.mfa() === 'ok') {
      this.mfaReturned.set(true);
      const kept = this.resumeStore.takeAny(this.session.username());
      const intent = kept?.kind === 'approve-tool' ? kept : null;
      if (intent) {
        this.resumeApproval.set(intent);
        this.resumedFromMfa.set(true);
        this.diffOpen.update((set) => addTo(set, `${intent.serverId}/${intent.tool}`));
        this.opened.update((set) => addTo(set, intent.serverId));
      }
      const draft = this.draftOf(kept);
      if (draft?.op === 'approve-policies') {
        this.resumePolicies.set(draft);
        this.resumedFromMfa.set(true);
        this.policiesOpen.update((set) => addTo(set, draft.serverId));
      } else if (draft?.op === 'approve-connection') {
        this.resumeConnection.set(draft);
        this.resumedFromMfa.set(true);
      }
      this.notifications.success(
        this.resumedFromMfa()
          ? $localize`:@@admin.mfaResumed:Identity confirmed. Approving what you picked before the confirmation.`
          : $localize`:@@admin.mfaDone:Identity confirmed. Open the differences and approve again.`,
      );
      void this.router.navigate([], { queryParams: { mfa: null }, replaceUrl: true });
    }
  }

  /**
   * The approval of policies or of a connection kept before the MFA: an `admin-draft` of this page with the server and
   * the hash or fingerprint it was about.
   */
  private draftOf(
    kept: ReturnType<ResumeIntentStore['takeAny']>,
  ): PolicyApprovalIntent | ConnectionApprovalIntent | null {
    if (kept?.kind !== 'admin-draft' || kept.page !== '/admin') {
      return null;
    }
    try {
      const parsed = JSON.parse(kept.draft) as PolicyApprovalIntent | ConnectionApprovalIntent;
      // Same shapes as the approval of a tool (resume-intent): the draft is read back from sessionStorage, so it is checked.
      if (
        typeof parsed.serverId !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(parsed.serverId)
      ) {
        return null;
      }
      if (parsed.op === 'approve-policies') {
        return typeof parsed.hash === 'string' && HASH.test(parsed.hash) ? parsed : null;
      }
      if (parsed.op === 'approve-connection') {
        const modes: readonly unknown[] = ['ca', 'pinned', 'plain'];
        return modes.includes(parsed.tlsMode) &&
          (parsed.fingerprint === null ||
            (typeof parsed.fingerprint === 'string' && HASH.test(parsed.fingerprint)))
          ? parsed
          : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  protected togglePolicies(serverId: string): void {
    this.policiesOpen.update((set) =>
      set.has(serverId) ? removeFrom(set, serverId) : addTo(set, serverId),
    );
  }

  protected onConnectionResumeHandled(): void {
    this.resumeConnection.set(null);
    this.resumedFromMfa.set(false);
  }

  protected async onConnectionApproved(card: {
    server: ServerConfig;
    name: string;
  }): Promise<void> {
    this.mfaReturned.set(false);
    this.resumedFromMfa.set(false);
    const name = card.name;
    this.notifications.success(
      $localize`:@@admin.connectionApproved:Approved the connection of ${name}:server:. Its policies and tools still need approval.`,
    );
    await this.read();
  }

  protected onPoliciesResumeHandled(): void {
    this.resumePolicies.set(null);
    this.resumedFromMfa.set(false);
  }

  protected async onPoliciesApproved(row: ServerRow, result: ApprovePoliciesResult): Promise<void> {
    this.policiesOpen.update((set) => removeFrom(set, row.server.serverId));
    this.mfaReturned.set(false);
    this.resumedFromMfa.set(false);
    this.ignoredEntries.set(result.ignoredMappingEntries);
    const name = row.name;
    this.notifications.success(
      $localize`:@@admin.policiesApproved:Approved the policies of ${name}:server:.`,
    );
    await this.read();
  }

  protected async load(): Promise<void> {
    this.registry.set(LOADING);
    await this.read();
  }

  protected reload(): Promise<void> {
    return this.read();
  }

  /** Reads the registry again without the loading state, so the page does not jump after an approval. */
  private async read(): Promise<void> {
    try {
      this.registry.set({
        status: 'ready',
        value: await firstValueFrom(this.adminApi.getAdminRegistry()),
      });
    } catch (error) {
      this.registry.set({ status: 'error', failure: toApiFailure(error) });
    }
    try {
      this.servers.set(await firstValueFrom(this.adminApi.listAdminServers()));
    } catch {
      // The registry above is the view; a failed read of the servers only leaves out the connection cards.
      this.servers.set([]);
    }
    try {
      this.switches.set((await firstValueFrom(this.adminApi.listAdminKillSwitches())).switches);
    } catch {
      // The switches are an addition to this view; their own page reports a failed read.
      this.switches.set([]);
    }
  }

  /** A server with something waiting is open from the start; the user can still close it. */
  protected isOpen(row: ServerRow): boolean {
    const id = row.server.serverId;
    return this.opened().has(id) || (row.pendingCount > 0 && !this.closedByUser().has(id));
  }

  protected toggleServer(row: ServerRow): void {
    const id = row.server.serverId;
    if (this.isOpen(row)) {
      this.opened.update((set) => removeFrom(set, id));
      this.closedByUser.update((set) => addTo(set, id));
    } else {
      this.opened.update((set) => addTo(set, id));
      this.closedByUser.update((set) => removeFrom(set, id));
    }
  }

  protected toggleDiff(key: string): void {
    this.diffOpen.update((set) => (set.has(key) ? removeFrom(set, key) : addTo(set, key)));
  }

  protected onResumeHandled(): void {
    this.resumeApproval.set(null);
    this.resumedFromMfa.set(false);
  }

  protected async onApproved(tool: ToolRow): Promise<void> {
    this.diffOpen.update((set) => removeFrom(set, tool.key));
    this.mfaReturned.set(false);
    this.resumedFromMfa.set(false);
    this.notifications.success(
      $localize`:@@admin.approved:Approved the definition of ${tool.name}:tool:.`,
    );
    await this.read();
  }

  protected async onGone(tool: ToolRow): Promise<void> {
    this.diffOpen.update((set) => removeFrom(set, tool.key));
    await this.read();
  }
}

function addTo(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  return new Set(set).add(value);
}

function removeFrom(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(value);
  return next;
}
