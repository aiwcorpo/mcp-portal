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
import { MatDialog } from '@angular/material/dialog';
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
import { failureMessage } from '../../core/error-messages';
import { NotificationService } from '../../core/notification.service';
import { LOADING, LoadState } from '../../core/load-state';
import { SessionService } from '../../core/session.service';
import { HASH, ResumeIntentStore, ResumeOf } from '../../core/resume-intent';
import { ConfirmDialog, ConfirmDialogData } from '../../shared/confirm-dialog';
import { Tone, riskOrUnclassified } from '../../shared/labels';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { StateLine } from '../../shared/state-line';
import { neutraliseText } from '../../shared/untrusted-text';
import { SafeTextPipe } from '../../shared/safe-text.pipe';
import { AdminNav } from './admin-nav';
import { ConnectionApproval, ConnectionApprovalIntent } from './connection-approval';
import { AdminSystemNames } from './system-names';
import { PolicyApprovalIntent, PolicyDiffView } from './policy-diff-view';
import { ToolDiff } from './tool-diff';
import { BatchExclusion, BatchItem, approveSequentially, batchExclusion } from './batch-approval';

interface ToolRow {
  tool: RegistryTool;
  key: string;
  /** Gateway-prefixed name, the one the catalog and the agents see. */
  name: string;
  title: string;
  pending: boolean;
  state: string;
  tone: Tone;
  /** The hash the list showed; a batch sends it, so a definition that changed after the list was read is refused. */
  hash: string;
  readOnly: boolean;
  /** Pending and not excluded from a batch. */
  selectable: boolean;
  /** One line under the tool when it cannot be selected. */
  exclusionText: string | null;
  selectLabel: string;
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

/** Batch in progress: the server it runs for and how many of its calls are done. */
interface BatchProgress {
  serverId: string;
  done: number;
  total: number;
}

interface RowFailure {
  text: string;
  /** A definition that changed meanwhile is a call to look again, not an error of the call. */
  tone: 'warning' | 'error';
}

const EXCLUSION_TEXTS: Record<BatchExclusion, () => string> = {
  'risk-lowered': () =>
    $localize`:@@admin.batchExcludedLowering:Lowers the risk: review and approve it on its own.`,
  'needs-classification': () =>
    $localize`:@@admin.batchExcludedClassify:Needs a classification: approve it on its own.`,
};

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
  const name = neutraliseText(`${server.system}__${tool.name}`).text;
  const exclusion = pending ? batchExclusion(tool) : null;
  return {
    tool,
    key: `${server.serverId}/${tool.name}`,
    name,
    title: neutraliseText(tool.definition.title).text,
    pending,
    state,
    tone: switchedOff || tool.riskLowered ? 'error' : pending ? 'warn' : 'neutral',
    hash: tool.definitionHash,
    readOnly: tool.risk === 'READ_ONLY',
    selectable: pending && exclusion === null,
    exclusionText: exclusion ? EXCLUSION_TEXTS[exclusion]() : null,
    selectLabel: $localize`:@@admin.batchSelectTool:Select ${name}:tool: for approval`,
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
    StateLine,
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
  private readonly dialog = inject(MatDialog);
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
  /** Tools picked for a batch, by `<serverId>/<tool>`, with the hash of the list they were picked from. */
  protected readonly selection = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly batch = signal<BatchProgress | null>(null);
  /** Why a tool of the last batch was not approved, shown in its row until it is picked again. */
  protected readonly batchFailures = signal<ReadonlyMap<string, RowFailure>>(new Map());
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

  /** Picked, and still the definition that was picked: a changed hash drops the pick, nobody chose that one. */
  protected isSelected(tool: ToolRow): boolean {
    return tool.selectable && this.selection().get(tool.key) === tool.hash;
  }

  protected selectedCount(row: ServerRow): number {
    return row.tools.filter((tool) => this.isSelected(tool)).length;
  }

  protected hasReadOnly(row: ServerRow): boolean {
    return row.tools.some((tool) => tool.selectable && tool.readOnly);
  }

  protected toggleSelected(tool: ToolRow): void {
    this.selection.update((map) => {
      const next = new Map(map);
      if (this.isSelected(tool)) {
        next.delete(tool.key);
      } else {
        next.set(tool.key, tool.hash);
      }
      return next;
    });
    this.batchFailures.update((map) => without(map, tool.key));
  }

  /** Replaces the picks of this server: all that a batch can approve, or only the reading ones. */
  protected selectAll(row: ServerRow, readOnlyOnly: boolean): void {
    const keys = new Set(row.tools.map((tool) => tool.key));
    this.selection.update((map) => {
      const next = new Map([...map].filter(([key]) => !keys.has(key)));
      for (const tool of row.tools) {
        if (tool.selectable && (!readOnlyOnly || tool.readOnly)) {
          next.set(tool.key, tool.hash);
        }
      }
      return next;
    });
    this.batchFailures.update((map) => new Map([...map].filter(([key]) => !keys.has(key))));
  }

  protected clearSelection(row: ServerRow): void {
    const keys = new Set(row.tools.map((tool) => tool.key));
    this.selection.update((map) => new Map([...map].filter(([key]) => !keys.has(key))));
  }

  protected batchLabel(row: ServerRow): string {
    const progress = this.batch();
    if (progress?.serverId === row.server.serverId) {
      const { done, total } = progress;
      return $localize`:@@admin.batchRunning:Approving ${done}:done:/${total}:total:`;
    }
    const count = this.selectedCount(row);
    return $localize`:@@admin.batchApprove:Approve selected (${count}:count:)`;
  }

  protected async approveSelected(row: ServerRow): Promise<void> {
    const picked = row.tools.filter((tool) => this.isSelected(tool));
    if (!picked.length || this.batch()) {
      return;
    }
    if (!(await this.confirmBatch(row, picked))) {
      return;
    }
    const serverId = row.server.serverId;
    const items: BatchItem[] = picked.map((tool) => ({
      key: tool.key,
      serverId,
      tool: tool.tool.name,
      hash: tool.hash,
    }));
    this.batchFailures.update(
      (map) => new Map([...map].filter(([key]) => !row.tools.some((tool) => tool.key === key))),
    );
    this.batch.set({ serverId, done: 0, total: items.length });
    const result = await approveSequentially(
      items,
      (item) =>
        firstValueFrom(
          this.adminApi.approveAdminTool(item.serverId, item.tool, {
            definitionHash: item.hash,
          }),
        ),
      toApiFailure,
      (done, total) => this.batch.set({ serverId, done, total }),
    );
    const failures = new Map<string, RowFailure>();
    for (const { key, failure } of result.failed) {
      failures.set(
        key,
        failure.code === 'hash_mismatch'
          ? {
              text: $localize`:@@admin.batchChanged:The definition changed after you picked it, nothing was approved. Open the differences and review it again.`,
              tone: 'warning',
            }
          : { text: failureMessage(failure), tone: 'error' },
      );
    }
    this.batchFailures.update((map) => new Map([...map, ...failures]));
    // The skipped ones stay picked, so the run can go on after the administrator has dealt with the confirmation.
    const done = new Set([...result.approved, ...result.failed.map((entry) => entry.key)]);
    this.selection.update((map) => new Map([...map].filter(([key]) => !done.has(key))));
    this.announceBatch(row, items.length, result.approved.length, result.stoppedForStepUp);
    await this.read();
    this.batch.set(null);
  }

  private announceBatch(row: ServerRow, total: number, approved: number, stepUp: boolean): void {
    const name = row.name;
    if (stepUp) {
      this.notifications.error(
        $localize`:@@admin.batchStepUp:The gateway asks for a fresh identity confirmation, so the run stopped after ${approved}:approved: of ${total}:total: tools of ${name}:server:. Approve the rest one by one.`,
      );
    } else if (approved === total) {
      this.notifications.success(
        $localize`:@@admin.batchDone:Approved ${approved}:approved: of ${total}:total: tools of ${name}:server:.`,
      );
    } else {
      this.notifications.error(
        $localize`:@@admin.batchPartial:Approved ${approved}:approved: of ${total}:total: tools of ${name}:server:. The others are marked in the list.`,
      );
    }
  }

  private async confirmBatch(row: ServerRow, picked: readonly ToolRow[]): Promise<boolean> {
    const count = picked.length;
    const name = row.name;
    const fromServer = picked.filter((tool) => tool.tool.source === 'server').length;
    const changed = picked.filter((tool) => tool.tool.change === 'changed').length;
    const parts = [
      $localize`:@@admin.batchConfirm.message:The definitions of ${count}:count: tools of ${name}:server: are approved as the list shows them, without opening the differences. A definition that changes before its turn is refused.`,
    ];
    if (changed) {
      parts.push(
        $localize`:@@admin.batchConfirm.changed:Changed definitions: ${changed}:count:, their differences are not shown here.`,
      );
    }
    if (fromServer) {
      parts.push(
        $localize`:@@admin.batchConfirm.server:Reported by the running server, not reviewed in code: ${fromServer}:count:.`,
      );
    }
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: {
            title: $localize`:@@admin.batchConfirm.title:Approve the selected tools?`,
            message: parts.join(' '),
            confirmLabel: $localize`:@@admin.batchConfirm.confirm:Approve ${count}:count:`,
            destructive: true,
          },
        })
        .afterClosed(),
    );
    return confirmed === true;
  }

  protected async onGone(tool: ToolRow): Promise<void> {
    this.diffOpen.update((set) => removeFrom(set, tool.key));
    await this.read();
  }
}

function addTo(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  return new Set(set).add(value);
}

function without<V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> {
  const next = new Map(map);
  next.delete(key);
  return next;
}

function removeFrom(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(value);
  return next;
}
