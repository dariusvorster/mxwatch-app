<p align="center">
  <img src="screenshots/logo.svg" alt="MxWatch" width="96" />
</p>

<h1 align="center">MxWatch</h1>

<p align="center">
  <strong>Self-hosted email infrastructure monitoring for developers who run their own mail servers.</strong>
</p>

<p align="center">
  <a href="#install"><strong>Install</strong></a> ·
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#screenshots"><strong>Screenshots</strong></a> ·
  <a href="#architecture"><strong>Architecture</strong></a> ·
  <a href="#roadmap"><strong>Roadmap</strong></a>
</p>

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15-black?logo=next.js" />
  <img alt="Made for Stalwart" src="https://img.shields.io/badge/Made%20for-Stalwart-4a9eff" />
</p>

---

## Why MxWatch?

Running your own email server is hard not because of the initial setup — it's the ongoing invisible maintenance that catches you out. Your IP silently hits a Spamhaus blacklist. Your DMARC reports are XML files nobody reads. Your SPF record drifts past the 10-lookup limit after a provider swap. You find out when a client emails asking why they're not getting your invoices.

MxWatch continuously monitors the things that actually affect deliverability:

- **SPF / DKIM / DMARC health** — with an actionable "Fix this" drawer on every issue
- **12 RBL blacklists** — cross-checked against your sending IP every few hours
- **DMARC aggregate reports** — parsed from raw XML into a usable dashboard
- **Outbound SMTP reachability** — response time, TLS version, banner
- **TLS certificate expiry** — mail / web / MX hostnames
- **DNS change history** — diff view for every SPF/DKIM/DMARC snapshot
- **Alerts** — email, Slack, ntfy, webhook
- **Mail-log correlation** — optional Stalwart log ingest that lets you answer "is this IP in DMARC reports actually mine?"

---

## Install

### Docker Compose (recommended)

