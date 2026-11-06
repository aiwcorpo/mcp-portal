import { DatePipe } from '@angular/common';
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
import { AdminService, Override, OverrideRequest } from '../../api/generated';
import { AdminStepUp } from '../../core/admin-step-up';
import { etagOf } from '../../core/admin-etag';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { LOADING, LoadState } from '../../core/load-state';
import { systemName } from '../../shared/labels';
import { ConfirmDialog, ConfirmDialogData } from '../../shared/confirm-dialog';
import { ErrorNotice } from '../../shared/error-notice';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';
import { SafeTextPipe } from '../../shared/safe-text.pipe';
import { AdminNav } from './admin-nav';
import { OVERRIDE_NAME, OVERRIDE_TEXT_MAX, SERVER_ID, overrideTemplate } from './admin-validation';

const PAGE = '/admin/overrides';
const PREFIX = 'override-';

export type TargetKind = 'gateway' | 'all-servers' | 'server';

export interface OverrideForm {
  mode: 'create' | 'edit';
  /** The part of the identifier after `override-`. */
  name: string;
  kind: TargetKind;
  server: string;
  text: string;
}

interface Editing {
  form: OverrideForm;
  etag: string | null;
}

const EMPTY_FORM: OverrideForm = {
  mode: 'create',
  name: '',
  kind: 'gateway',
  server: '',
  text: '',
};

export function targetOf(form: OverrideForm): string {
  return form.kind === 'server' ? form.server : form.kind;
}

export function kindOf(target: string): TargetKind {
  return target === 'gateway' || target === 'all-servers' ? target : 'server';
}

/**
 * "Overrides" (C12 over C5, CC-234): forbid-only Cedar policies that an administrator adds in an emergency, for the
 * gateway's decision on a call, for every server or for one server. The gateway validates the text against the schema
 * of its target and says why it refuses; the page shows that. Removing one needs a fresh MFA, because it lifts a ban.
 */
