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
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AdminService,
  CredentialType,
  ServerConfig,
  ServerConfigCreate,
  ServerConfigPatch,
  SystemAdminView,
} from '../../api/generated';
import { AdminStepUp } from '../../core/admin-step-up';
import { etagOf } from '../../core/admin-etag';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { LOADING, LoadState } from '../../core/load-state';
import { credentialTypeLabel, systemName } from '../../shared/labels';
import { ConfirmDialog, ConfirmDialogData } from '../../shared/confirm-dialog';
import { ErrorNotice } from '../../shared/error-notice';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';
import { SafeTextPipe } from '../../shared/safe-text.pipe';
import { AdminNav } from './admin-nav';
import { SYSTEM_ID, isHttpsUrl } from './admin-validation';

const PAGE = '/admin/servers';
const USER_TYPES: readonly CredentialType[] = ['user-oauth', 'user-secret'];

export interface ServerForm {
  mode: 'create' | 'edit';
  system: string;
  internalUrl: string;
  required: boolean;
  acceptedTypes: CredentialType[];
  type: CredentialType;
  enabled: boolean;
  adapter: boolean;
}

interface Editing {
  form: ServerForm;
  original: ServerConfig | null;
  etag: string | null;
}

const EMPTY_FORM: ServerForm = {
  mode: 'create',
  system: '',
  internalUrl: '',
  required: true,
  acceptedTypes: ['user-oauth'],
  type: 'user-oauth',
  enabled: true,
  adapter: false,
};

/** What differs between the stored server and the form; the PATCH carries only that. */
export function serverPatch(original: ServerConfig, form: ServerForm): ServerConfigPatch {
  const patch: ServerConfigPatch = {};
  if (form.internalUrl.trim() !== original.internalUrl) {
    patch.internalUrl = form.internalUrl.trim();
  }
  const same =
    form.required === original.credential.required &&
    form.type === original.credential.type &&
    form.acceptedTypes.length === original.credential.acceptedTypes.length &&
    form.acceptedTypes.every((type) => original.credential.acceptedTypes.includes(type));
  if (!same) {
    patch.credential = {
      required: form.required,
      acceptedTypes: form.acceptedTypes,
      type: form.type,
    };
  }
  if (form.enabled !== original.enabled) {
    patch.enabled = form.enabled;
  }
  return patch;
}

/**
 * "Servers" (C12 over C5, CC-234): the registry of the gateway as an administrator edits it. A server added here has
 * no tools until its manifest is approved on the Approvals screen; removing one takes its tools out of the catalog and
 * refuses its calls. Adding, changing and removing need a fresh MFA; the unsaved form survives the trip to the IdP.
 */
