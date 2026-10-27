import { SystemId } from '../../api/generated';

/**
 * How to create the narrowest token the system allows. Static texts: C12 does not expose per-system
 * hints, and the steps differ per product, not per user.
 */
const INSTRUCTIONS: Record<SystemId, () => string[]> = {
  jira: () => [
    $localize`:@@token.jira.1:W Jirze otwórz menu profilu i wybierz Profil, a potem Tokeny dostępu osobistego.`,
    $localize`:@@token.jira.2:Wybierz Utwórz token, nadaj mu nazwę wskazującą na Portal MCP i zaznacz automatyczne wygasanie.`,
    $localize`:@@token.jira.3:Ustaw najkrótszy termin ważności, który Ci wystarczy. Token działa z Twoimi uprawnieniami w Jirze, portal ich nie rozszerza.`,
  ],
  confluence: () => [
    $localize`:@@token.confluence.1:W Confluence otwórz menu profilu i wybierz Ustawienia, a potem Tokeny dostępu osobistego.`,
    $localize`:@@token.confluence.2:Wybierz Utwórz token, nadaj mu nazwę wskazującą na Portal MCP i zaznacz automatyczne wygasanie.`,
    $localize`:@@token.confluence.3:Ustaw najkrótszy termin ważności, który Ci wystarczy. Token działa z Twoimi uprawnieniami w Confluence.`,
  ],
  gitlab: () => [
    $localize`:@@token.gitlab.1:W GitLabie otwórz Preferencje użytkownika, a potem Tokeny dostępu.`,
    $localize`:@@token.gitlab.2:Dodaj nowy token z datą wygaśnięcia. Zaznacz tylko zakres read_api, chyba że potrzebujesz narzędzi zmieniających dane; wtedy api.`,
    $localize`:@@token.gitlab.3:Nie zaznaczaj zakresów sudo, admin_mode ani write_repository: narzędzia MCP ich nie używają.`,
  ],
  servicedesk: () => [
    $localize`:@@token.servicedesk.1:W service desku utwórz osobisty token API w ustawieniach swojego profilu.`,
    $localize`:@@token.servicedesk.2:Jeśli system pozwala wybrać uprawnienia tokenu, ogranicz je do zgłoszeń, z którymi pracujesz, i ustaw datę wygaśnięcia.`,
  ],
  opensearch: () => [
    $localize`:@@token.opensearch.1:W OpenSearch Dashboards utwórz token API powiązany ze swoim kontem.`,
    $localize`:@@token.opensearch.2:Ogranicz go do odczytu potrzebnych indeksów i ustaw datę wygaśnięcia.`,
  ],
};

export function tokenInstructions(system: SystemId): string[] {
  return INSTRUCTIONS[system]();
}
