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
| **IP reputation over time** | 90-day reputation chart with incident markers. |

### DMARC reporting

- Custom SMTP listener on port 2525 accepts aggregate reports as email attachments (ZIP / GZIP / raw XML)
- Per-report detail page with per-source-IP breakdown
- Pass / fail timeline chart (30-day window)
- **Unexpected senders** detection — source IPs that sent mail as your domain but aren't in your SPF `ip4:` / `ip6:` literals

### Alerts

- Channels: **email**, **Slack** (incoming webhook), **ntfy** (self-hosted ntfy works too), **generic webhook** with optional HMAC secret
- Rule types: `blacklist_listed`, `dns_record_changed`, `health_score_drop`, `dmarc_fail_spike`, `dmarc_report_received`
- Per-domain rule toggles with editable thresholds
- Test-alert button on every channel

### Tools

- **Record Builder** — SPF wizard with common provider templates and a live lookup counter, DMARC wizard with migration guidance
- **Deliverability Test** — send to a unique inbox, get a mail-tester-style 0–10 score
- **DNS Propagation Checker** — queries 19 public resolvers across 5 regions
- **IP warm-up scheduler** — geometric ramp plan with daily targets

### Integrations

- **Stalwart Mail Server** — pull queue / delivery / TLS stats from the management API; receive delivery-failure webhooks
- **Gmail Postmaster Tools** — OAuth connect, daily sync of spam rate / IP reputation / DMARC pass rate
- **Mail-log ingest** — HTTP POST endpoint for your MTA to push raw events; auto-correlated against DMARC source IPs

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
| `stalwart-pull` | 60s | Stalwart management-API stats |
| `postmaster-sync` | daily 04:00 UTC | Gmail Postmaster Tools sync |

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

---

## Roadmap

Shipped in V1 / V2 / V3 / V3.5. What's still coming:

- **Cloud-hosted tier** (`mxwatch.app`) — in progress, infrastructure code exists, pending business registration
- **Team members + workspaces** — multi-user workspaces with owner/admin/viewer roles
- **Stripe-replacement billing** — Lemon Squeezy integration plumbed in, dormant

See the [full V3.5 spec](mxwatch-v3.5-spec.md) for details on the last release.

---

## Troubleshooting

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