@Component({
  selector: 'app-servers-page',
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
  templateUrl: './servers-page.html',
  styleUrls: ['./admin-common.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServersPage implements OnInit {
  private readonly adminApi = inject(AdminService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly stepUp = inject(AdminStepUp);

  /** `mfa=ok` in the URL after the IdP returned from the fresh MFA. */
  readonly mfa = input<string | undefined>();

  protected readonly state = signal<LoadState<ServerConfig[]>>(LOADING);
  protected readonly systems = signal<readonly string[]>([]);
  protected readonly editing = signal<Editing | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<ApiFailure | null>(null);
  protected readonly done = signal<string | null>(null);
  protected readonly mfaNote = signal<'draft' | 'repeat' | null>(null);
  protected readonly touched = signal(false);
  /** The page was opened by the return from the IdP; a repeated step-up request is then an error, not a loop. */
  private returnedAt = 0;

  protected readonly allTypes: readonly CredentialType[] = [
    'user-oauth',
    'user-secret',
    'token-exchange',
    'service-account',
  ];
  protected readonly typeLabel = credentialTypeLabel;
  protected readonly systemName = systemName;

  protected readonly form = computed(() => this.editing()?.form ?? null);
  protected readonly serverId = computed(() => {
    const form = this.form();
    return form && form.mode === 'create' ? `mcp-${form.system.trim()}` : '';
  });
  protected readonly errors = computed(() => {
    const form = this.form();
    const found: Record<string, string> = {};
    if (!form) {
      return found;
    }
    if (form.mode === 'create' && !SYSTEM_ID.test(form.system.trim())) {
      found['system'] =
        $localize`:@@adminServers.errSystem:Use 2 to 31 lower case letters and digits, starting with a letter. The identifiers gateway, offboarding, portal, broker, prometheus, platform, admin, registry, adapter, internal and ci are reserved.`;
    }
    if (!isHttpsUrl(form.internalUrl.trim())) {
      found['internalUrl'] =
        $localize`:@@adminServers.errUrl:Enter an https address, for example https://mcp-notes.internal:8443/mcp.`;
    }
    if (form.acceptedTypes.length === 0) {
      found['acceptedTypes'] =
        $localize`:@@adminServers.errAccepted:Choose at least one credential type.`;
    } else if (!form.acceptedTypes.includes(form.type)) {
      found['type'] =
        $localize`:@@adminServers.errType:The type in use has to be one of the accepted types.`;
    } else if (
      form.acceptedTypes.includes('service-account') &&
      form.acceptedTypes.some((type) => USER_TYPES.includes(type))
    ) {
      found['acceptedTypes'] =
        $localize`:@@adminServers.errMixed:A service account cannot be combined with a user credential type.`;
    }
    return found;
  });
  protected readonly valid = computed(() => Object.keys(this.errors()).length === 0);

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
    void this.loadSystems();
    if (this.mfa() === 'ok') {
      this.returnedAt = Date.now();
      const draft = this.stepUp.takeDraft<ServerForm & { etag: string | null }>(PAGE);
      void this.router.navigate([], { queryParams: { mfa: null }, replaceUrl: true });
      if (draft && typeof draft === 'object' && Array.isArray(draft.acceptedTypes)) {
        const { etag, ...form } = draft;
        const state = this.state();
        const original =
          form.mode === 'edit' && state.status === 'ready'
            ? (state.value.find((server) => server.serverId === `mcp-${form.system}`) ?? null)
            : null;
        this.editing.set({ form: { ...EMPTY_FORM, ...form }, original, etag: etag ?? null });
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
      this.state.set({
        status: 'ready',
        value: await firstValueFrom(this.adminApi.listAdminServers()),
      });
    } catch (error) {
      this.state.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  /** The systems the broker knows, only to suggest them while typing; the field accepts any valid identifier. */
  private async loadSystems(): Promise<void> {
    try {
      const list: SystemAdminView[] = await firstValueFrom(this.adminApi.listAdminSystems());
      this.systems.set(list.map((system) => system.system));
    } catch {
      this.systems.set([]);
    }
  }

  protected rows = computed(() => {
    const state = this.state();
    return state.status === 'ready'
      ? state.value.map((server) => ({
          server,
          types: server.credential.acceptedTypes
            .map((type) => credentialTypeLabel(type))
            .join(', '),
          typeInUse: credentialTypeLabel(server.credential.type),
        }))
      : [];
  });

  protected openCreate(): void {
    this.reset();
    this.editing.set({
      form: { ...EMPTY_FORM, acceptedTypes: [...EMPTY_FORM.acceptedTypes] },
      original: null,
      etag: null,
    });
  }

  protected async openEdit(server: ServerConfig): Promise<void> {
    this.reset();
    this.busy.set(true);
    try {
      const response: HttpResponse<ServerConfig> = await firstValueFrom(
        this.adminApi.getAdminServer(server.serverId, 'response'),
      );
      const current = response.body ?? server;
      this.editing.set({
        form: {
          mode: 'edit',
          system: current.system,
          internalUrl: current.internalUrl,
          required: current.credential.required,
          acceptedTypes: [...current.credential.acceptedTypes],
          type: current.credential.type,
          enabled: current.enabled,
          adapter: current.adapter,
        },
        original: current,
        etag: etagOf(response),
      });
    } catch (error) {
      this.failure.set(toApiFailure(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected cancel(): void {
    this.editing.set(null);
    this.touched.set(false);
    this.failure.set(null);
  }

  private reset(): void {
    this.failure.set(null);
    this.done.set(null);
    this.mfaNote.set(null);
    this.touched.set(false);
  }

  protected change(change: Partial<ServerForm>): void {
    this.editing.update((current) =>
      current ? { ...current, form: { ...current.form, ...change } } : current,
    );
  }

  protected toggleType(type: CredentialType, on: boolean): void {
    const form = this.form();
    if (!form) {
      return;
    }
    const accepted = on
      ? [...new Set([...form.acceptedTypes, type])]
      : form.acceptedTypes.filter((candidate) => candidate !== type);
    this.change({
      acceptedTypes: accepted,
      type: accepted.includes(form.type) ? form.type : (accepted[0] ?? form.type),
    });
  }

  protected async save(): Promise<void> {
    const returned = this.takeReturn();
    const current = this.editing();
    this.touched.set(true);
    if (!current || !this.valid() || this.busy()) {
      return;
    }
    const form = current.form;
    this.busy.set(true);
    this.failure.set(null);
    try {
      if (form.mode === 'create') {
        const body: ServerConfigCreate = {
          serverId: this.serverId(),
          system: form.system.trim(),
          internalUrl: form.internalUrl.trim(),
          credential: {
            required: form.required,
            acceptedTypes: form.acceptedTypes,
            type: form.type,
          },
          enabled: form.enabled,
          adapter: form.adapter,
        };
        await firstValueFrom(this.adminApi.createAdminServer(body));
        this.done.set(
          $localize`:@@adminServers.added:Added the server ${body.serverId}:server:. It has no tools until its manifest is approved.`,
        );
      } else if (current.original) {
        const patch = serverPatch(current.original, form);
        if (Object.keys(patch).length === 0) {
          this.done.set($localize`:@@adminServers.noChange:Nothing changed.`);
          this.editing.set(null);
          return;
        }
        if (!current.etag) {
          this.failure.set({ code: 'precondition_required', status: 428 });
          return;
        }
        await firstValueFrom(
          this.adminApi.updateAdminServer(current.etag, current.original.serverId, patch),
        );
        this.done.set(
          $localize`:@@adminServers.saved:Saved the settings of ${current.original.serverId}:server:.`,
        );
      }
      this.editing.set(null);
      this.touched.set(false);
      await this.read();
    } catch (error) {
      const failure = toApiFailure(error);
      if (
        this.stepUp.redirectIfRequired(failure, PAGE, { ...form, etag: current.etag }, returned)
      ) {
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

  /**
   * Taking a server out of service must not wait for a second factor (an incident): the BFF and the gateway leave a body
   * that only sets enabled false without the step-up, and every other change still needs it.
   */
  protected async disable(server: ServerConfig): Promise<void> {
    const returned = this.takeReturn();
    if (this.busy()) {
      return;
    }
    const id = server.serverId;
    this.busy.set(true);
    this.reset();
    try {
      const response = await firstValueFrom(this.adminApi.getAdminServer(id, 'response'));
      const etag = etagOf(response);
      if (!etag) {
        this.failure.set({ code: 'precondition_required', status: 428 });
        return;
      }
      await firstValueFrom(this.adminApi.updateAdminServer(etag, id, { enabled: false }));
      this.done.set(
        $localize`:@@adminServers.disabledDone:Disabled the server ${id}:server:. Its tools are out of service.`,
      );
      await this.read();
    } catch (error) {
      const failure = toApiFailure(error);
      if (!this.stepUp.redirectIfRequired(failure, PAGE, undefined, returned)) {
        this.failure.set(failure);
        if (failure.code === 'precondition_failed') {
          await this.read();
        }
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(server: ServerConfig): Promise<void> {
    const returned = this.takeReturn();
    if (this.busy()) {
      return;
    }
    const id = server.serverId;
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: {
            title: $localize`:@@adminServers.removeTitle:Remove the server ${id}:server:?`,
            message: $localize`:@@adminServers.removeMessage:Its tools disappear from the catalog and tools/list, calls to it are refused, and the scope mapping entries of its resource types are removed. The system and the users' connections stay. Removing needs a fresh MFA.`,
            confirmLabel: $localize`:@@adminServers.removeConfirm:Remove server`,
            destructive: true,
          },
        })
        .afterClosed(),
    );
    if (confirmed !== true) {
      return;
    }
    this.busy.set(true);
    this.reset();
    try {
      await firstValueFrom(this.adminApi.deleteAdminServer(id));
      this.done.set($localize`:@@adminServers.removed:Removed the server ${id}:server:.`);
      await this.read();
    } catch (error) {
      const failure = toApiFailure(error);
      if (!this.stepUp.redirectIfRequired(failure, PAGE, undefined, returned)) {
        this.failure.set(failure);
      }
    } finally {
      this.busy.set(false);
    }
  }
}
