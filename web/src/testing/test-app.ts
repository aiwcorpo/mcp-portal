import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { appConfig } from '../app/app.config';
import { BrowserNavigation } from '../app/core/browser-navigation';

export interface FakeNavigation {
  origin: string;
  assign: ReturnType<typeof vi.fn<(url: string) => void>>;
}

/** App providers with full-page navigation captured instead of performed. */
export function configureTestApp(): FakeNavigation {
  const navigation: FakeNavigation = {
    origin: location.origin,
    assign: vi.fn<(url: string) => void>(),
  };
  TestBed.configureTestingModule({
    providers: [...appConfig.providers, { provide: BrowserNavigation, useValue: navigation }],
  });
  return navigation;
}

export async function openRoute(url: string): Promise<RouterTestingHarness> {
  const harness = await RouterTestingHarness.create(url);
  await harness.fixture.whenStable();
  return harness;
}

export function text(root: Node = document.body): string {
  return (root.textContent ?? '').replace(/\s+/g, ' ');
}

export function button(name: string | RegExp, root: ParentNode = document): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find((candidate) => {
    const label = text(candidate).trim();
    return typeof name === 'string' ? label === name : name.test(label);
  });
  if (!found) {
    throw new Error(`no button ${String(name)}`);
  }
  return found;
}

export async function until(check: () => void): Promise<void> {
  await vi.waitFor(check, { timeout: 3000, interval: 10 });
}
