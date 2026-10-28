import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import { ActivityCall, ActivityService } from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { LOADING, LoadState } from '../../core/load-state';
import { ErrorNotice } from '../../shared/error-notice';
import { riskLabel } from '../../shared/labels';
import { Notice } from '../../shared/notice';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { formatResource } from '../../shared/resource';
import { neutraliseText } from '../../shared/untrusted-text';
import {
  PERIODS,
  Period,
  RESULT_GROUPS,
  ResultGroup,
  clientName,
  groupLabel,
  periodLabel,
  periodStart,
  resultInfo,
} from './activity-labels';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MAX = 64;

interface Row {
  call: ActivityCall;
  key: string;
  client: string;
  resource: string;
  tool: string;
  link: string;
  errorCode: string;
  rawResult: string;
  result: ReturnType<typeof resultInfo>;
  unknownResult: boolean;
}

interface Page {
  rows: Row[];
  cursor: string | null;
}

function toRow(call: ActivityCall): Row {
  const result = resultInfo(call.result);
  return {
    call,
    key: call.requestId,
    client: neutraliseText(clientName(call.client)).text,
    resource: neutraliseText(formatResource(call.resource)).text,
    tool: neutraliseText(call.tool).text,
    link: neutraliseText(call.virtualServer ?? '').text,
    errorCode: neutraliseText(call.errorCode ?? '').text,
    rawResult: neutraliseText(call.result).text,
    result,
    unknownResult: result.label === resultInfo('?').label,
  };
}

/**
 * Activity log (mockup 06, CC-095): my tool calls, one row per call with its final result. Filters are
 * sent to the BFF (search, period, result group); "Pokaż więcej" follows the opaque cursor of the last
 * answer. The list never shows argument values: the API does not carry them.
 */
@Component({
  selector: 'app-logs-page',
  imports: [DatePipe, MatButtonModule, ErrorNotice, LoadError, Loading, Notice],
  templateUrl: './logs-page.html',
  styleUrl: './logs-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogsPage {
  private readonly api = inject(ActivityService);

  protected readonly periods = PERIODS;
  protected readonly groups = RESULT_GROUPS;
  protected readonly riskLabel = riskLabel;
  protected readonly periodLabel = periodLabel;
  protected readonly groupLabel = groupLabel;
  protected readonly searchMax = SEARCH_MAX;
  protected readonly showLabel = $localize`:@@logs.showDetails:Pokaż szczegóły`;
  protected readonly hideLabel = $localize`:@@logs.hideDetails:Ukryj szczegóły`;

  protected readonly search = signal('');
  protected readonly period = signal<Period>('7d');
  protected readonly group = signal<ResultGroup>('');
  protected readonly page = signal<LoadState<Page>>(LOADING);
  protected readonly moreBusy = signal(false);
  protected readonly moreFailure = signal<ApiFailure | null>(null);
  /** The cursor is only valid for a while (C5); the list then has to start again from its first page. */
  protected readonly listStale = computed(() => this.moreFailure()?.code === 'invalid_request');
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());

  protected readonly rows = computed(() => {
    const state = this.page();
    return state.status === 'ready' ? state.value.rows : [];
  });
  protected readonly cursor = computed(() => {
    const state = this.page();
    return state.status === 'ready' ? state.value.cursor : null;
  });
  protected readonly filtered = computed(() => this.search().trim() !== '' || this.group() !== '');

  private sequence = 0;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.debounce !== null) {
        clearTimeout(this.debounce);
      }
    });
    void this.load();
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    if (this.debounce !== null) {
      clearTimeout(this.debounce);
    }
    this.debounce = setTimeout(() => void this.load(), SEARCH_DEBOUNCE_MS);
  }

  protected onPeriod(event: Event): void {
    this.period.set((event.target as HTMLSelectElement).value as Period);
    void this.load();
  }

  protected onGroup(event: Event): void {
    this.group.set((event.target as HTMLSelectElement).value as ResultGroup);
    void this.load();
  }

  private query(cursor?: string) {
    const q = this.search().trim().slice(0, SEARCH_MAX);
    return this.api.listMyActivityCalls(
      PAGE_SIZE,
      periodStart(this.period()),
      undefined,
      this.group() || undefined,
      q || undefined,
      cursor,
      'response',
    );
  }

  protected async load(): Promise<void> {
    const mine = ++this.sequence;
    this.page.set(LOADING);
    this.moreFailure.set(null);
    this.expanded.set(new Set());
    try {
      const response = await firstValueFrom(this.query());
      if (mine === this.sequence) {
        this.page.set({
          status: 'ready',
          value: {
            rows: (response.body ?? []).map(toRow),
            cursor: response.headers.get('X-Next-Cursor'),
          },
        });
      }
    } catch (error) {
      if (mine === this.sequence) {
        this.page.set({ status: 'error', failure: toApiFailure(error) });
      }
    }
  }

  protected async more(): Promise<void> {
    const state = this.page();
    if (state.status !== 'ready' || !state.value.cursor || this.moreBusy()) {
      return;
    }
    const mine = this.sequence;
    this.moreBusy.set(true);
    this.moreFailure.set(null);
    try {
      const response = await firstValueFrom(this.query(state.value.cursor));
      if (mine === this.sequence) {
        this.page.set({
          status: 'ready',
          value: {
            rows: [...state.value.rows, ...(response.body ?? []).map(toRow)],
            cursor: response.headers.get('X-Next-Cursor'),
          },
        });
      }
    } catch (error) {
      if (mine === this.sequence) {
        this.moreFailure.set(toApiFailure(error));
      }
    } finally {
      this.moreBusy.set(false);
    }
  }

  protected toggle(key: string): void {
    const next = new Set(this.expanded());
    if (!next.delete(key)) {
      next.add(key);
    }
    this.expanded.set(next);
  }
}
