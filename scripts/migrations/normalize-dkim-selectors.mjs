#!/usr/bin/env node
// One-shot migration: strip `._domainkey.*` suffixes from stored DKIM selectors.
//
// Background: older MxWatch builds accepted the full DNS form
// (e.g. `mail._domainkey.example.com`) and stored it as-is, which then caused
// the DNS lookup in `checkDkim` to produce `mail._domainkey.example.com._domainkey.example.com`.
// Current code normalizes at both the Zod schema and `normalizeDkimSelector`,
// but pre-existing rows need a one-time cleanup.
//
// Run: node scripts/migrations/normalize-dkim-selectors.mjs [path-to-db]
//   Defaults to ./data/mxwatch.db, then packages/db/data/mxwatch.db.

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function normalize(s) {
  if (!s) return s;
  const idx = s.toLowerCase().indexOf('._domainkey');
  return idx >= 0 ? s.slice(0, idx) : s;
}

function pickDbPath() {
  const arg = process.argv[2];
  const candidates = [
    arg,
    process.env.DATABASE_URL?.replace(/^file:/, ''),
    './data/mxwatch.db',
    './packages/db/data/mxwatch.db',
  ].filter(Boolean);
  for (const p of candidates) {
    const abs = resolve(p);
    if (existsSync(abs)) return abs;
  }
  throw new Error('Could not find DB. Pass path as first arg or set DATABASE_URL.');
}

const dbPath = pickDbPath();
console.log(`[migrate] db=${dbPath}`);
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const selectors = db.prepare('SELECT id, domain_id, selector FROM dkim_selectors').all();

let fixed = 0;
let deduped = 0;
const tx = db.transaction(() => {
  const seen = new Map(); // key: `${domainId}|${selector}` → id
  for (const row of selectors) {
    const bare = normalize(row.selector);
    const key = `${row.domain_id}|${bare}`;
    if (seen.has(key)) {
      db.prepare('DELETE FROM dkim_selectors WHERE id = ?').run(row.id);
      deduped += 1;
      continue;
    }
    seen.set(key, row.id);
    if (bare !== row.selector) {
      db.prepare('UPDATE dkim_selectors SET selector = ? WHERE id = ?').run(bare, row.id);
      fixed += 1;
    }
  }

  // Normalise the denormalised dkim_selector column on dns_snapshots too,
  // since the detail UI reads it directly.
  const snaps = db
    .prepare("SELECT id, dkim_selector FROM dns_snapshots WHERE dkim_selector LIKE '%._domainkey%'")
    .all();
  for (const s of snaps) {
    db.prepare('UPDATE dns_snapshots SET dkim_selector = ? WHERE id = ?')
      .run(normalize(s.dkim_selector), s.id);
  }
  if (snaps.length > 0) console.log(`[migrate] normalised ${snaps.length} dns_snapshots row(s)`);
});

tx();

console.log(`[migrate] selectors scanned=${selectors.length} fixed=${fixed} deduped=${deduped}`);
console.log('[migrate] done.');
db.close();
