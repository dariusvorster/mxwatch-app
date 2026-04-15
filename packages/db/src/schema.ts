import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Users & Auth
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  passwordHash: text('password_hash'),
  name: text('name'),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  plan: text('plan', { enum: ['self_hosted', 'solo', 'teams'] }).default('self_hosted'),
  // Onboarding wizard progress. 0 = not started, 1 = domain added, 2 = architecture
  // set, 3 = server integration done/skipped, 4 = alerts set (wizard complete).
  onboardingStep: integer('onboarding_step').notNull().default(0),
  // Security additions (Phase 1)
  totpEnabled: integer('totp_enabled', { mode: 'boolean' }).default(false),
  totpSecret: text('totp_secret'),
  totpBackupCodes: text('totp_backup_codes'),
  ipAllowlist: text('ip_allowlist'),
  sessionExpiryDays: integer('session_expiry_days').default(7),
  logLevel: text('log_level').default('info'),
  // better-auth twoFactor plugin tracks enablement on the user row.
  twoFactorEnabled: integer('two_factor_enabled', { mode: 'boolean' }).default(false),
});

// Activity log — security-relevant user actions (login, settings change, etc.)
export const activityLog = sqliteTable('activity_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  detail: text('detail'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// API tokens — account-scoped bearer tokens with named scopes + expiry +
// per-token last-used tracking. Coexists with the older userApiTokens table
// while we migrate consumers over.
export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  prefix: text('prefix').notNull(),
  scopes: text('scopes').notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  lastUsedIp: text('last_used_ip'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
});

// Structured app logs — written by the new logger from monitoring jobs,
// tRPC handlers, and startup hooks. Indexed by category + level for the UI.
export const appLogs = sqliteTable('app_logs', {
  id: text('id').primaryKey(),
  level: text('level').notNull(),
  category: text('category').notNull(),
  message: text('message').notNull(),
  detail: text('detail'),
  error: text('error'),
  stack: text('stack'),
  domainId: text('domain_id').references(() => domains.id, { onDelete: 'set null' }),
  jobRunId: text('job_run_id'),
  requestId: text('request_id'),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  ipAddress: text('ip_address'),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Job runs — one row per scheduled-job invocation. Lets the UI surface
// last-success / last-failure / duration trends per job + per domain.
export const jobRuns = sqliteTable('job_runs', {
  id: text('id').primaryKey(),
  jobName: text('job_name').notNull(),
  domainId: text('domain_id').references(() => domains.id, { onDelete: 'set null' }),
  status: text('status').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  durationMs: integer('duration_ms'),
  itemsProcessed: integer('items_processed').default(0),
  itemsSucceeded: integer('items_succeeded').default(0),
  itemsFailed: integer('items_failed').default(0),
  errorMessage: text('error_message'),
  detail: text('detail'),
});

// better-auth sessions
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// better-auth twoFactor plugin backing store. Holds the shared TOTP secret
// + encoded backup codes per enrolled user. Populated by auth.api.enableTwoFactor
// and cleared by disableTwoFactor; we never touch it directly.
export const twoFactor = sqliteTable('two_factor', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(true),
});

// better-auth accounts (email/password + OAuth)
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  password: text('password'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// better-auth verification tokens
export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Domains being monitored
export const domains = sqliteTable('domains', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  domain: text('domain').notNull(),
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  notes: text('notes'),
  // Legacy single-IP field. New code reads `sendingIps` (JSON array) first and
  // falls back to this when the array is empty. Scheduled to be removed in a
  // future cleanup.
  sendingIp: text('sending_ip'),
  // Network topology — lets users describe NAT relays, split sending, and
  // fully-managed provider setups.
  architecture: text('architecture', { enum: ['direct', 'nat_relay', 'split', 'managed'] }).default('direct'),
  sendingIps: text('sending_ips'),              // JSON string[] — all IPs we should RBL-check
  smtpCheckHost: text('smtp_check_host'),       // host the outbound SMTP probe connects to
  relayHost: text('relay_host'),                // VPS / relay hostname or IP (nat_relay)
  internalHost: text('internal_host'),          // internal mail server IP (nat_relay)
  outboundProvider: text('outbound_provider', { enum: ['resend', 'sendgrid', 'postmark', 'custom'] }),
});

// DNS record snapshots
export const dnsSnapshots = sqliteTable('dns_snapshots', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull(),
  spfRecord: text('spf_record'),
  spfValid: integer('spf_valid', { mode: 'boolean' }),
  spfLookupCount: integer('spf_lookup_count'),
  dkimSelector: text('dkim_selector'),
  dkimRecord: text('dkim_record'),
  dkimValid: integer('dkim_valid', { mode: 'boolean' }),
  dmarcRecord: text('dmarc_record'),
  dmarcPolicy: text('dmarc_policy', { enum: ['none', 'quarantine', 'reject'] }),
  dmarcValid: integer('dmarc_valid', { mode: 'boolean' }),
  mxRecords: text('mx_records'),
  healthScore: integer('health_score'),
});

