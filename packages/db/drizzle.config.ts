import type { Config } from 'drizzle-kit';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Load root .env manually so `drizzle-kit push` honours DATABASE_URL
// without the caller needing to source it first.
for (const candidate of ['../../.env', '../.env', './.env']) {
  const p = resolve(candidate);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key]) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const url = process.env.DATABASE_URL ?? './data/mxwatch.db';
mkdirSync(dirname(resolve(url)), { recursive: true });

export default {
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url },
} satisfies Config;
