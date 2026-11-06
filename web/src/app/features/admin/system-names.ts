import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AdminService, SystemAdminView } from '../../api/generated';
import { systemName } from '../../shared/labels';
import { neutraliseText } from '../../shared/untrusted-text';

/**
 * Display names of the systems as the administrator set them in the broker (`displayName`, CC-243). The names are text of
 * an administrator, shown only through {@link neutraliseText}; a system without one, or while the broker does not answer,
 * is shown by its identifier with a capital letter. The user pages cannot use them: the C12 catalog carries no name.
 */
@Injectable({ providedIn: 'root' })
export class AdminSystemNames {
  private readonly adminApi = inject(AdminService);
  private readonly names = signal<ReadonlyMap<string, string>>(new Map());
  readonly known = signal<readonly string[]>([]);

  /** Best effort: the page that needs the names is useful without them. */
  async load(): Promise<void> {
    try {
      this.use(await firstValueFrom(this.adminApi.listAdminSystems()));
    } catch {
      this.names.set(new Map());
      this.known.set([]);
    }
  }

  use(systems: readonly SystemAdminView[]): void {
    this.names.set(new Map(systems.map((system) => [system.system, system.displayName])));
    this.known.set(systems.map((system) => system.system));
  }

  /** Name of a system, or of the system of a server id (`mcp-<system>`). */
  name(system: string): string {
    const id = system.startsWith('mcp-') ? system.slice(4) : system;
    const given = this.names().get(id);
    return given && given !== id ? neutraliseText(given).text : systemName(id);
  }
}