```bash
git clone https://github.com/dariusvorster/mxwatch-app.git
cd mxwatch-app
cp .env.example .env
# Edit .env — at minimum set MXWATCH_SECRET to a random 32-char string
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000). Sign up and the 4-step onboarding wizard walks you through adding a domain, confirming your mail-server architecture (auto-detected from MX + SMTP banner), optionally connecting to Stalwart/Postfix/Mailcow for deep stats, and setting alert preferences. You can re-run or resume the wizard any time from Settings.

### Local development

```bash
pnpm install
cp .env.example .env
pnpm db:push
pnpm dev
```

Requires **Node 20+** and **pnpm 9+**.

---

## Features

### Onboarding

4-step guided setup on first login (resumable from a dashboard banner or `Settings → Setup wizard`):

1. **Add your first domain** — verification + immediate DNS check
2. **Mail server architecture** — auto-detects MX + IP + SMTP banner (Stalwart / Postfix / Mailcow / Exchange), picks direct / NAT relay / split / managed
3. **Server integration** (optional) — pre-populated from the Step 2 auto-detect: server type (Stalwart / Mailcow / Postfix / …), architecture, and API base URL. Add a token to enable deep stats (queue depth, delivery rates, auth failures, bounces), or skip for external-only monitoring
4. **Alert preferences** — pre-filled email + per-rule toggles (blacklist, DNS change, health drop)

### Monitoring

| | |
|---|---|
| **Domain health score** (0–100) | Composite of SPF / DKIM / DMARC / MX status. Coloured: ≥80 green, 60–79 amber, <60 red. |
| **SPF / DKIM / DMARC parsing** | Record validity, lookup count, key length, policy. |
| **Multi-selector DKIM** | Add / remove selectors per domain; all checked every cycle. |
| **12 RBL suite** | Spamhaus ZEN / PBL / SBL / DBL, Barracuda, SORBS DUHL/SPAM, Invaluement, SpamCop, UCEPROTECT, MXToolbox, Passive Spam Block. |
| **Outbound SMTP health** | TLS version, STARTTLS negotiation, response time, banner capture. |
| **TLS certificate tracking** | Mail / web / MX hostnames, days-to-expiry alerts. |
| **DNS diff history** | Before/after view on every SPF/DKIM/DMARC change. |
| **IP reputation over time** | 90-day reputation chart with incident markers; cross-domain summary at `/ip-reputation` lists every owned domain with current listings + score. |

### DMARC reporting

- Custom SMTP listener on port 2525 accepts aggregate reports as email attachments (ZIP / GZIP / raw XML)
- Per-report detail page with per-source-IP breakdown
- Pass / fail timeline chart (30-day window)
- **Unexpected senders** detection — source IPs that sent mail as your domain but aren't in your SPF `ip4:` / `ip6:` literals

### Security

- **Two-factor authentication** — TOTP via any authenticator app (1Password, Authy, Google Authenticator, Bitwarden…). Backup codes issued once at setup and redeemable one-time on `/auth/2fa`. Cloud mode redirects signed-in users without 2FA to `/setup/2fa`.
- **Session management** — `/settings/security` lists every active session (UA + IP + created-age) with per-session revoke and "log out all other sessions". Current session is flagged.
- **API tokens** — account-scoped bearer tokens with named scopes (`domains:read`, `checks:read`, `reports:read`, `alerts:read`, `alerts:write`), optional expiry, and per-token last-used tracking. Token plaintext (`mxw_live_…` / `mxw_self_…`) is shown exactly once; only a SHA-256 hash is stored.
- **IP allowlist** — any number of IPs or CIDRs; when non-empty, every tRPC request is forbidden unless the client IP matches. `/auth/blocked` page surfaces the caller's IP so they can unlock themselves from the right network.
- **Password change** — 12-char minimum, revokes other sessions, surfaced collapsed on the Security page.
- **Activity log** — last 50 user-scoped security events (login, session revoke, token create/revoke, allowlist change, password change, 2FA changes).

### Logging

Every action and every scheduled job writes to two sinks: append-only NDJSON (`$LOG_DIR/mxwatch.log` + daily rotated archives) and a SQLite `app_logs` table searchable from the UI. Daily rotation keeps rotated files + SQLite rows inside `LOG_RETENTION_DAYS` (default 30).

- **Per-user log level** — `debug / info / warn / error`, changeable at `/settings/logs`; the running logger picks it up immediately via `setLogLevel` (no restart).
- **Job runs** — one `job_runs` row per scheduled-job invocation with status (`running / success / partial / failed`), duration, and items-processed/succeeded/failed counters. AdapterUnsupported throws don't count as failures.
- **`/logs` page** — level / category / search filters + the last N job runs at the top. Rows expand to show the full detail JSON + stack trace.
- **Domain-detail Logs tab** — job runs + log entries scoped to that domain with an All / Errors / Jobs client-side filter.
- **Topbar error badge** — red pill ⚠ N errors that appears when `app_logs` has >0 error rows in the last 24h (refreshes every 60s), linking straight to `/logs?level=error`.
- **NDJSON export** — download the last 7 or 30 days as `mxwatch-logs-YYYY-MM-DD.ndjson` from `/logs` or `/settings/logs`.
- **Sensitive-key redaction** — the logger sanitizes `password`, `secret`, `token`, `key`, `apikey`, `totpsecret`, `passwordhash`, `authorization` substrings to `[REDACTED]` before writing to either sink.

### Alerts

- Channels: **email**, **Slack** (incoming webhook), **ntfy** (self-hosted ntfy works too), **generic webhook** with optional HMAC secret
- Rule types: `blacklist_listed`, `dns_record_changed`, `health_score_drop`, `dmarc_fail_spike`, `dmarc_report_received`
- Per-domain rule toggles with editable thresholds
- Test-alert button on every channel
- **Watched-domain alerts** — external (non-owned) domains can opt into RBL-listing and DMARC-record-change notifications; the watched-check cron compares each new snapshot to the previous one and dispatches via your active channels on a real transition (no first-snapshot noise).

### Tools

- **Record Builder** — SPF wizard with common provider templates and a live lookup counter, DMARC wizard with migration guidance
- **Deliverability Test** — send to a unique inbox, get a mail-tester-style 0–10 score
- **DNS Propagation Checker** (`/tools/propagation`) — queries 19 public resolvers across 5 regions, with optional substring match against an expected value (e.g. confirm a new SPF record has propagated everywhere)
- **IP warm-up scheduler** — geometric ramp plan with daily targets

### Server intelligence (V4)

The deepest-visibility part of MxWatch. Once you connect a mail-server API, MxWatch pulls queue / delivery / auth / bounce data and surfaces it where it's actionable.

- **Auto-detection engine** — give it a hostname or IP and it port-scans, grabs the SMTP banner, EHLOs for capabilities, and probes management APIs to identify Stalwart / Mailcow / Postfix / Mailu / Maddy / Haraka / Exchange. Returns confidence + suggested architecture (direct / NAT relay / split / managed).
- **Adapter registry** — one interface (`MailServerAdapter`), six methods (`test`, `getStats`, `getQueue`, `getDeliveryEvents`, `getAuthFailures`, `getRecipientDomainStats`). Concrete adapters: **Stalwart** + **Mailcow** (full deep stats), **Mailu** (REST inventory), **Maddy** + **Haraka** (banner-identified). **Postfix** stub (agent-based, coming). Generic SMTP fallback for anything else.
- **Queue intelligence** — depth + active/deferred/failed + oldest-message-age, snapshotted every 5 min for the timeline chart.
- **Auth-failure monitoring** — Dovecot/Stalwart auth-failed events with per-IP aggregation over rolling windows. Brute-force candidates surface at the top.
- **Bounce intelligence** — DSN parser (RFC 3464) extracts Final-Recipient / Status / Diagnostic-Code, classifies hard / soft / policy, detects RBL mentions in the diagnostic. Correlator joins each bounce with active RBL listings + recent bounce spikes per recipient domain to assign severity and a suggested action.
- **Per-recipient-domain delivery rates** — the Postmaster-Tools-for-everyone view. Sent / delivered / deferred / bounced / rate per provider (gmail.com, outlook.com, yahoo.com, …) over 1h / 24h / 7d / 30d windows. Anything below 95% gets flagged as a problem domain.
- **Routes**: `/servers` (list), `/servers/new` (detect + connect wizard), `/servers/[id]` (Overview / Queue / Auth failures / Bounces / Delivery rates tabs), `/bounces` (cross-domain unified feed), `/delivery-rates` (cross-server provider rate dashboard with 1h / 24h / 7d / 30d windows).

### Integrations

- **Stalwart Mail Server** — full V4 adapter (pull stats, queue, delivery events, auth failures, recipient-domain stats) plus the legacy push-webhook receiver.
- **Mailcow** — full V4 adapter against the X-API-Key REST API; Postfix logs are parsed for delivery events and Dovecot logs for auth failures.
- **Mailu** — V4.1 adapter with Bearer-token REST against `/api/v1/`; reports domain + user inventory. Queue/log endpoints don't exist on Mailu, so deep stats need the upcoming Postfix agent.
- **Maddy** / **Haraka** — V4.1 banner-identifying adapters. Confirm the SMTP banner advertises the expected server; deep stats unsupported until log shipping ships.
- **Postfix** — adapter stub. Agent-based ingest is in design (will tail `/var/log/mail.log` over WebSocket).
- **Gmail Postmaster Tools** — OAuth connect, daily sync of spam rate / IP reputation / DMARC pass rate.
- **Mail-log ingest** — HTTP POST endpoint for your MTA to push raw events; auto-correlated against DMARC source IPs.

### API

Read-only REST at `/api/v1/` (account-scoped bearer tokens from `/settings/api`):

- `GET /api/v1/domains`
- `GET /api/v1/domains/{id}`
- `GET /api/v1/domains/{id}/dns?format=csv`
- `GET /api/v1/domains/{id}/reports?format=csv|json`
- `GET /api/v1/domains/{id}/reports.pdf` — monthly report PDF
- `GET /api/v1/alerts?onlyActive=1`

---

## Screenshots

Screenshots live in [`screenshots/`](screenshots/). Contributions welcome — drop a PNG in that folder and add it here.

<!-- Replace these when you add real screenshots -->
<!--
<p align="center">
  <img src="screenshots/dashboard.png" alt="Dashboard" width="720" />
  <img src="screenshots/domain-detail.png" alt="Domain detail" width="720" />
  <img src="screenshots/dmarc.png" alt="DMARC reports" width="720" />
</p>
-->

---

## Architecture

```
mxwatch-app/
├── apps/
│   └── web/                    # Next.js 15 App Router — UI + tRPC + API routes
├── packages/
│   ├── db/                     # Drizzle schema + SQLite client (WAL mode)
│   ├── monitor/                # DNS, RBL, DMARC parser, SMTP, cert, propagation, record builder
│   ├── alerts/                 # Email / Slack / ntfy / webhook dispatchers + AES-GCM config encryption
│   └── types/                  # Shared TypeScript types
├── tests/                      # Vitest suite
├── docker-compose.yml          # Single-container prod deploy (with migrator service)
├── Dockerfile                  # Multi-stage: deps → builder → migrator → runner
└── mxwatch-spec.md             # Original product spec
```

**Stack:** Next.js 15 • TypeScript • tRPC 11 • Drizzle ORM + better-sqlite3 • better-auth • Tailwind CSS v4 • Recharts • node-cron replacement (plain `setInterval`) • custom SMTP listener on `smtp-server`

**Scheduled jobs** (all in-process, no Redis):

| Job | Interval | Purpose |
|---|---|---|
| `dns-health-check` | hourly | SPF / DKIM / DMARC / MX sweep |
| `blacklist-check` | 6h | 12-RBL check for domains with a configured sending IP |
| `smtp-check` | 2h | SMTP health against primary MX |
| `cert-check` | daily 03:00 UTC | TLS cert expiry |
| `watched-check` | 2h | External domains sweep |
| `stalwart-pull` | 60s | Legacy Stalwart management-API stats (V3.5 path) |
| `server-stats-pull` | 60s | V4 — `getStats` against every server integration; opportunistic queue snapshot |
| `queue-snapshot` | 5m | V4 — full `getQueue` snapshot (active/deferred/failed/oldest-age) |
| `auth-failure-pull` | 5m | V4 — `getAuthFailures`, deduplicated against the last 10 min |
| `recipient-domain-aggregate` | hourly | V4 — pulls 24h delivery events, aggregates per recipient domain into rollups |
| `postmaster-sync` | daily 04:00 UTC | Gmail Postmaster Tools sync |
| `log-rotation` | daily 02:00 UTC | Rotates mxwatch.log → mxwatch.YYYY-MM-DD.log; prunes rotated files + app_logs rows past LOG_RETENTION_DAYS |

---

## Configuration

Everything is in `.env`. See [`.env.example`](.env.example) for the full list. Essentials:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite path, default `./data/mxwatch.db` |
| `MXWATCH_SECRET` | 32-char secret for better-auth + alert config encryption |
| `SMTP_PORT` | DMARC listener port, default `2525` (non-root) |
| `NEXT_PUBLIC_APP_URL` | Public URL, e.g. `https://mxwatch.example.com` |
| `ALERT_SMTP_*` | Outbound SMTP for email alerts |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional — enables Postmaster Tools |
| `LOG_LEVEL` | `debug / info / warn / error`, default `info` |
| `LOG_DIR` | Where NDJSON files live (default `/data/logs` inside Docker) |
| `LOG_RETENTION_DAYS` | Daily-rotation retention (default 30) |
| `NEXT_PUBLIC_MXWATCH_CLOUD` | `1` = force 2FA enrolment on every signed-in user |

