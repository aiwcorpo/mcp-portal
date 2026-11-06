import { HttpResponse } from '@angular/common/http';

/** An entity tag is opaque (CC-234): the page keeps it as received and sends it back in If-Match, nothing else. */
const ETAG = /^(?:W\/)?"[\x21\x23-\x7E]{0,200}"$/;

export function etagOf(response: HttpResponse<unknown>): string | null {
  const value = response.headers.get('ETag');
  return value !== null && ETAG.test(value) ? value : null;
}
