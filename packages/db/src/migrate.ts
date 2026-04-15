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

    // Phase-1 security columns on users (TOTP, IP allowlist, session expiry,
    // log level). Idempotent.
    addColumn('users', 'totp_enabled', `INTEGER DEFAULT 0`);
    addColumn('users', 'totp_secret', `TEXT`);
    addColumn('users', 'totp_backup_codes', `TEXT`);
    addColumn('users', 'ip_allowlist', `TEXT`);
    addColumn('users', 'session_expiry_days', `INTEGER DEFAULT 7`);
    addColumn('users', 'log_level', `TEXT DEFAULT 'info'`);
    // Phase 3b — better-auth twoFactor plugin
    addColumn('users', 'two_factor_enabled', `INTEGER DEFAULT 0`);

    // Self-hosted deliverability inbox — extra columns on the existing
    // deliverability_tests table.
    addColumn('deliverability_tests', 'inbox_mode', `TEXT DEFAULT 'cloud'`);
    addColumn('deliverability_tests', 'analysis_source', `TEXT DEFAULT 'headers'`);

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
      CREATE TABLE IF NOT EXISTS deliverability_tests (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
        test_address TEXT NOT NULL UNIQUE,
        sending_mode TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT 'pending',
        score INTEGER,
        results TEXT,
        raw_headers TEXT,
        from_address TEXT,
        source_ip TEXT,
        subject TEXT,
        received_at INTEGER,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        inbox_mode TEXT DEFAULT 'cloud',
        analysis_source TEXT DEFAULT 'headers'
      );
      CREATE TABLE IF NOT EXISTS deliverability_inbox_config (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        inbox_domain TEXT,
        stalwart_integration_id TEXT REFERENCES stalwart_integrations(id) ON DELETE SET NULL,
        stalwart_catchall_address TEXT,
        webhook_secret TEXT,
        verified INTEGER DEFAULT 0,
        verified_at INTEGER,
        setup_step INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS two_factor (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        secret TEXT NOT NULL,
        backup_codes TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_two_factor_user_id ON two_factor(user_id);
      CREATE TABLE IF NOT EXISTS activity_log (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        detail TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        prefix TEXT NOT NULL,
        scopes TEXT NOT NULL,
        last_used_at INTEGER,
        last_used_ip TEXT,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS app_logs (
        id TEXT PRIMARY KEY NOT NULL,
        level TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        detail TEXT,
        error TEXT,
        stack TEXT,
        domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
        job_run_id TEXT,
        request_id TEXT,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        ip_address TEXT,
        duration_ms INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_app_logs_category ON app_logs(category);
      CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level);
      CREATE TABLE IF NOT EXISTS job_runs (
        id TEXT PRIMARY KEY NOT NULL,
        job_name TEXT NOT NULL,
        domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        duration_ms INTEGER,
        items_processed INTEGER DEFAULT 0,
        items_succeeded INTEGER DEFAULT 0,
        items_failed INTEGER DEFAULT 0,
        error_message TEXT,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_job_runs_started_at ON job_runs(started_at);
      CREATE INDEX IF NOT EXISTS idx_job_runs_job_name ON job_runs(job_name);
      CREATE TABLE IF NOT EXISTS delivery_events (
        id TEXT PRIMARY KEY NOT NULL,
        integration_id TEXT REFERENCES server_integrations(id) ON DELETE CASCADE,
        domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        provider TEXT,
        from_address TEXT,
        to_address TEXT,
        recipient_domain TEXT,
        bounce_type TEXT,
        error_code TEXT,
        error_message TEXT,
        related_rbl TEXT,
        occurred_at INTEGER NOT NULL,
        raw TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_delivery_events_occurred_at ON delivery_events(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_delivery_events_domain_id ON delivery_events(domain_id);
      CREATE INDEX IF NOT EXISTS idx_delivery_events_type ON delivery_events(type);
      CREATE TABLE IF NOT EXISTS delist_requests (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        rbl_name TEXT NOT NULL,
        listed_value TEXT NOT NULL,
        listing_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'not_submitted',
        submitted_at INTEGER,
        submission_method TEXT,
        submission_note TEXT,
        drafted_request TEXT,
        last_polled_at INTEGER,
        polling_enabled INTEGER DEFAULT 1,
        poll_interval_hours INTEGER DEFAULT 1,
        cleared_at INTEGER,
        timeline TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_delist_requests_domain ON delist_requests(domain_id);
      CREATE INDEX IF NOT EXISTS idx_delist_requests_status ON delist_requests(status);
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
