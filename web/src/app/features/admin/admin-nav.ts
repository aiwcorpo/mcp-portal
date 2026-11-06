import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** Links between the screens of the administration, shown above each of them. */
@Component({
  selector: 'app-admin-nav',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="subnav" i18n-aria-label="@@adminNav.label" aria-label="Administration sections">
      <a
        routerLink="/admin"
        routerLinkActive="active"
        ariaCurrentWhenActive="page"
        [routerLinkActiveOptions]="{ exact: true }"
        i18n="@@adminNav.registry"
        >Approvals</a
      >
      <a
        routerLink="/admin/servers"
        routerLinkActive="active"
        ariaCurrentWhenActive="page"
        i18n="@@adminNav.servers"
        >Servers</a
      >
      <a
        routerLink="/admin/systems"
        routerLinkActive="active"
        ariaCurrentWhenActive="page"
        i18n="@@adminNav.systems"
        >Systems</a
      >
      <a
        routerLink="/admin/scope-mapping"
        routerLinkActive="active"
        ariaCurrentWhenActive="page"
        i18n="@@adminNav.scopeMapping"
        >Scope mapping</a
      >
      <a
        routerLink="/admin/overrides"
        routerLinkActive="active"
        ariaCurrentWhenActive="page"
        i18n="@@adminNav.overrides"
        >Overrides</a
      >
      <a
        routerLink="/admin/kill-switches"
        routerLinkActive="active"
        ariaCurrentWhenActive="page"
        i18n="@@adminNav.killSwitches"
        >Emergency switches</a
      >
    </nav>
  `,
  styles: `
    .subnav {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      margin: 0 0 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--pm-border);
      font-size: 13px;
    }
    .subnav a {
      padding: 2px 0;
      color: var(--pm-muted);
      text-decoration: none;
    }
    .subnav a:hover {
      color: var(--pm-text);
    }
    .subnav a.active {
      color: var(--pm-text);
      font-weight: 600;
      border-bottom: 2px solid var(--pm-text);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminNav {}
