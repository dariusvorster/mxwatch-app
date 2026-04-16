<div align="center">

<svg width="80" height="80" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="16" fill="#185FA5"/>
  <path d="M12 38 L22 24 L32 34 L42 20 L52 38" stroke="#E6F1FB" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="52" cy="38" r="3" fill="#4A9EFF"/>
  <circle cx="32" cy="34" r="3" fill="#4A9EFF"/>
  <circle cx="12" cy="38" r="3" fill="#4A9EFF"/>
</svg>

# MxWatch

**Monitor your email infrastructure. Before your emails stop arriving.**

Real-time DMARC parsing, blacklist monitoring, DNS health checks, and deliverability scoring — self-hosted or managed.

[![License: MIT](https://img.shields.io/badge/License-MIT-185FA5.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io%2Fmxwatch%2Fmxwatch-185FA5)](https://github.com/mxwatch/mxwatch/pkgs/container/mxwatch)
[![Part of Homelab OS](https://img.shields.io/badge/Homelab%20OS-family-185FA5)](https://homelabos.app)

</div>

---

## What is MxWatch?

MxWatch is a self-hosted email infrastructure monitoring dashboard. It watches the things that determine whether your email actually gets delivered — DMARC alignment, blacklist status, DNS record health, SMTP connectivity, and TLS certificates — and alerts you before problems become incidents.

If you run your own mail server (Stalwart, Postfix, Mailcow, iRedMail), manage multiple domains, or just want to know the moment one of your domains lands on a blacklist, MxWatch is built for you.

### What it monitors

- **DMARC reports** — receives and parses aggregate XML reports from Gmail, Microsoft, Yahoo and every major inbox provider. Shows pass/fail breakdown per sending source, per domain, over time
- **Blacklist / RBL status** — checks 8 major real-time blacklists every 2 hours (Spamhaus ZEN, Barracuda, SORBS, URIBL, SpamCop, Spamrats, Mailspike, SEM-BACKSCATTER). Alerts the moment any IP or domain gets listed
- **DNS health** — validates SPF, DKIM, and DMARC records on a 6-hour schedule. Catches misconfigured records, missing selectors, and policy mismatches before they affect deliverability
- **SMTP connectivity** — tests port 25 and 587 every 30 minutes. Checks TLS validity, banner response, and response time. Detects outages before your users do
- **TLS certificates** — monitors certificate expiry on all mail-related hostnames. Alerts with enough lead time to renew without disruption
- **Deliverability scoring** — aggregates all check results into a per-domain score. One number that tells you how your domain looks to receiving mail servers

---

## Table of Contents

- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [DMARC report ingestion](#dmarc-report-ingestion)
- [Monitoring schedule](#monitoring-schedule)
- [Multi-domain setup](#multi-domain-setup)
- [Alert system](#alert-system)
- [Architecture](#architecture)
- [Configuration reference](#configuration-reference)
- [Deployment](#deployment)
  - [Single container](#single-container)
  - [Hetzner CX22 — recommended cloud setup](#hetzner-cx22--recommended-cloud-setup)
  - [Behind a reverse proxy](#behind-a-reverse-proxy)
- [Litestream backups](#litestream-backups)
- [First-run setup](#first-run-setup)
- [Upgrading](#upgrading)
- [Part of the Homelab OS family](#part-of-the-homelab-os-family)

---

## Quick start

```bash
git clone https://github.com/mxwatch/mxwatch
cd mxwatch
cp .env.example .env
# Edit .env — set BETTER_AUTH_SECRET and RESEND_API_KEY at minimum
docker compose up -d
```

Open `http://localhost:3000`, create your account, and add your first domain. MxWatch will start running checks immediately.

---

## How it works

MxWatch has three input channels:

**1. Active polling** — scheduled jobs run on a fixed interval, querying DNS resolvers, RBL lookup services, and your SMTP endpoints. Results are stored in SQLite and surfaced in the dashboard.

**2. SMTP listener** — a lightweight SMTP server runs inside the container on port 2525, receiving DMARC aggregate reports sent by inbox providers to your `rua` address. Reports arrive as gzip-compressed XML attachments and are parsed and stored automatically.

**3. Alert engine** — after every check, results are evaluated against your configured alert rules. Alerts fire via email (V1), Slack and webhooks (V2).

All state lives in a single SQLite database file. Litestream streams the SQLite WAL to Cloudflare R2 every 60 seconds — continuous off-site backup with no external database required.

---

## DMARC report ingestion

DMARC aggregate reports (the `rua=` destination in your DMARC record) need to be routed to MxWatch's built-in SMTP listener.

### Cloud (managed) — mxwatch.app

Point your `rua` at MxWatch's shared ingest address:

```dns
_dmarc.yourdomain.com  TXT  "v=DMARC1; p=reject; rua=mailto:dmarc@mxwatch.app"
```

### Self-hosted

Point your `rua` at your own MxWatch instance. The SMTP listener runs on port 2525 internally, mapped to whatever external port you expose:

```dns
_dmarc.yourdomain.com  TXT  "v=DMARC1; p=reject; rua=mailto:dmarc@mail.yourdomain.com"
```

Then configure your mail server (Stalwart, Postfix, etc.) to forward mail addressed to `dmarc@` to `localhost:2525` (or your MxWatch container IP on port 2525).

Alternatively, expose port 2525 directly and use an address that resolves to your MxWatch host. Inbox providers will deliver reports directly over SMTP.

**Important:** MxWatch accepts DMARC reports from any sending server — no authentication required on the SMTP listener. This is intentional — inbox providers send reports without credentials. Do not expose port 2525 on the public internet without rate limiting at your network edge.

### What gets parsed

Each DMARC aggregate report contains:
- Reporting organisation (Gmail, Outlook, Yahoo, etc.)
- Date range covered
- Number of messages that passed DMARC alignment
- Number that failed
- Per-message-source breakdown: SPF result, DKIM result, disposition

MxWatch stores the raw XML and the parsed summary. You can drill into any report to see which sending IPs are failing alignment and why.

---

## Monitoring schedule

| Check | Interval | What it does |
|---|---|---|
| DNS | Every 6 hours | Resolves and validates SPF, DKIM (all configured selectors), and DMARC records. Checks for policy changes, missing records, syntax errors |
| RBL | Every 2 hours | Queries 8 real-time blacklists for your domain and sending IPs. Fires alert immediately on new listing |
| SMTP | Every 30 minutes | Tests port 25 and 587 on your mail hostname. Checks STARTTLS, reads banner, measures response time |
| Certificate | Daily | Checks TLS cert expiry on all monitored mail hostnames. Alerts at 30 days and 7 days before expiry |
| DMARC | On receipt | Parses incoming aggregate reports as they arrive. No polling — event-driven |

All checks run in-process via `node-cron`. No Redis, no external queue, no worker processes. V1 is intentionally simple — the cron approach handles dozens of domains without issue. BullMQ + Redis is the V2 upgrade path for high-volume cloud deployments.

---

## Multi-domain setup

MxWatch is built for operators running multiple domains. There is no artificial domain limit — self-hosted is unlimited, cloud tiers are unlimited. Each domain is monitored independently with its own check history, DMARC reports, alert rules, and deliverability score.

### Adding a domain

1. Go to **Domains → Add domain**
2. Enter the domain (e.g. `homelabza.com`)
3. MxWatch provides a DNS verification record to confirm ownership
4. Add the TXT record to your DNS
5. Click **Verify** — MxWatch checks for the record
6. Once verified, monitoring starts immediately

### DKIM selectors

MxWatch checks DKIM by querying the DKIM selector record. Add your selector(s) under the domain settings (e.g. `mail`, `dkim`, `s1`). MxWatch queries `{selector}._domainkey.yourdomain.com` and validates the public key.

V1 supports one selector per domain. V2 adds multiple selectors (important for key rotation).

---

## Alert system

Alert rules are configured per domain. When a check result matches a rule, MxWatch fires the alert via the configured channel.

### Alert types

| Type | Fires when |
|---|---|
| `rbl_listed` | Domain or IP appears on any configured RBL |
| `rbl_delisted` | Domain or IP is removed from an RBL (resolved) |
| `dns_record_missing` | SPF, DKIM, or DMARC record not found |
| `dns_record_changed` | Any DNS record changes unexpectedly |
| `dmarc_policy_changed` | DMARC policy changes (e.g. `quarantine` → `none`) |
| `dmarc_fail_spike` | DMARC failure rate exceeds threshold in a report |
| `smtp_down` | Port 25 or 587 unreachable |
| `smtp_tls_invalid` | TLS handshake fails or cert is untrusted |
| `cert_expiring` | Certificate expiry within N days |
| `cert_expired` | Certificate has expired |
| `deliverability_drop` | Overall deliverability score drops below threshold |

### Alert channels

- **V1:** Email via Resend (`alerts@mxwatch.app` or your configured address)
- **V2:** Slack, webhook (POST to any URL), Zulip

### Alert deduplication

MxWatch does not re-fire the same alert continuously. Once an alert fires, it is suppressed until the condition resolves. When it resolves, a recovery notification is sent. This prevents alert fatigue on persistent issues.

---

## Architecture

```
mxwatch container
│
├── Next.js 15 (port 3000)
│   ├── App Router pages — dashboard, domains, reports, alerts
│   ├── tRPC API — all data access
│   └── better-auth — session management
│
├── node-cron jobs (in-process)
│   ├── DNS checker    — every 6h
│   ├── RBL checker    — every 2h
│   ├── SMTP checker   — every 30m
│   └── Cert checker   — daily
│
├── SMTP listener (port 2525)
│   └── Receives DMARC aggregate reports
│       Parses gzip XML → stores in dmarcReports table
│
├── SQLite database (/data/mxwatch.db)
│   └── Single file, all data
│
└── Litestream sidecar (in-process)
    └── Streams SQLite WAL → Cloudflare R2 every 60s
```

### Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | Full-stack, single deployment |
| API | tRPC v11 | End-to-end type safety |
| ORM | Drizzle ORM | Lightweight, SQLite native |
| Database | SQLite + Litestream | Zero ops, continuous backup |
| Auth | better-auth | Email/password V1, SSO V2 |
| Jobs | node-cron | In-process, no Redis needed |
| SMTP | smtp-server (npm) | Minimal SMTP for DMARC ingest |
| Email | Resend | Reliable transactional email |
| Deploy | Single Docker container | One command, no orchestration |

### Database schema

```
domains          — id, userId, domain, verifiedAt, createdAt
dkimSelectors    — id, domainId, selector
dnsChecks        — id, domainId, spfRecord, dkimValid, dmarcRecord, dmarcPolicy, checkedAt
rblChecks        — id, domainId, rblName, listed, listedReason, checkedAt
smtpChecks       — id, domainId, host, port, tlsValid, responseTime, checkedAt
dmarcReports     — id, domainId, reportId, orgName, dateRange, passCount, failCount, rawXml, receivedAt
alertRules       — id, domainId, type, channel, config, enabled
alertHistory     — id, ruleId, firedAt, resolvedAt, message
users            — id, email, passwordHash, createdAt
```

---

## Configuration reference

All configuration is via environment variables. Set these in `.env` or your `docker-compose.yml`.

### Required

| Variable | Description |
|---|---|
| `BETTER_AUTH_SECRET` | Secret key for session signing and encryption. Min 32 characters. Generate with `openssl rand -base64 32`. |
| `RESEND_API_KEY` | Resend API key for outbound alert emails. Get one at [resend.com](https://resend.com). |

### Optional — instance

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `file:./data/mxwatch.db` | Path to SQLite database file |
| `NEXTAUTH_URL` | `http://localhost:3000` | Public URL of your MxWatch instance. Used in alert email links. |
| `SMTP_LISTENER_PORT` | `2525` | Internal port for the DMARC report SMTP listener |
| `ALERTS_FROM_EMAIL` | `alerts@mxwatch.app` | From address for outbound alert emails |
| `ENCRYPTION_KEY` | — | Key for encrypting sensitive stored data. Generate with `openssl rand -base64 32`. |

### Optional — Litestream (recommended)

| Variable | Description |
|---|---|
| `LITESTREAM_R2_BUCKET` | Cloudflare R2 bucket name for database backups |
| `LITESTREAM_R2_ACCESS_KEY_ID` | R2 access key ID |
| `LITESTREAM_R2_SECRET_ACCESS_KEY` | R2 secret access key |
| `LITESTREAM_R2_ENDPOINT` | R2 endpoint URL (`https://<account-id>.r2.cloudflarestorage.com`) |

If Litestream variables are not set, the database is not backed up. Not recommended for production.

---

## Deployment

### Single container

The simplest deployment. Everything runs in one container.

**`docker-compose.yml`:**

```yaml
services:
  mxwatch:
    image: ghcr.io/mxwatch/mxwatch:latest
    container_name: mxwatch
    restart: unless-stopped
    ports:
      - "3000:3000"     # dashboard
      - "2525:2525"     # DMARC report SMTP listener
    volumes:
      - mxwatch_data:/app/data
    environment:
      - BETTER_AUTH_SECRET=your-secret-here
      - NEXTAUTH_URL=https://mail.yourdomain.com
      - RESEND_API_KEY=re_xxxxxxxxxxxx
      - LITESTREAM_R2_BUCKET=mxwatch-db-backups
      - LITESTREAM_R2_ACCESS_KEY_ID=
      - LITESTREAM_R2_SECRET_ACCESS_KEY=
      - LITESTREAM_R2_ENDPOINT=https://<id>.r2.cloudflarestorage.com

volumes:
  mxwatch_data:
```

```bash
docker compose up -d
```

### Hetzner CX22 — recommended cloud setup

For a public-facing MxWatch instance with proper TLS, Hetzner CX22 is the optimal choice: €3.79/mo, 2 vCPU, 4GB RAM, 40GB NVMe, and critically — **port 25 is not blocked** (most cloud providers block outbound port 25, but Hetzner CX22 does not block inbound 25/2525 for DMARC report ingestion).

**Provision the server:**

```bash
# Ubuntu 24.04 LTS — Helsinki (HEL1) recommended
# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Caddy for HTTPS
apt install caddy

# Clone MxWatch
git clone https://github.com/mxwatch/mxwatch /opt/mxwatch
cd /opt/mxwatch
cp .env.example .env
# Edit .env
```

**Caddy configuration (`/etc/caddy/Caddyfile`):**

```
mxwatch.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Caddy handles HTTPS automatically via Let's Encrypt. No certificate management needed.

**Start MxWatch:**

```bash
docker compose up -d
systemctl restart caddy
```

Total monthly cost: ~€7.60 (CX22 €3.79 + Cloudflare R2 ~€0.01 for DB backups + Resend free tier for alerts).

### Behind a reverse proxy

If MxWatch is running behind Nginx, Caddy, or [ProxyOS](https://proxyos.app) (recommended), expose only port 3000 to the proxy. Port 2525 should be exposed directly to the internet (or your mail server network) for DMARC report ingestion.

**With ProxyOS:**

In the ProxyOS dashboard, create a route pointing to your MxWatch container on port 3000. Enable SSO if you want Authentik/Authelia protecting the dashboard. Port 2525 is managed separately — expose it at the network level, not through the proxy.

**Proxying 2525:**

If you need to proxy the SMTP listener (e.g. you only have one public IP and want DMARC reports to arrive at port 25), use a TCP proxy (HAProxy or Caddy TCP) in front of MxWatch on port 2525. Do not use an HTTP reverse proxy for the SMTP port.

---

## Litestream backups

MxWatch uses [Litestream](https://litestream.io) for continuous SQLite replication to Cloudflare R2. Litestream runs as a sidecar process inside the container, streaming the SQLite write-ahead log to R2 every 60 seconds.

**Why 60 seconds:** this is the critical setting. A shorter interval unnecessarily increases R2 write operations. A longer interval increases potential data loss on failure. 60 seconds is the correct value — do not change it.

### Setting up Cloudflare R2

1. In your Cloudflare dashboard → R2 → Create bucket: `mxwatch-db-backups`
2. Create an R2 API token with Object Read & Write permissions
3. Note the endpoint URL: `https://<account-id>.r2.cloudflarestorage.com`
4. Set the four `LITESTREAM_R2_*` environment variables

### Restoring from backup

If the container or its data volume is lost:

```bash
# Stop any running MxWatch container
docker compose down

# Restore the database from R2
docker run --rm \
  -e LITESTREAM_R2_ACCESS_KEY_ID=your-key \
  -e LITESTREAM_R2_SECRET_ACCESS_KEY=your-secret \
  -v mxwatch_data:/app/data \
  ghcr.io/mxwatch/mxwatch:latest \
  litestream restore \
    -o /app/data/mxwatch.db \
    s3://mxwatch-db-backups/mxwatch.db

# Start MxWatch with restored database
docker compose up -d
```

Recovery point objective: maximum 60 seconds of data loss. Recovery time objective: under 5 minutes for a fresh server.

---

## First-run setup

On first start with an empty database, MxWatch presents a two-step setup:

**Step 1 — Create account**
Enter your email and password. This creates the admin account. There are no invite flows in V1 — the first account created is the admin.

**Step 2 — Add your first domain**
Enter a domain you control (e.g. `homelabza.com`). MxWatch generates a DNS verification TXT record. Add it to your domain's DNS, then click **Verify**. Monitoring starts immediately after verification — first check results appear within a few minutes.

**Recommended: configure DMARC reporting**

After adding a domain, update your DMARC record to point `rua` at your MxWatch instance:

```dns
_dmarc.yourdomain.com  TXT  "v=DMARC1; p=quarantine; rua=mailto:dmarc@your-mxwatch-domain.com"
```

DMARC reports typically arrive within 24 hours from major inbox providers.

---

## Upgrading

MxWatch uses Drizzle ORM migrations — the database schema is migrated automatically on startup.

```bash
# Pull latest image
docker compose pull

# Restart with new image (migrations run automatically)
docker compose up -d
```

Before upgrading, Litestream has already backed up your database to R2. If the upgrade fails:

```bash
# Roll back to previous image
docker compose down
docker compose up -d --no-pull  # uses cached previous image
```

Check the [releases page](https://github.com/mxwatch/mxwatch/releases) for breaking changes before upgrading between major versions.

---

## Part of the Homelab OS family

MxWatch is one product in the [Homelab OS](https://homelabos.app) family — a suite of self-hosted infrastructure tools that share a common design system and integrate with each other.

| Product | Description | Status |
|---|---|---|
| **MxWatch** | Email infrastructure monitoring | Available |
| [ProxyOS](https://proxyos.app) | Reverse proxy management | Available |
| [BackupOS](https://backupos.app) | Unified backup management | Coming soon |
| [InfraOS](https://infraos.app) | Infrastructure control plane | Coming soon |
| LockBoxOS | Credential vault | Coming soon |
| PatchOS | Patch management | Coming soon |
| AccessOS | Directory & identity | Coming soon |

### MxWatch + ProxyOS

If you're running ProxyOS alongside MxWatch, ProxyOS detects mail-related routes (domains serving on port 25/587/993, hostnames matching `mail.*`, `smtp.*`, `imap.*`) and flags them to MxWatch automatically. Your proxy and your mail monitoring stay in sync without manual configuration.

---

## License

MIT — see [LICENSE](LICENSE).

MxWatch is free and open source. The managed cloud tier ([app.mxwatch.app](https://app.mxwatch.app)) is a commercial service built on the same open source codebase.

---

<div align="center">
<sub>Built by <a href="https://homelabos.app">Homelab OS</a> · <a href="https://mxwatch.app">mxwatch.app</a></sub>
</div>