// DKIM selectors per domain
export const dkimSelectors = sqliteTable('dkim_selectors', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }),
  selector: text('selector').notNull(),
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull(),
});

// Blacklist checks
export const blacklistChecks = sqliteTable('blacklist_checks', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  listedOn: text('listed_on'),
  isListed: integer('is_listed', { mode: 'boolean' }),
});

// Blacklist definitions
export const blacklists = sqliteTable('blacklists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  severity: text('severity', { enum: ['critical', 'high', 'medium'] }),
  removalUrl: text('removal_url'),
  removalGuide: text('removal_guide'),
});

// DMARC aggregate reports
export const dmarcReports = sqliteTable('dmarc_reports', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }),
  reportId: text('report_id').notNull(),
  orgName: text('org_name').notNull(),
  dateRangeBegin: integer('date_range_begin', { mode: 'timestamp' }),
  dateRangeEnd: integer('date_range_end', { mode: 'timestamp' }),
  receivedAt: integer('received_at', { mode: 'timestamp' }).notNull(),
  totalMessages: integer('total_messages').default(0),
  passCount: integer('pass_count').default(0),
  failCount: integer('fail_count').default(0),
  rawXml: text('raw_xml'),
});

// Individual DMARC report rows
export const dmarcReportRows = sqliteTable('dmarc_report_rows', {
  id: text('id').primaryKey(),
  reportId: text('report_id').notNull().references(() => dmarcReports.id, { onDelete: 'cascade' }),
  sourceIp: text('source_ip').notNull(),
  count: integer('count').notNull(),
  disposition: text('disposition'),
  spfResult: text('spf_result'),
  dkimResult: text('dkim_result'),
  headerFrom: text('header_from'),
});

// Alert rules per domain
export const alertRules = sqliteTable('alert_rules', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['blacklist_listed', 'dns_record_changed', 'dmarc_fail_spike', 'health_score_drop', 'dmarc_report_received'],
  }).notNull(),
  threshold: integer('threshold'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
});

// Alert delivery channels per user
export const alertChannels = sqliteTable('alert_channels', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['email', 'slack', 'webhook', 'ntfy'] }).notNull(),
  config: text('config').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  label: text('label'),
});

// Alert history
export const alertHistory = sqliteTable('alert_history', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }),
  ruleId: text('rule_id').references(() => alertRules.id),
  firedAt: integer('fired_at', { mode: 'timestamp' }).notNull(),
  type: text('type').notNull(),
  message: text('message').notNull(),
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  channelsSent: text('channels_sent'),
});

// Google OAuth connection per user (for Postmaster Tools).
export const userGoogleOAuth = sqliteTable('user_google_oauth', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  googleEmail: text('google_email'),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  scope: text('scope'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
  lastSyncError: text('last_sync_error'),
});

