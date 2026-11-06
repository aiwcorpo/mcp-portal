import { HttpResponse } from '@angular/common/http';
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
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AdminService, ResourceTypeDeclaration, ScopeMappingDocument } from '../../api/generated';
import { AdminStepUp } from '../../core/admin-step-up';
import { etagOf } from '../../core/admin-etag';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { LOADING, LoadState } from '../../core/load-state';
import { ErrorNotice } from '../../shared/error-notice';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';
import { SafeTextPipe } from '../../shared/safe-text.pipe';
import { AdminNav } from './admin-nav';
import { GROUP_NAME, RESOURCE_SCOPE_ID, splitList } from './admin-validation';

const PAGE = '/admin/scope-mapping';

export interface MappingRow {
  key: number;
  group: string;
  /** One scope id per line or separated by spaces or commas. */
  scopes: string;
}

interface Loaded {
  rows: MappingRow[];
  etag: string | null;
}

export interface DeclaredType {
  server: string;
  declaration: ResourceTypeDeclaration;
}

export interface RowProblems {
  group?: string;
  scopes?: string;
  /** Hints from the approved declarations of the registered servers; the gateway still decides on save. */
  warning?: string;
}

/** The scope ids a row grants, without repeats. */
export function scopesOf(row: MappingRow): string[] {
  return [...new Set(splitList(row.scopes))];
}

/**
 * Checks a row the way the contract's patterns do, and every scope against the approved declarations of the registered
 * servers when there are any: a type nobody declares or one without `scopePattern` cannot be granted, and the part after
 * the slash has to match the pattern. These are warnings (the gateway decides, and a server may have been approved
 * meanwhile); a pattern in the Java-only part of the syntax is skipped here.
 */
export function checkRow(
  row: MappingRow,
  groupCounts: ReadonlyMap<string, number>,
  declared: readonly DeclaredType[] = [],
): RowProblems {
  const problems: RowProblems = {};
  const group = row.group.trim();
  if (!GROUP_NAME.test(group) || group.length > 255) {
    problems.group = $localize`:@@scopeMapping.errGroup:A group name starts with mcp- and uses letters, digits, dots, underscores and hyphens.`;
  } else if ((groupCounts.get(group) ?? 0) > 1) {
    problems.group = $localize`:@@scopeMapping.errDuplicate:This group appears twice.`;
  }
  const scopes = scopesOf(row);
  if (scopes.length === 0) {
    problems.scopes = $localize`:@@scopeMapping.errNoScopes:Enter at least one scope, for example Type::Name/id.`;
    return problems;
  }
  const bad = scopes.find((scope) => !RESOURCE_SCOPE_ID.test(scope));
  if (bad) {
    problems.scopes = $localize`:@@scopeMapping.errScope:${bad}:scope: is not a scope id. Use <Namespace>::<Type>/<id>, ASCII only.`;
    return problems;
  }
  for (const scope of declared.length > 0 ? scopes : []) {
    const slash = scope.indexOf('/');
    const type = scope.slice(0, slash);
    const local = scope.slice(slash + 1);
    const match = declared.find((candidate) => candidate.declaration.type === type);
    if (!match) {
      problems.warning = $localize`:@@scopeMapping.warnType:No registered server declares ${type}:type:; the gateway will refuse ${scope}:scope:.`;
      break;
    }
    const pattern = match.declaration.scopePattern;
    if (!pattern) {
      problems.warning = $localize`:@@scopeMapping.warnNotGrantable:${type}:type: has no scope pattern, so it cannot be granted; the gateway will refuse ${scope}:scope:.`;
      break;
    }
    try {
      if (!new RegExp(pattern).test(local)) {
        problems.warning = $localize`:@@scopeMapping.warnPattern:${local}:id: does not match the scope pattern of ${type}:type: (${pattern}:pattern:).`;
        break;
      }
    } catch {
      // A pattern in the Java-only part of the syntax: only the gateway can judge it.
    }
  }
  return problems;
}

let nextKey = 1;

/**
 * "Scope mapping" (C12 over C5, CC-234): which group grants which resource scopes. The whole document is replaced at
 * once with the ETag it was read with; the gateway rejects scopes of undeclared types or of ids that do not fit the
 * scope pattern, and the page shows what it says. A change that widens access needs a fresh MFA.
 */
