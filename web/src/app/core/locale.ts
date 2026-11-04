import { registerLocaleData } from '@angular/common';
import { loadTranslations } from '@angular/localize';

export type PortalLocale = 'en' | 'pl';

/** Only the language preference is stored in the browser; nothing session- or user-related. */
export const LOCALE_STORAGE_KEY = 'mcp-portal-locale';
export const TRANSLATIONS_URL = '/i18n/messages.pl.json';

/**
 * The stored choice wins, then the first language of the browser that the portal has; English otherwise. The
 * source language of the texts is English, so a browser that asks for neither gets the source.
 */
export function chooseLocale(
  stored: string | null,
  browserLanguages: readonly string[],
): PortalLocale {
  if (stored === 'en' || stored === 'pl') {
    return stored;
  }
  for (const language of browserLanguages) {
    const primary = language.toLowerCase().split('-')[0];
    if (primary === 'pl' || primary === 'en') {
      return primary;
    }
  }
  return 'en';
}

function readStored(): string | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeLocale(locale: PortalLocale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage blocked (private mode, policy): the choice lasts until the next visit decides again.
  }
}

/**
 * Runs before the application code is loaded: $localize texts are resolved when a module is evaluated, so the
 * translations have to be registered first. A failed download leaves the English source texts.
 */
export async function initLocale(): Promise<PortalLocale> {
  let locale = chooseLocale(readStored(), navigator.languages ?? [navigator.language]);
  if (locale === 'pl') {
    try {
      const response = await fetch(TRANSLATIONS_URL, { credentials: 'same-origin' });
      if (!response.ok) {
        throw new Error(`translations: ${response.status}`);
      }
      loadTranslations((await response.json()) as Record<string, string>);
      // LOCALE_ID follows $localize.locale, and the date pipe needs the data of that locale.
      registerLocaleData((await import('@angular/common/locales/pl')).default);
      $localize.locale = 'pl';
    } catch (error) {
      console.error(error);
      locale = 'en';
    }
  }
  document.documentElement.lang = locale;
  return locale;
}

export function currentLocale(): PortalLocale {
  return document.documentElement.lang === 'pl' ? 'pl' : 'en';
}

export function switchLocale(locale: PortalLocale): void {
  storeLocale(locale);
  location.reload();
}
