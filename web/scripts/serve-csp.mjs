// Serves a built portal (default dist/e2e) the way the BFF must: SPA fallback to index.html, a fresh
// CSP nonce per response substituted for __CSP_NONCE__, and a CSP without 'unsafe-inline'.
// Used by Playwright so the e2e tests also prove the production build runs under that policy.
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist/e2e');
const port = Number(process.env.PORT ?? 18731);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

export function contentSecurityPolicy(nonce) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    // Only for the MSW service worker of the e2e build; the production policy in README.md omits it.
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

async function fileFor(urlPath) {
  const candidate = normalize(join(root, decodeURIComponent(urlPath)));
  if (!candidate.startsWith(root)) {
    return null;
  }
  try {
    return (await stat(candidate)).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  if (pathname.startsWith('/api/')) {
    // MSW answers API calls in the page; anything reaching the server is a test bug.
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end('{"error":"not_found_or_denied"}');
    return;
  }
  const file = (await fileFor(pathname)) ?? join(root, 'index.html');
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const headers = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' };
  let body = await readFile(file);
  if (file.endsWith('index.html')) {
    const nonce = randomBytes(16).toString('base64');
    body = body.toString('utf8').replaceAll('__CSP_NONCE__', nonce);
    headers['Content-Security-Policy'] = contentSecurityPolicy(nonce);
    headers['Cache-Control'] = 'no-store';
  }
  response.writeHead(200, headers);
  response.end(body);
}).listen(port, () => {
  process.stdout.write(`serving ${root} on http://localhost:${port}\n`);
});
