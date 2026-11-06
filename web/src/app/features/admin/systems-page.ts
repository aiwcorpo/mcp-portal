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
  CredentialScheme,
  CredentialType,
  SystemAdapter,
  SystemAdminRequest,
  SystemAdminView,
  SystemUserSecretScheme,
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
import { DURATION, OAUTH_SCOPE, SYSTEM_ID, isHttpsUrl, splitList } from './admin-validation';

const PAGE = '/admin/systems';
const USER_TYPES: readonly CredentialType[] = ['user-oauth', 'user-secret'];

export interface SystemForm {
  mode: 'create' | 'edit';
  system: string;
  baseUrl: string;
  adapter: SystemAdapter;
  product: '' | 'jira' | 'confluence';
  revokeUrl: string;
  timeout: string;
  exchangeAudience: string;
  userSecretScheme: '' | SystemUserSecretScheme;
  supportedTypes: CredentialType[];
  defaultType: CredentialType;
  secretScheme: CredentialScheme;
  clientId: string;
  /** Never part of a draft, never read back: the broker stores it and returns only `clientSecretSet`. */
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string;
}

interface Editing {
  form: SystemForm;
  original: SystemAdminView | null;
  etag: string | null;
}

const EMPTY_FORM: SystemForm = {
  mode: 'create',
  system: '',
  baseUrl: '',
  adapter: 'generic-rest',
  product: '',
  revokeUrl: '',
  timeout: '',
  exchangeAudience: '',
  userSecretScheme: '',
  supportedTypes: ['user-oauth'],
  defaultType: 'user-oauth',
  secretScheme: 'Bearer',
  clientId: '',
  clientSecret: '',
  authorizeUrl: '',
  tokenUrl: '',
  scopes: '',
};

/** Whether the system needs an OAuth client of its own: user OAuth and token exchange both do (C4 SystemAdminRequest). */
export function needsOauth(types: readonly CredentialType[]): boolean {
  return types.includes('user-oauth') || types.includes('token-exchange');
}

/**
 * The settings whose change deletes every user connection of the system without calling any endpoint (CC-238), and
 * for which the broker wants the client secret again (`client_secret_required`).
 */
export function changedAddresses(original: SystemAdminView, form: SystemForm): string[] {
  const changed: string[] = [];
  const same = (a: string | undefined, b: string): boolean => (a ?? '') === b.trim();
  if (!same(original.baseUrl, form.baseUrl)) {
    changed.push('baseUrl');
  }
  if (!same(original.revokeUrl, form.revokeUrl)) {
    changed.push('revokeUrl');
  }
  if (!same(original.oauth?.authorizeUrl, form.authorizeUrl)) {
    changed.push('authorizeUrl');
  }
  if (!same(original.oauth?.tokenUrl, form.tokenUrl)) {
    changed.push('tokenUrl');
  }
  if (!same(original.oauth?.clientId, form.clientId)) {
    changed.push('clientId');
  }
  return changed;
}

export function systemRequest(form: SystemForm): SystemAdminRequest {
  const oauth = needsOauth(form.supportedTypes);
  const tokenExchange = form.supportedTypes.includes('token-exchange');
  const scopes = splitList(form.scopes);
  return {
    baseUrl: form.baseUrl.trim(),
    adapter: form.adapter,
    supportedTypes: form.supportedTypes,
    defaultType: form.defaultType,
    secretScheme: form.secretScheme,
    ...(form.adapter === 'atlassian-dc' && form.product ? { product: form.product } : {}),
    ...(form.revokeUrl.trim() ? { revokeUrl: form.revokeUrl.trim() } : {}),
    ...(form.timeout.trim() ? { timeout: form.timeout.trim() } : {}),
    ...(tokenExchange ? { exchangeAudience: form.exchangeAudience.trim() } : {}),
    ...(form.userSecretScheme ? { userSecretScheme: form.userSecretScheme } : {}),
    ...(oauth
      ? {
          oauth: {
            clientId: form.clientId.trim(),
            ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
            ...(form.supportedTypes.includes('user-oauth') && form.authorizeUrl.trim()
              ? { authorizeUrl: form.authorizeUrl.trim() }
              : {}),
            ...(!tokenExchange && form.tokenUrl.trim() ? { tokenUrl: form.tokenUrl.trim() } : {}),
            ...(scopes.length ? { scopes } : {}),
          },
        }
      : {}),
  };
}

/**
 * "Systems" (C12 over C4, CC-235, CC-238): the systems of the credential broker, edited at runtime. The client secret is
 * write only: the list says whether one is stored, and the form asks for it again when an address or the client
 * identifier changes, because that also deletes every user's connection to the system.
 */
