/** Sets a text field, textarea or select the way the user does and lets Angular's forms see it. */
export function fill(id: string, value: string): void {
  const element = document.getElementById(id) as
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (!element) {
    throw new Error(`no field ${id}`);
  }
  element.value = value;
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input'));
}

export function field(id: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`no field ${id}`);
  }
  return element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
}

export function tick(name: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!found) {
    throw new Error(`no checkbox ${name}`);
  }
  return found;
}

export function toggle(name: string): void {
  tick(name).click();
}

export function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('mat-dialog-container');
  if (!found) {
    throw new Error('no dialog');
  }
  return found;
}

export interface Recorded {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

/** Records the writes (and nothing else) that reach the mock API, with the headers that carry the preconditions. */
export function recordWrites(
  server: {
    events: { on: (name: 'request:start', handler: (args: { request: Request }) => void) => void };
  },
  filter: (url: string) => boolean,
  into: Recorded[],
): void {
  server.events.on('request:start', async ({ request }) => {
    if (request.method === 'GET' || !filter(new URL(request.url).pathname)) {
      return;
    }
    const headers: Record<string, string> = {};
    for (const name of ['if-match', 'if-none-match']) {
      const value = request.headers.get(name);
      if (value !== null) {
        headers[name] = value;
      }
    }
    into.push({
      method: request.method,
      url: new URL(request.url).pathname,
      body: ['PUT', 'POST', 'PATCH'].includes(request.method)
        ? await request
            .clone()
            .json()
            .catch(() => null)
        : null,
      headers,
    });
  });
}
