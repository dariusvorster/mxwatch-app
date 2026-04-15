import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { schema, nanoid } from '@mxwatch/db';

process.env.MXWATCH_SECRET ??= 'test-secret-32-byte-padding-aaaaaaaa';

const SCHEMA_DDL = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,
    name TEXT,
    image TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    plan TEXT DEFAULT 'self_hosted',
    onboarding_step INTEGER NOT NULL DEFAULT 0,
    totp_enabled INTEGER DEFAULT 0,
    totp_secret TEXT,
    totp_backup_codes TEXT,
    ip_allowlist TEXT,
    session_expiry_days INTEGER DEFAULT 7,
    log_level TEXT DEFAULT 'info'
  );
  CREATE TABLE domains (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    notes TEXT,
    sending_ip TEXT,
    architecture TEXT DEFAULT 'direct',
    sending_ips TEXT,
    smtp_check_host TEXT,
    relay_host TEXT,
    internal_host TEXT,
    outbound_provider TEXT
  );
  CREATE TABLE server_integrations (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    server_type TEXT NOT NULL,
    architecture TEXT NOT NULL DEFAULT 'direct',
    base_url TEXT,
    encrypted_token TEXT,
    agent_id TEXT,
    internal_host TEXT,
    relay_host TEXT,
    sending_ips TEXT,
    auto_detected INTEGER DEFAULT 0,
    detection_confidence TEXT,
    status TEXT DEFAULT 'unknown',
    last_error TEXT,
    last_pulled_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE queue_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    integration_id TEXT NOT NULL REFERENCES server_integrations(id) ON DELETE CASCADE,
    total INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    deferred INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    oldest_message_age INTEGER,
    recorded_at INTEGER NOT NULL
  );
  CREATE TABLE auth_failure_events (
    id TEXT PRIMARY KEY NOT NULL,
    integration_id TEXT NOT NULL REFERENCES server_integrations(id) ON DELETE CASCADE,
    ip TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    sample_username TEXT,
    mechanism TEXT,
    detected_at INTEGER NOT NULL
  );
  CREATE TABLE bounce_events (
    id TEXT PRIMARY KEY NOT NULL,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    timestamp INTEGER NOT NULL,
    original_to TEXT NOT NULL,
    recipient_domain TEXT NOT NULL,
    bounce_type TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    remote_mta TEXT,
    related_rbl TEXT,
    severity TEXT DEFAULT 'info',
    acknowledged INTEGER DEFAULT 0
  );
  CREATE TABLE recipient_domain_stats (
    id TEXT PRIMARY KEY NOT NULL,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    server_integration_id TEXT REFERENCES server_integrations(id) ON DELETE SET NULL,
    recipient_domain TEXT NOT NULL,
    period TEXT NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0,
    delivered INTEGER NOT NULL DEFAULT 0,
    bounced INTEGER NOT NULL DEFAULT 0,
    deferred INTEGER NOT NULL DEFAULT 0,
    delivery_rate INTEGER,
    avg_delay_ms INTEGER,
    last_bounce_reason TEXT,
    recorded_at INTEGER NOT NULL
  );
`;

export function makeTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(SCHEMA_DDL);
  const db = drizzle(sqlite, { schema });

  async function seedUser(email = 'a@example.com') {
    const id = nanoid();
    await db.insert(schema.users).values({
      id, email, emailVerified: true, name: 'A',
      createdAt: new Date(), updatedAt: new Date(),
      onboardingStep: 4,
    });
    return { id, email };
  }

  async function seedDomain(userId: string, domain = 'example.com') {
    const id = nanoid();
    await db.insert(schema.domains).values({
      id, userId, domain, addedAt: new Date(), isActive: true,
    });
    return { id, domain };
  }

  return { db, sqlite, seedUser, seedDomain };
}

export function ctxFor(db: ReturnType<typeof makeTestDb>['db'], userId: string | null) {
  return {
    db: db as any,
    user: userId ? ({ id: userId, email: 'u@example.com' } as any) : null,
    session: userId ? ({ id: 's', userId } as any) : null,
  };
}