@Component({
  selector: 'app-overrides-page',
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    AdminNav,
    ErrorNotice,
    LoadError,
    Loading,
    Notice,
    SafeTextPipe,
  ],
  templateUrl: './overrides-page.html',
  styleUrls: ['./admin-common.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverridesPage implements OnInit {
  private readonly adminApi = inject(AdminService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly stepUp = inject(AdminStepUp);

  readonly mfa = input<string | undefined>();

  protected readonly prefix = PREFIX;
  protected readonly textMax = OVERRIDE_TEXT_MAX;
  protected readonly state = signal<LoadState<Override[]>>(LOADING);
  protected readonly servers = signal<readonly string[]>([]);
  protected readonly editing = signal<Editing | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<ApiFailure | null>(null);
  protected readonly done = signal<string | null>(null);
  protected readonly mfaNote = signal<'draft' | 'repeat' | null>(null);
  protected readonly touched = signal(false);
  /** The page was opened by the return from the IdP; a repeated step-up request is then an error, not a loop. */
  private returnedAt = 0;
  protected readonly systemName = systemName;

  protected readonly form = computed(() => this.editing()?.form ?? null);
  protected readonly errors = computed(() => {
    const form = this.form();
    const found: Record<string, string> = {};
    if (!form) {
      return found;
    }
    if (form.mode === 'create' && !OVERRIDE_NAME.test(form.name.trim())) {
      found['name'] =
        $localize`:@@overrides.errName:Use lower case letters, digits and hyphens, starting with a letter or digit (up to 55 characters).`;
    }
    if (form.kind === 'server' && !SERVER_ID.test(form.server.trim())) {
      found['server'] = $localize`:@@overrides.errServer:Choose a server.`;
    }
    if (form.text.trim().length === 0) {
      found['text'] = $localize`:@@overrides.errText:Enter the policy.`;
    } else if (form.text.length > OVERRIDE_TEXT_MAX) {
      found['text'] =
        $localize`:@@overrides.errTextLong:The policy is longer than ${OVERRIDE_TEXT_MAX}:max: characters.`;
    }
    return found;
  });
  protected readonly valid = computed(() => Object.keys(this.errors()).length === 0);
  protected readonly rows = computed(() => {
    const state = this.state();
    return state.status === 'ready'
      ? state.value.map((override) => ({
          override,
          target:
            override.target === 'gateway'
              ? $localize`:@@overrides.targetGateway:Gateway`
              : override.target === 'all-servers'
                ? $localize`:@@overrides.targetAll:All servers`
                : override.target,
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
    void this.loadServers();
    if (this.mfa() === 'ok') {
      this.returnedAt = Date.now();
      const draft = this.stepUp.takeDraft<OverrideForm & { etag: string | null }>(PAGE);
      void this.router.navigate([], { queryParams: { mfa: null }, replaceUrl: true });
      if (draft && typeof draft === 'object' && typeof draft.text === 'string') {
        const { etag, ...form } = draft;
        this.editing.set({ form: { ...EMPTY_FORM, ...form }, etag: etag ?? null });
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
        value: await firstValueFrom(this.adminApi.listAdminOverrides()),
      });
    } catch (error) {
      this.state.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  /** The servers of the registry, as targets to choose from; without them the field cannot be filled, and the gateway still checks `target_unknown`. */
  private async loadServers(): Promise<void> {
    try {
      this.servers.set(
        (await firstValueFrom(this.adminApi.listAdminServers())).map((server) => server.serverId),
      );
    } catch {
      this.servers.set([]);
    }
  }

  protected openCreate(): void {
    this.reset();
    this.editing.set({ form: { ...EMPTY_FORM }, etag: null });
  }

  protected async openEdit(override: Override): Promise<void> {
    this.reset();
    this.busy.set(true);
    try {
      const response: HttpResponse<Override> = await firstValueFrom(
        this.adminApi.getAdminOverride(override.id, 'response'),
      );
      const current = response.body ?? override;
      this.editing.set({
        form: {
          mode: 'edit',
          name: current.id.slice(PREFIX.length),
          kind: kindOf(current.target),
          server: kindOf(current.target) === 'server' ? current.target : '',
          text: current.text,
        },
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

  protected change(change: Partial<OverrideForm>): void {
    this.editing.update((current) =>
      current ? { ...current, form: { ...current.form, ...change } } : current,
    );
  }

  protected useTemplate(): void {
    const form = this.form();
    if (form) {
      this.change({
        text: overrideTemplate(`${PREFIX}${form.name.trim() || 'name'}`, targetOf(form)),
      });
    }
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
    const id = `${PREFIX}${form.name.trim()}`;
    this.busy.set(true);
    this.failure.set(null);
    try {
      const body: OverrideRequest = { target: targetOf(form), text: form.text };
      await firstValueFrom(
        this.adminApi.putAdminOverride(
          id,
          body,
          replacing ? (current.etag ?? undefined) : undefined,
          replacing ? undefined : '*',
        ),
      );
      this.done.set(
        replacing
          ? $localize`:@@overrides.saved:Saved the override ${id}:id:.`
          : $localize`:@@overrides.added:Added the override ${id}:id:. It takes effect within seconds.`,
      );
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

  protected async remove(override: Override): Promise<void> {
    const returned = this.takeReturn();
    if (this.busy()) {
      return;
    }
    const id = override.id;
    this.busy.set(true);
    this.reset();
    try {
      const response = await firstValueFrom(this.adminApi.getAdminOverride(id, 'response'));
      const etag = etagOf(response);
      const confirmed = await firstValueFrom(
        this.dialog
          .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
            data: {
              title: $localize`:@@overrides.removeTitle:Remove the override ${id}:id:?`,
              message: $localize`:@@overrides.removeMessage:What it forbids becomes possible again as soon as every instance has read the change. Removing needs a fresh MFA.`,
              confirmLabel: $localize`:@@overrides.removeConfirm:Remove override`,
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
      await firstValueFrom(this.adminApi.deleteAdminOverride(etag, id));
      this.done.set($localize`:@@overrides.removed:Removed the override ${id}:id:.`);
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