@Component({
  selector: 'app-scope-mapping-page',
  imports: [
    FormsModule,
    MatButtonModule,
    AdminNav,
    ErrorNotice,
    LoadError,
    Loading,
    Notice,
    SafeTextPipe,
  ],
  templateUrl: './scope-mapping-page.html',
  styleUrls: ['./admin-common.scss', './scope-mapping-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScopeMappingPage implements OnInit {
  private readonly adminApi = inject(AdminService);
  private readonly router = inject(Router);
  private readonly stepUp = inject(AdminStepUp);

  readonly mfa = input<string | undefined>();

  protected readonly state = signal<LoadState<Loaded>>(LOADING);
  protected readonly rows = signal<MappingRow[]>([]);
  protected readonly etag = signal<string | null>(null);
  protected readonly declared = signal<readonly DeclaredType[]>([]);
  protected readonly busy = signal(false);
  protected readonly failure = signal<ApiFailure | null>(null);
  protected readonly done = signal<string | null>(null);
  protected readonly mfaNote = signal<'draft' | 'repeat' | null>(null);
  protected readonly touched = signal(false);
  /** The page was opened by the return from the IdP; a repeated step-up request is then an error, not a loop. */
  private returnedAt = 0;
  protected readonly dirty = signal(false);

  protected readonly problems = computed(() => {
    const rows = this.rows();
    const counts = new Map<string, number>();
    for (const row of rows) {
      const group = row.group.trim();
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return new Map(rows.map((row) => [row.key, checkRow(row, counts, this.declared())]));
  });
  protected readonly valid = computed(() =>
    [...this.problems().values()].every((problem) => !problem.group && !problem.scopes),
  );

  /** True for the first write within a minute of the return from the IdP: a step-up request then means the login was no MFA. */
  private takeReturn(): boolean {
    const recent = Date.now() - this.returnedAt < 60_000;
    this.returnedAt = 0;
    return recent;
  }

  ngOnInit(): void {
    void this.start();
  }

  private async start(): Promise<void> {
    await this.load();
    void this.loadDeclared();
    if (this.mfa() === 'ok') {
      this.returnedAt = Date.now();
      const draft = this.stepUp.takeDraft<{ rows: MappingRow[]; etag: string | null }>(PAGE);
      void this.router.navigate([], { queryParams: { mfa: null }, replaceUrl: true });
      if (draft && Array.isArray(draft.rows)) {
        this.rows.set(
          draft.rows.map((row) => ({
            key: nextKey++,
            group: String(row.group),
            scopes: String(row.scopes),
          })),
        );
        this.etag.set(draft.etag ?? this.etag());
        this.dirty.set(true);
        this.mfaNote.set('draft');
      } else {
        this.mfaNote.set('repeat');
      }
    }
  }

  protected async load(): Promise<void> {
    this.state.set(LOADING);
    await this.read();
  }

  private async read(): Promise<void> {
    try {
      const response: HttpResponse<ScopeMappingDocument> = await firstValueFrom(
        this.adminApi.getAdminScopeMapping('response'),
      );
      const rows = (response.body?.scopeMapping ?? []).map((entry) => ({
        key: nextKey++,
        group: entry.group,
        scopes: entry.scopes.join('\n'),
      }));
      const loaded = { rows, etag: etagOf(response) };
      this.rows.set(rows);
      this.etag.set(loaded.etag);
      this.dirty.set(false);
      this.state.set({ status: 'ready', value: loaded });
    } catch (error) {
      this.state.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  /**
   * The approved declarations of the registered servers (C12 getAdminServerPolicies), to explain a scope before the gateway
   * refuses it. Best effort: a server that does not answer only means fewer hints.
   */
  private async loadDeclared(): Promise<void> {
    try {
      const servers = await firstValueFrom(this.adminApi.listAdminServers());
      const answers = await Promise.allSettled(
        servers.map(async (server) => ({
          server: server.serverId,
          approved: await firstValueFrom(this.adminApi.getAdminServerPolicies(server.serverId)),
        })),
      );
      const found: DeclaredType[] = [];
      for (const answer of answers) {
        if (answer.status === 'fulfilled') {
          const types = answer.value.approved.approvedResourceTypes ?? [];
          found.push(...types.map((declaration) => ({ server: answer.value.server, declaration })));
        }
      }
      this.declared.set(found);
    } catch {
      this.declared.set([]);
    }
  }

  protected edit(key: number, change: Partial<MappingRow>): void {
    this.rows.update((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
    this.dirty.set(true);
  }

  protected add(): void {
    this.rows.update((rows) => [...rows, { key: nextKey++, group: 'mcp-', scopes: '' }]);
    this.dirty.set(true);
    this.done.set(null);
  }

  protected removeRow(key: number): void {
    this.rows.update((rows) => rows.filter((row) => row.key !== key));
    this.dirty.set(true);
  }

  protected async reload(): Promise<void> {
    this.failure.set(null);
    this.touched.set(false);
    await this.load();
  }

  protected async save(): Promise<void> {
    const returned = this.takeReturn();
    this.touched.set(true);
    if (!this.valid() || this.busy()) {
      return;
    }
    const etag = this.etag();
    if (!etag) {
      this.failure.set({ code: 'precondition_required', status: 428 });
      return;
    }
    const rows = this.rows();
    this.busy.set(true);
    this.failure.set(null);
    this.done.set(null);
    try {
      const body: ScopeMappingDocument = {
        scopeMapping: rows.map((row) => ({ group: row.group.trim(), scopes: scopesOf(row) })),
      };
      const response = await firstValueFrom(
        this.adminApi.putAdminScopeMapping(etag, body, 'response'),
      );
      this.etag.set(etagOf(response));
      this.done.set(
        $localize`:@@scopeMapping.saved:Saved the scope mapping. Servers pick it up within seconds.`,
      );
      this.touched.set(false);
      await this.read();
    } catch (error) {
      const failure = toApiFailure(error);
      if (this.stepUp.redirectIfRequired(failure, PAGE, { rows, etag }, returned)) {
        return;
      }
      this.failure.set(failure);
      if (failure.code === 'precondition_failed') {
        await this.read();
      }
    } finally {
      this.busy.set(false);
    }
  }
}
