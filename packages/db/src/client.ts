import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

let _db: ReturnType<typeof createDb> | null = null;

function createDb(url: string) {
  const sqlite = new Database(url);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

export function getDb() {
  if (_db) return _db;
  const url = process.env.DATABASE_URL ?? './data/mxwatch.db';
  _db = createDb(url);
  return _db;
}

export type DB = ReturnType<typeof getDb>;
export { schema };