@Component({
  selector: 'app-systems-page',
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
  templateUrl: './systems-page.html',
  styleUrls: ['./admin-common.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemsPage implements OnInit {
  private readonly adminApi = inject(AdminService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly stepUp = inject(AdminStepUp);

  readonly mfa = input<string | undefined>();

  protected readonly state = signal<LoadState<SystemAdminView[]>>(LOADING);
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
  protected readonly adapters: readonly SystemAdapter[] = [
    'atlassian-dc',
    'gitlab',
    'opensearch',
    'generic-rest',
  ];
  protected readonly secretSchemes: readonly CredentialScheme[] = [
    'Bearer',
    'Basic',
    'Token',
    'ApiKey',
  ];
  protected readonly userSchemes: readonly SystemUserSecretScheme[] = ['Bearer', 'Basic'];
  protected readonly typeLabel = credentialTypeLabel;
  protected readonly systemName = systemName;

  protected readonly form = computed(() => this.editing()?.form ?? null);
  protected readonly oauth = computed(() => {
    const form = this.form();
    return form ? needsOauth(form.supportedTypes) : false;
  });
  protected readonly changed = computed(() => {
    const current = this.editing();
    return current?.original ? changedAddresses(current.original, current.form) : [];
  });
  /** The secret must be typed (again) when it was never stored here or when an address changed. */
  protected readonly secretRequired = computed(() => {
    const current = this.editing();
    if (!current || !this.oauth()) {
      return false;
    }
    return !current.original?.oauth?.clientSecretSet || this.changed().length > 0;
  });
  protected readonly errors = computed(() => {
    const form = this.form();
    const found: Record<string, string> = {};
    if (!form) {
      return found;
    }
    const url = $localize`:@@adminSystems.errUrl:Enter an https address.`;
    if (form.mode === 'create' && !SYSTEM_ID.test(form.system.trim())) {
      found['system'] =
        $localize`:@@adminSystems.errSystem:Use 2 to 31 lower case letters and digits, starting with a letter. The identifiers gateway, offboarding, portal, broker, prometheus, platform, admin, registry, adapter, internal and ci are reserved.`;
    }
    if (!isHttpsUrl(form.baseUrl.trim())) {
      found['baseUrl'] = url;
    }
    if (form.revokeUrl.trim() && !isHttpsUrl(form.revokeUrl.trim())) {
      found['revokeUrl'] = url;
    }
    if (form.adapter === 'atlassian-dc' && !form.product) {
      found['product'] = $localize`:@@adminSystems.errProduct:Choose Jira or Confluence.`;
    }
    if (form.timeout.trim() && !DURATION.test(form.timeout.trim())) {
      found['timeout'] =
        $localize`:@@adminSystems.errTimeout:Use an ISO 8601 duration of at most 10 minutes, for example PT30S.`;
    }
    if (form.supportedTypes.length === 0) {
      found['supportedTypes'] =
        $localize`:@@adminSystems.errTypes:Choose at least one credential type.`;
    } else if (!form.supportedTypes.includes(form.defaultType)) {
      found['defaultType'] =
        $localize`:@@adminSystems.errDefault:The default type has to be one of the supported types.`;
    } else if (
      form.supportedTypes.includes('service-account') &&
      form.supportedTypes.some((type) => USER_TYPES.includes(type))
    ) {
      found['supportedTypes'] =
        $localize`:@@adminSystems.errMixed:A service account cannot be combined with a user credential type.`;
    }
    if (form.supportedTypes.includes('token-exchange') && !form.exchangeAudience.trim()) {
      found['exchangeAudience'] =
        $localize`:@@adminSystems.errAudience:A token exchange system needs the audience of the token.`;
    }
    if (this.oauth()) {
      if (!form.clientId.trim()) {
        found['clientId'] = $localize`:@@adminSystems.errClientId:Enter the client identifier.`;
      }
      if (this.secretRequired() && !form.clientSecret) {
        found['clientSecret'] = this.changed().length
          ? $localize`:@@adminSystems.errSecretAgain:Enter the client secret again: an address or the client identifier changed.`
          : $localize`:@@adminSystems.errSecret:Enter the client secret.`;
      }
      if (form.supportedTypes.includes('user-oauth') && !isHttpsUrl(form.authorizeUrl.trim())) {
        found['authorizeUrl'] = url;
      }
      if (
        !form.supportedTypes.includes('token-exchange') &&
        form.tokenUrl.trim() &&
        !isHttpsUrl(form.tokenUrl.trim())
      ) {
        found['tokenUrl'] = url;
      }
      if (splitList(form.scopes).some((scope) => !OAUTH_SCOPE.test(scope))) {
        found['scopes'] = $localize`:@@adminSystems.errScopes:A scope cannot contain spaces.`;
      }
    }
    return found;
  });
  protected readonly valid = computed(() => Object.keys(this.errors()).length === 0);

  protected readonly rows = computed(() => {
    const state = this.state();
    return state.status === 'ready'
      ? state.value.map((system) => ({
          system,
          types: system.supportedTypes.map((type) => credentialTypeLabel(type)).join(', '),
          defaultType: credentialTypeLabel(system.defaultType),
          secret: system.oauth
            ? system.oauth.clientSecretSet
              ? $localize`:@@adminSystems.secretSet:Client secret stored`
              : $localize`:@@adminSystems.secretMissing:No client secret`
            : '',
        }))
      : [];
  });

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
    if (this.mfa() === 'ok') {
      this.returnedAt = Date.now();
      const draft = this.stepUp.takeDraft<
        Omit<SystemForm, 'clientSecret'> & { etag: string | null }
      >(PAGE);
      void this.router.navigate([], { queryParams: { mfa: null }, replaceUrl: true });
      if (draft && typeof draft === 'object' && Array.isArray(draft.supportedTypes)) {
        const { etag, ...form } = draft;
        const state = this.state();
        const original =
          form.mode === 'edit' && state.status === 'ready'
            ? (state.value.find((system) => system.system === form.system) ?? null)
            : null;
        this.editing.set({
          form: { ...EMPTY_FORM, ...form, clientSecret: '' },
          original,
          etag: etag ?? null,
        });
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
        value: await firstValueFrom(this.adminApi.listAdminSystems()),
      });
    } catch (error) {
      this.state.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  protected openCreate(): void {
    this.reset();
    this.editing.set({
      form: { ...EMPTY_FORM, supportedTypes: [...EMPTY_FORM.supportedTypes] },
      original: null,
      etag: null,
    });
  }

  protected async openEdit(system: SystemAdminView): Promise<void> {
    this.reset();
    this.busy.set(true);
    try {
      const response: HttpResponse<SystemAdminView> = await firstValueFrom(
        this.adminApi.getAdminSystem(system.system, 'response'),
      );
      const current = response.body ?? system;
      this.editing.set({
        form: {
          mode: 'edit',
          system: current.system,
          baseUrl: current.baseUrl,
          adapter: current.adapter,
          product: current.product ?? '',
          revokeUrl: current.revokeUrl ?? '',
          timeout: current.timeout ?? '',
          exchangeAudience: current.exchangeAudience ?? '',
          userSecretScheme: current.userSecretScheme ?? '',
          supportedTypes: [...current.supportedTypes],
          defaultType: current.defaultType,
          secretScheme: current.secretScheme,
          clientId: current.oauth?.clientId ?? '',
          clientSecret: '',
          authorizeUrl: current.oauth?.authorizeUrl ?? '',
          tokenUrl: current.oauth?.tokenUrl ?? '',
          scopes: (current.oauth?.scopes ?? []).join(' '),
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

  protected change(change: Partial<SystemForm>): void {
    this.editing.update((current) =>
      current ? { ...current, form: { ...current.form, ...change } } : current,
    );
  }

  protected toggleType(type: CredentialType, on: boolean): void {
    const form = this.form();
    if (!form) {
      return;
    }
    const types = on
      ? [...new Set([...form.supportedTypes, type])]
      : form.supportedTypes.filter((candidate) => candidate !== type);
    this.change({
      supportedTypes: types,
      defaultType: types.includes(form.defaultType)
        ? form.defaultType
        : (types[0] ?? form.defaultType),
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
    const replacing = form.mode === 'edit';
    if (replacing && !current.etag) {
      this.failure.set({ code: 'precondition_required', status: 428 });
      return;
    }
    this.busy.set(true);
    this.failure.set(null);
    try {
      await firstValueFrom(
        this.adminApi.putAdminSystem(
          form.system.trim(),
          systemRequest(form),
          replacing ? (current.etag ?? undefined) : undefined,
          replacing ? undefined : '*',
        ),
      );
      const id = form.system.trim();
      this.done.set(
        replacing
          ? this.changed().length
            ? $localize`:@@adminSystems.savedInvalidated:Saved the system ${id}:system:. The connections of its users were deleted; they connect again.`
            : $localize`:@@adminSystems.saved:Saved the system ${id}:system:.`
          : $localize`:@@adminSystems.added:Added the system ${id}:system:.`,
      );
      this.editing.set(null);
      this.touched.set(false);
      await this.read();
    } catch (error) {
      const failure = toApiFailure(error);
      // The secret never goes into the draft that waits in sessionStorage during the trip to the IdP.
      const draft = { ...form, clientSecret: '' };
      if (
        this.stepUp.redirectIfRequired(failure, PAGE, { ...draft, etag: current.etag }, returned)
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

  protected async remove(system: SystemAdminView): Promise<void> {
    const returned = this.takeReturn();
    if (this.busy()) {
      return;
    }
    const id = system.system;
    this.busy.set(true);
    this.reset();
    try {
      const response = await firstValueFrom(this.adminApi.getAdminSystem(id, 'response'));
      const etag = etagOf(response);
      const confirmed = await firstValueFrom(
        this.dialog
          .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
            data: {
              title: $localize`:@@adminSystems.removeTitle:Remove the system ${id}:system:?`,
              message: $localize`:@@adminSystems.removeMessage:The broker deletes the settings, the client secret and the connections of all users to this system. Nothing is sent to the system itself. Removing needs a fresh MFA.`,
              confirmLabel: $localize`:@@adminSystems.removeConfirm:Remove system`,
              destructive: true,
            },
          })
          .afterClosed(),
      );
      if (confirmed !== true) {
        return;
      }
      if (!etag) {
        this.failure.set({ code: 'precondition_required', status: 428 });
        return;
      }
      await firstValueFrom(this.adminApi.deleteAdminSystem(etag, id));
      this.done.set($localize`:@@adminSystems.removed:Removed the system ${id}:system:.`);
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
}