---

## Roadmap

Shipped through V4 — auto-detection, multi-server adapters (Stalwart + Mailcow), bounce intelligence, queue snapshots, auth-failure monitoring, per-recipient-domain delivery rates, plus the new server-intelligence UI section. Build orders captured in [`mxwatch-v3.5-spec.md`](mxwatch-v3.5-spec.md) and [`mxwatch-v4-spec.md`](mxwatch-v4-spec.md).

What's still coming:

- **Postfix agent** — WebSocket-based log/queue ingest from non-API hosts (still pending — biggest remaining V4.1 piece)
- **Cloud-hosted tier** (`mxwatch.app`) — infrastructure code exists, pending business registration
- **Team members + workspaces** — multi-user workspaces with owner/admin/viewer roles
- **Stripe-replacement billing** — Lemon Squeezy integration plumbed in, dormant

---

## Troubleshooting

### Database migrations after upgrade

V3.6+ added a `users.onboarding_step` column and V4 added five new tables (`server_integrations`, `queue_snapshots`, `auth_failure_events`, `bounce_events`, `recipient_domain_stats`). On boot the app runs `applyPendingMigrations` from `packages/db/src/migrate.ts` — it's idempotent (`PRAGMA table_info` + `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` only when the column is missing) and also defensively backfills V3.5 columns on the `domains` table. No manual `db:push` required after pulling.

If you upgraded straight from <V3.5 and see `tRPC` 500s on `domains.list`, restart the container — the migration runs once at startup.

### DKIM selectors showing as "not found" after upgrade

Older builds accepted the full DNS form (e.g. `mail._domainkey.example.com`) and stored it verbatim, which caused the DNS probe to double-append `._domainkey`. Current code normalizes on input and at probe time, but pre-existing rows need a one-time cleanup:

```bash
node scripts/migrations/normalize-dkim-selectors.mjs
# or in Docker:
# docker compose exec web node scripts/migrations/normalize-dkim-selectors.mjs /app/data/mxwatch.db
```

Safe to re-run — idempotent.

---

## Contributing

Issues and PRs welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the quick version.

- Run tests: `pnpm test`
- Typecheck: `pnpm typecheck`
- Before PR: make sure `pnpm test && pnpm --filter @mxwatch/web build` passes

---

## License

[MIT](LICENSE) © Darius Vorster
