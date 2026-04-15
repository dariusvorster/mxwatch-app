import Database from 'better-sqlite3';

// Idempotent runtime migrations. Runs on boot before any query hits the DB.
// Replaces drizzle-kit push for in-place upgrades on self-hosted deployments
// where we don't want a --force truncate prompt.
export function applyPendingMigrations(dbUrl: string): void {
  const sqlite = new Database(dbUrl);
  try {
    sqlite.pragma('foreign_keys = ON');

    const columns = (table: string) =>
      new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));

    const addColumn = (table: string, name: string, ddl: string) => {
      const cols = columns(table);
      if (cols.size === 0) return; // table missing, handled elsewhere
      if (!cols.has(name)) {
        sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
        console.log(`[migrate] added ${table}.${name}`);
      }
    };

    // users.onboarding_step (V3.6)
    if (columns('users').size > 0 && !columns('users').has('onboarding_step')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN onboarding_step INTEGER NOT NULL DEFAULT 0`);
      sqlite.exec(`
        UPDATE users SET onboarding_step = 4
        WHERE id IN (SELECT DISTINCT user_id FROM domains)
      `);
      console.log('[migrate] added users.onboarding_step column');
    }

    // V3.5 topology columns — defensive: add if missing on older DBs.
    addColumn('domains', 'architecture', `TEXT DEFAULT 'direct'`);
    addColumn('domains', 'sending_ips', `TEXT`);
    addColumn('domains', 'sending_ip', `TEXT`);
    addColumn('domains', 'smtp_check_host', `TEXT`);
    addColumn('domains', 'relay_host', `TEXT`);
    addColumn('domains', 'internal_host', `TEXT`);
    addColumn('domains', 'outbound_provider', `TEXT`);
    addColumn('domains', 'notes', `TEXT`);
    addColumn('domains', 'is_active', `INTEGER DEFAULT 1`);

    // V4 server intelligence tables
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS server_integrations (
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
      CREATE TABLE IF NOT EXISTS queue_snapshots (
        id TEXT PRIMARY KEY NOT NULL,
        integration_id TEXT NOT NULL REFERENCES server_integrations(id) ON DELETE CASCADE,
        total INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 0,
        deferred INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        oldest_message_age INTEGER,
        recorded_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_failure_events (
        id TEXT PRIMARY KEY NOT NULL,
        integration_id TEXT NOT NULL REFERENCES server_integrations(id) ON DELETE CASCADE,
        ip TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        sample_username TEXT,
        mechanism TEXT,
        detected_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bounce_events (
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
      CREATE TABLE IF NOT EXISTS recipient_domain_stats (
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
    `);
  } finally {
    sqlite.close();
  }
}
