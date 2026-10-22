#!/usr/bin/env node
// HTTPS static server for the built site at the root (PH9, DX28). The
// production host is mapped to localhost and the game runs on HTTPS there,
// so the server speaks TLS; the certificate is a throwaway self-signed one.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = process.env.E2E_DIST ? join(ROOT, process.env.E2E_DIST) : join(ROOT, 'dist');
const PORT = Number(process.env.E2E_PORT ?? 4443);
const BASE = '/';

const dir = mkdtempSync(join(tmpdir(), 'mg-tls-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=museumguessr.com', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => {
  const url = new URL(req.url ?? '/', 'https://localhost');
  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(404).end('not found');
    return;
  }
  let rel = normalize(decodeURIComponent(url.pathname.slice(BASE.length)));
  if (rel.startsWith('..')) {
    res.writeHead(400).end();
    return;
  }
  if (rel === '' || rel === '.' || rel.endsWith('/')) rel = join(rel, 'index.html');
  const file = join(DIST, rel);
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`e2e server: https://127.0.0.1:${PORT}${BASE} (dist: ${DIST})`));