// Lemon Squeezy subscriptions — Cloud-tier billing. Populated by the webhook
// handler from subscription_* events. `userId` is linked via the custom.user_id
// metadata embedded at checkout time.
export const lemonSubscriptions = sqliteTable('lemon_subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lemonSubscriptionId: text('lemon_subscription_id').notNull().unique(),
  lemonCustomerId: text('lemon_customer_id'),
  lemonOrderId: text('lemon_order_id'),
  lemonVariantId: text('lemon_variant_id'),
  tier: text('tier', { enum: ['self_hosted', 'solo', 'teams'] }).notNull().default('self_hosted'),
  status: text('status').notNull(), // raw LS status string
  renewsAt: integer('renews_at', { mode: 'timestamp' }),
  endsAt: integer('ends_at', { mode: 'timestamp' }),
  customerPortalUrl: text('customer_portal_url'),
  updatePaymentUrl: text('update_payment_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Stalwart Mail Server integrations (pull stats + receive webhook push).
export const stalwartIntegrations = sqliteTable('stalwart_integrations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  encryptedToken: text('encrypted_token').notNull(),
  webhookSecret: text('webhook_secret').notNull(),
  pullEnabled: integer('pull_enabled', { mode: 'boolean' }).default(true),
  pushEnabled: integer('push_enabled', { mode: 'boolean' }).default(false),
  lastPulledAt: integer('last_pulled_at', { mode: 'timestamp' }),
  lastError: text('last_error'),
  status: text('status', { enum: ['ok', 'error', 'unknown'] }).default('unknown'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const stalwartSnapshots = sqliteTable('stalwart_snapshots', {
  id: text('id').primaryKey(),
  integrationId: text('integration_id').notNull().references(() => stalwartIntegrations.id, { onDelete: 'cascade' }),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull(),
  queueDepth: integer('queue_depth'),
  queueFailed: integer('queue_failed'),
  delivered24h: integer('delivered_24h'),
  bounced24h: integer('bounced_24h'),
  rejected24h: integer('rejected_24h'),
  tlsPercent: integer('tls_percent'),
  rawData: text('raw_data'), // JSON from source, so fields added later can be re-parsed
});

export const stalwartEvents = sqliteTable('stalwart_events', {
  id: text('id').primaryKey(),
  integrationId: text('integration_id').notNull().references(() => stalwartIntegrations.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'delivery_failed' | 'message_rejected' | 'auth_failure' | 'queue_full' | custom
  detail: text('detail'), // JSON
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
});

// IP warm-up plans. Tracks a ramp-up schedule for a sending IP so users can
// Deliverability tests — send-to-unique-inbox with mail-tester-style scoring.
export const deliverabilityTests = sqliteTable('deliverability_tests', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  domainId: text('domain_id').references(() => domains.id, { onDelete: 'set null' }),
  testAddress: text('test_address').notNull().unique(), // full address, e.g. test-abc123@mxwatch.example.com
  sendingMode: text('sending_mode', { enum: ['manual', 'resend'] }).notNull().default('manual'),
  status: text('status', { enum: ['pending', 'received', 'analyzed', 'expired'] }).notNull().default('pending'),
  score: integer('score'), // 0-100 (stored as 10x to avoid floats)
  results: text('results'), // JSON: per-check breakdown
  rawHeaders: text('raw_headers'),
  fromAddress: text('from_address'),
  sourceIp: text('source_ip'),
  subject: text('subject'),
  receivedAt: integer('received_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

// build sender reputation gradually without tripping spam filters.
export const ipWarmups = sqliteTable('ip_warmups', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ipAddress: text('ip_address').notNull(),
  label: text('label'),
  startDate: integer('start_date', { mode: 'timestamp' }).notNull(),
  planDays: integer('plan_days').notNull().default(30),
  targetDailyVolume: integer('target_daily_volume').notNull(),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Daily Gmail Postmaster Tools traffic stats per domain.
export const postmasterStats = sqliteTable('postmaster_stats', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // YYYY-MM-DD
  spamRate: text('spam_rate'),
  ipReputations: text('ip_reputations'), // JSON { bad,low,medium,high }
  domainReputation: text('domain_reputation'),
  dkimSuccessRatio: text('dkim_success_ratio'),
  spfSuccessRatio: text('spf_success_ratio'),
  dmarcSuccessRatio: text('dmarc_success_ratio'),
  inboundEncryptionRatio: text('inbound_encryption_ratio'),
  outboundEncryptionRatio: text('outbound_encryption_ratio'),
  deliveryErrors: text('delivery_errors'), // JSON array
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
});

// External domains to monitor without owning (no DNS verification).
// RBL + DMARC + MX only — no SMTP connect, no deliverability test.
export const watchedDomains = sqliteTable('watched_domains', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull(),
  label: text('label'),
  notes: text('notes'),
  alertOnRblListing: integer('alert_on_rbl_listing', { mode: 'boolean' }).default(true),
  alertOnDmarcChange: integer('alert_on_dmarc_change', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const watchedDomainSnapshots = sqliteTable('watched_domain_snapshots', {
  id: text('id').primaryKey(),
  watchedDomainId: text('watched_domain_id').notNull().references(() => watchedDomains.id, { onDelete: 'cascade' }),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull(),
  mxRecords: text('mx_records'),
  resolvedIp: text('resolved_ip'),
  dmarcRecord: text('dmarc_record'),
  dmarcPolicy: text('dmarc_policy'),
  dmarcValid: integer('dmarc_valid', { mode: 'boolean' }),
  rblListedCount: integer('rbl_listed_count'),
  rblListedOn: text('rbl_listed_on'),
});

// SMTP health checks per domain (connects to MX, captures banner/TLS/time).
export const smtpChecks = sqliteTable('smtp_checks', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  connected: integer('connected', { mode: 'boolean' }).notNull().default(false),
  responseTimeMs: integer('response_time_ms'),
  banner: text('banner'),
  tlsVersion: text('tls_version'),
  tlsAuthorized: integer('tls_authorized', { mode: 'boolean' }),
  starttlsOffered: integer('starttls_offered', { mode: 'boolean' }),
  error: text('error'),
});

// TLS certificate checks per hostname associated with a domain.
export const certChecks = sqliteTable('cert_checks', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }),
  hostname: text('hostname').notNull(),
  port: integer('port').notNull(),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull(),
  authorized: integer('authorized', { mode: 'boolean' }),
  issuer: text('issuer'),
  subject: text('subject'),
  validFrom: integer('valid_from', { mode: 'timestamp' }),
  validTo: integer('valid_to', { mode: 'timestamp' }),
  daysUntilExpiry: integer('days_until_expiry'),
  fingerprint: text('fingerprint'),
  altNames: text('alt_names'), // JSON array
  error: text('error'),
});

// Account-scoped read-only API tokens. Used by /api/v1/* endpoints.
export const userApiTokens = sqliteTable('user_api_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  label: text('label'),
  tokenHash: text('token_hash').notNull().unique(),
  tokenPrefix: text('token_prefix').notNull(),
  scope: text('scope', { enum: ['api.read'] }).notNull().default('api.read'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
});

// Domain-scoped API tokens (for ingest endpoints).
// Stored as a SHA-256 hash; plaintext is shown to the user once at creation.
export const domainApiTokens = sqliteTable('domain_api_tokens', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }),
  label: text('label'),
  tokenHash: text('token_hash').notNull().unique(),
  tokenPrefix: text('token_prefix').notNull(), // first 8 chars of plaintext, for display
  scope: text('scope', { enum: ['logs.ingest'] }).notNull().default('logs.ingest'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
});

// V4 — server integrations (replaces the Stalwart-specific table for new setups
// while the legacy stalwartIntegrations stays around until migrated).
export const serverIntegrations = sqliteTable('server_integrations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  domainId: text('domain_id').references(() => domains.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  // MailServerType enum — see packages/monitor/src/server-detect.ts
  serverType: text('server_type', {
    enum: ['stalwart', 'mailcow', 'postfix', 'postfix_dovecot', 'mailu', 'maddy', 'haraka', 'exchange', 'unknown'],
  }).notNull(),
  // NetworkArchitecture enum — see packages/monitor/src/server-detect.ts
  architecture: text('architecture', { enum: ['direct', 'nat_relay', 'split', 'managed'] }).notNull().default('direct'),
  baseUrl: text('base_url'),
  encryptedToken: text('encrypted_token'),
  agentId: text('agent_id'),                     // Reserved for future Postfix-agent builds.
  internalHost: text('internal_host'),
  relayHost: text('relay_host'),
  sendingIps: text('sending_ips'),               // JSON string[]
  autoDetected: integer('auto_detected', { mode: 'boolean' }).default(false),
  detectionConfidence: text('detection_confidence', { enum: ['high', 'medium', 'low'] }),
  status: text('status', { enum: ['ok', 'error', 'unknown'] }).default('unknown'),
  lastError: text('last_error'),
  lastPulledAt: integer('last_pulled_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// V4 — queue depth timeseries per server integration.
export const queueSnapshots = sqliteTable('queue_snapshots', {
  id: text('id').primaryKey(),
  integrationId: text('integration_id').notNull().references(() => serverIntegrations.id, { onDelete: 'cascade' }),
  total: integer('total').notNull(),
  active: integer('active').notNull().default(0),
  deferred: integer('deferred').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  oldestMessageAge: integer('oldest_message_age'),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull(),
});

// V4 — auth failure / brute-force monitoring.
export const authFailureEvents = sqliteTable('auth_failure_events', {
  id: text('id').primaryKey(),
  integrationId: text('integration_id').notNull().references(() => serverIntegrations.id, { onDelete: 'cascade' }),
  ip: text('ip').notNull(),
  count: integer('count').notNull().default(1),
  sampleUsername: text('sample_username'),
  mechanism: text('mechanism'),
  detectedAt: integer('detected_at', { mode: 'timestamp' }).notNull(),
});

// V4 — parsed bounces correlated with RBL status.
export const bounceEvents = sqliteTable('bounce_events', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  originalTo: text('original_to').notNull(),
  recipientDomain: text('recipient_domain').notNull(),
  bounceType: text('bounce_type', { enum: ['hard', 'soft', 'policy'] }).notNull(),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  remoteMTA: text('remote_mta'),
  relatedRBL: text('related_rbl'),
  severity: text('severity', { enum: ['info', 'warning', 'critical'] }).default('info'),
  acknowledged: integer('acknowledged', { mode: 'boolean' }).default(false),
});

// V4 — per-recipient-domain delivery stats rollups.
export const recipientDomainStats = sqliteTable('recipient_domain_stats', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }),
  serverIntegrationId: text('server_integration_id').references(() => serverIntegrations.id, { onDelete: 'set null' }),
  recipientDomain: text('recipient_domain').notNull(),
  period: text('period', { enum: ['1h', '24h', '7d', '30d'] }).notNull(),
  sent: integer('sent').notNull().default(0),
  delivered: integer('delivered').notNull().default(0),
  bounced: integer('bounced').notNull().default(0),
  deferred: integer('deferred').notNull().default(0),
  deliveryRate: integer('delivery_rate'),         // 0-1000 (×10 for one decimal)
  avgDelayMs: integer('avg_delay_ms'),
  lastBounceReason: text('last_bounce_reason'),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull(),
});

// Mail events ingested from Stalwart / Mailcow / other MTAs.
export const mailEvents = sqliteTable('mail_events', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }),
  receivedAt: integer('received_at', { mode: 'timestamp' }).notNull(),
  eventTime: integer('event_time', { mode: 'timestamp' }),
  eventType: text('event_type'),            // e.g. delivery.success, smtp.connect
  direction: text('direction', { enum: ['outbound', 'inbound', 'auth', 'other'] }).default('other'),
  messageId: text('message_id'),
  senderAddress: text('sender_address'),
  recipientAddress: text('recipient_address'),
  remoteIp: text('remote_ip'),
  remoteHost: text('remote_host'),
  resultCode: text('result_code'),
  resultMessage: text('result_message'),
  rawJson: text('raw_json'),
});

// Check schedule config per domain
export const checkSchedules = sqliteTable('check_schedules', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }).unique(),
  dnsIntervalMinutes: integer('dns_interval_minutes').default(60),
  blacklistIntervalMinutes: integer('blacklist_interval_minutes').default(360),
  lastDnsCheck: integer('last_dns_check', { mode: 'timestamp' }),
  lastBlacklistCheck: integer('last_blacklist_check', { mode: 'timestamp' }),
});
