# MxWatch — Product Specification
**Version:** 1.0 | **Date:** April 2026  
**Domain:** mxwatch.app  
**Tagline:** Email infrastructure monitoring for developers who run their own mail.

---

## 1. What Is MxWatch?

MxWatch is a self-hosted email infrastructure dashboard for developers and indie founders who run their own mail servers. It continuously monitors domain health, parses DMARC aggregate reports, watches IP/domain blacklists, tracks SPF/DKIM/DMARC record integrity, and alerts immediately when something breaks — before your email starts bouncing.

**The problem it solves:** Running your own email (Stalwart, Mailcow, Postfix, Maddy) is hard not because of the initial setup, but because of the ongoing invisible maintenance. Your IP silently hits a Spamhaus blacklist. Your DMARC reports are XML files nobody reads. Your SPF record drifts. You find out when a client emails asking why they're not getting your invoices.

**The founder's unfair advantage:** The founder (Darius) runs Stalwart Mail Server for 6 domains, migrated from Mailcow, cleared a Spamhaus PBL listing manually, built a WireGuard relay through RackNerd VPS, achieved 10/10 on mail-tester.com, and configures SPF/DKIM/DMARC for all domains. Every feature in this spec was needed personally.

---

## 2. Target Users

**Primary:** Developers and indie founders running self-hosted mail (Stalwart, Mailcow, Postfix, Maddy, iRedMail)  
**Secondary:** Small agencies managing email infrastructure for clients (2–20 domains)  
**Tertiary:** Homelab enthusiasts with personal domains  

**Not targeting:** Enterprise (EasyDMARC, PowerDMARC own that), cold email senders (MailDeck owns that), general businesses without technical users.

---

## 3. Pricing

| Tier | Price | Domains | Features |
|------|-------|---------|----------|
| Self-hosted | Free | Unlimited | Full feature set, community support |
| Cloud Solo | $9/mo | Up to 10 | Hosted, managed, email/Slack alerts |
| Cloud Teams | $29/mo | Unlimited | All Solo features + team members + API access |

**Monetisation model:** Open-source self-hosted core drives adoption. Cloud tier charges for convenience (no server needed, managed uptime, push alerts). This is the Plausible/Umami playbook applied to email infra.

---

## 4. Tech Stack

### Frontend
- **Framework:** Next.js 15 (App Router) + TypeScript
- **Styling:** Tailwind CSS v4 + shadcn/ui
- **State:** TanStack Query (server state) + Zustand (UI state)
- **Charts:** Recharts
- **Auth:** better-auth with email/password + optional OAuth (GitHub, Google)

### Backend
- **API:** tRPC (type-safe end-to-end, same pattern as Infra OS)
- **Database:** SQLite with Drizzle ORM (WAL mode, single file, zero ops)
- **Background jobs:** BullMQ with Redis (or node-cron for self-hosted simplicity)
- **Email receiving:** Custom SMTP listener on port 25 for DMARC `rua` reports (or webhook-based parsing)
- **DNS lookups:** `dns` Node.js native module + `node-dns` for custom resolvers

### Monorepo Structure
```
mxwatch/
├── apps/
│   └── web/                    # Next.js app (UI + API routes)
│       ├── src/
│       │   ├── app/            # App Router pages
│       │   ├── components/     # UI components
│       │   ├── server/         # tRPC routers
│       │   └── lib/            # Utilities
├── packages/
│   ├── db/                     # Drizzle schema + migrations
│   ├── monitor/                # Core monitoring logic (DNS, blacklists, DMARC)
│   ├── alerts/                 # Alert channel implementations
│   └── types/                  # Shared TypeScript types
├── docker-compose.yml
├── docker-compose.self-hosted.yml
└── CLAUDE.md
```

### Deployment
- **Self-hosted:** Single `docker compose up` — one container (Next.js + SQLite)
- **Cloud:** Railway or Fly.io, SQLite + Litestream for backup replication
- **Environment variables:** `DATABASE_URL`, `MXWATCH_SECRET`, `SMTP_PORT`, `ALERT_SMTP_*`

---

## 5. Database Schema (Drizzle + SQLite)

```typescript
// packages/db/schema.ts

// Users & Auth
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  name: text('name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  plan: text('plan', { enum: ['self_hosted', 'solo', 'teams'] }).default('self_hosted'),
})

// Domains being monitored
export const domains = sqliteTable('domains', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  domain: text('domain').notNull(),           // e.g. "gitbay.dev"
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  notes: text('notes'),
})

// DNS record snapshots — taken on each check cycle
export const dnsSnapshots = sqliteTable('dns_snapshots', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull(),
  spfRecord: text('spf_record'),              // raw TXT value
  spfValid: integer('spf_valid', { mode: 'boolean' }),
  spfLookupCount: integer('spf_lookup_count'),// must be <= 10
  dkimSelector: text('dkim_selector'),        // e.g. "mail"
  dkimRecord: text('dkim_record'),
  dkimValid: integer('dkim_valid', { mode: 'boolean' }),
  dmarcRecord: text('dmarc_record'),
  dmarcPolicy: text('dmarc_policy', { enum: ['none', 'quarantine', 'reject'] }),
  dmarcValid: integer('dmarc_valid', { mode: 'boolean' }),
  mxRecords: text('mx_records'),              // JSON array
  healthScore: integer('health_score'),       // 0-100 composite
})

// DKIM selectors per domain (can have multiple)
export const dkimSelectors = sqliteTable('dkim_selectors', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id),
  selector: text('selector').notNull(),       // e.g. "mail", "dkim2026"
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull(),
})

// Blacklist checks
export const blacklistChecks = sqliteTable('blacklist_checks', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),              // sending IP checked
  listedOn: text('listed_on'),               // JSON array of blacklist names
  isListed: integer('is_listed', { mode: 'boolean' }),
})

// Blacklist definitions (the RBLs we check)
export const blacklists = sqliteTable('blacklists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),              // "Spamhaus PBL"
  host: text('host').notNull(),             // "pbl.spamhaus.org"
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  severity: text('severity', { enum: ['critical', 'high', 'medium'] }),
  removalUrl: text('removal_url'),          // link to delist form
  removalGuide: text('removal_guide'),      // markdown instructions
})

// DMARC aggregate reports (parsed from XML)
export const dmarcReports = sqliteTable('dmarc_reports', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id),
  reportId: text('report_id').notNull(),    // from report metadata
  orgName: text('org_name').notNull(),      // reporting org (Google, Yahoo, etc.)
  dateRangeBegin: integer('date_range_begin', { mode: 'timestamp' }),
  dateRangeEnd: integer('date_range_end', { mode: 'timestamp' }),
  receivedAt: integer('received_at', { mode: 'timestamp' }).notNull(),
  totalMessages: integer('total_messages').default(0),
  passCount: integer('pass_count').default(0),
  failCount: integer('fail_count').default(0),
  rawXml: text('raw_xml'),                  // stored for re-parsing
})

// Individual DMARC report rows (one per source IP per report)
export const dmarcReportRows = sqliteTable('dmarc_report_rows', {
  id: text('id').primaryKey(),
  reportId: text('report_id').notNull().references(() => dmarcReports.id),
  sourceIp: text('source_ip').notNull(),
  count: integer('count').notNull(),
  disposition: text('disposition'),          // "none", "quarantine", "reject"
  spfResult: text('spf_result'),            // "pass", "fail", "softfail"
  dkimResult: text('dkim_result'),          // "pass", "fail"
  headerFrom: text('header_from'),
})

// Alert rules per domain
export const alertRules = sqliteTable('alert_rules', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id),
  type: text('type', { 
    enum: ['blacklist_listed', 'dns_record_changed', 'dmarc_fail_spike', 'health_score_drop', 'dmarc_report_received']
  }).notNull(),
  threshold: integer('threshold'),          // e.g. fail % threshold for spike
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
})

// Alert delivery channels per user
export const alertChannels = sqliteTable('alert_channels', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  type: text('type', { enum: ['email', 'slack', 'webhook', 'ntfy'] }).notNull(),
  config: text('config').notNull(),         // JSON: { url, token, etc. }
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  label: text('label'),                     // "Slack #alerts"
})

// Alert history
export const alertHistory = sqliteTable('alert_history', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id),
  ruleId: text('rule_id').references(() => alertRules.id),
  firedAt: integer('fired_at', { mode: 'timestamp' }).notNull(),
  type: text('type').notNull(),
  message: text('message').notNull(),
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }), // null = still active
  channelsSent: text('channels_sent'),      // JSON array of channel IDs
})

// Check schedule config per domain
export const checkSchedules = sqliteTable('check_schedules', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').notNull().references(() => domains.id).unique(),
  dnsIntervalMinutes: integer('dns_interval_minutes').default(60),
  blacklistIntervalMinutes: integer('blacklist_interval_minutes').default(360),
  lastDnsCheck: integer('last_dns_check', { mode: 'timestamp' }),
  lastBlacklistCheck: integer('last_blacklist_check', { mode: 'timestamp' }),
})
```

---

## 6. Core Monitoring Logic

### 6.1 Blacklists to Check (packages/monitor/blacklists.ts)

```typescript
export const BLACKLISTS = [
  // Critical — major deliverability impact
  { name: 'Spamhaus ZEN',     host: 'zen.spamhaus.org',      severity: 'critical', 
    removalUrl: 'https://check.spamhaus.org/' },
  { name: 'Spamhaus PBL',     host: 'pbl.spamhaus.org',      severity: 'critical',
    removalUrl: 'https://www.spamhaus.org/pbl/query/REMOVEPBL' },
  { name: 'Spamhaus SBL',     host: 'sbl.spamhaus.org',      severity: 'critical',
    removalUrl: 'https://check.spamhaus.org/' },
  { name: 'Spamhaus DBL',     host: 'dbl.spamhaus.org',      severity: 'critical' },
  { name: 'Barracuda BRBL',   host: 'b.barracudacentral.org', severity: 'critical',
    removalUrl: 'https://www.barracudacentral.org/rbl/removal-request' },
  { name: 'SORBS DUHL',       host: 'dul.sorbs.net',          severity: 'high' },
  { name: 'SORBS SPAM',       host: 'spam.sorbs.net',         severity: 'high' },
  { name: 'Invaluement ivmSIP', host: 'sip.invaluement.com', severity: 'high' },
  { name: 'SpamCop',          host: 'bl.spamcop.net',         severity: 'high' },
  { name: 'UCEPROTECT L1',    host: 'dnsbl-1.uceprotect.net', severity: 'medium' },
  { name: 'MXToolbox Top',    host: 'dnsbl.mxtoolbox.com',   severity: 'medium' },
  { name: 'Passive Spam Block', host: 'psbl.surriel.com',    severity: 'medium' },
]

// DNSBL lookup: reverse IP + append blacklist host
// e.g. for IP 1.2.3.4 checking zen.spamhaus.org:
// lookup: 4.3.2.1.zen.spamhaus.org — A record present = listed
export async function checkIpAgainstBlacklist(ip: string, blacklist: typeof BLACKLISTS[0]) {
  const reversed = ip.split('.').reverse().join('.')
  const lookup = `${reversed}.${blacklist.host}`
  try {
    await dns.promises.resolve4(lookup)
    return { listed: true, blacklist: blacklist.name }
  } catch {
    return { listed: false, blacklist: blacklist.name }
  }
}
```

### 6.2 DNS Health Check (packages/monitor/dns.ts)

```typescript
export async function checkDomainHealth(domain: string, dkimSelectors: string[]) {
  const results = {
    spf: await checkSpf(domain),
    dkim: await Promise.all(dkimSelectors.map(s => checkDkim(domain, s))),
    dmarc: await checkDmarc(domain),
    mx: await checkMx(domain),
  }
  return {
    ...results,
    healthScore: calculateHealthScore(results),
  }
}

async function checkSpf(domain: string) {
  const txt = await dns.promises.resolveTxt(domain)
  const spf = txt.flat().find(r => r.startsWith('v=spf1'))
  if (!spf) return { valid: false, record: null, lookupCount: 0, issues: ['No SPF record found'] }
  
  const lookupCount = countSpfLookups(spf) // count include/a/mx/ptr/exists mechanisms
  const issues = []
  if (lookupCount > 10) issues.push(`SPF exceeds 10 DNS lookup limit (${lookupCount} found)`)
  if (spf.includes('+all')) issues.push('SPF uses +all — extremely dangerous, allows any sender')
  if (!spf.includes('~all') && !spf.includes('-all')) issues.push('SPF missing ~all or -all qualifier')
  
  return { valid: issues.length === 0, record: spf, lookupCount, issues }
}

async function checkDkim(domain: string, selector: string) {
  try {
    const txt = await dns.promises.resolveTxt(`${selector}._domainkey.${domain}`)
    const record = txt.flat().join('')
    const issues = []
    if (record.includes('k=rsa') && !record.includes('p=')) issues.push('DKIM public key missing')
    const keyMatch = record.match(/p=([A-Za-z0-9+/=]+)/)
    if (keyMatch) {
      const keyLength = Buffer.from(keyMatch[1], 'base64').length * 8
      if (keyLength < 1024) issues.push(`DKIM key too short (${keyLength} bits, minimum 1024)`)
      if (keyLength < 2048) issues.push(`DKIM key should be 2048 bits (currently ${keyLength})`)
    }
    return { selector, valid: issues.length === 0, record, issues }
  } catch {
    return { selector, valid: false, record: null, issues: [`DKIM selector '${selector}' not found`] }
  }
}

async function checkDmarc(domain: string) {
  try {
    const txt = await dns.promises.resolveTxt(`_dmarc.${domain}`)
    const record = txt.flat().join('')
    const issues = []
    
    const policy = record.match(/p=(none|quarantine|reject)/)?.[1]
    if (!policy) issues.push('DMARC policy not set')
    if (policy === 'none') issues.push('DMARC policy is p=none — emails not protected yet')
    
    const hasRua = record.includes('rua=')
    if (!hasRua) issues.push('No DMARC aggregate report address (rua) — you are flying blind')
    
    const pct = record.match(/pct=(\d+)/)?.[1]
    if (pct && parseInt(pct) < 100) issues.push(`DMARC pct=${pct} — policy only applies to ${pct}% of mail`)
    
    return { valid: issues.length === 0, record, policy, hasRua, issues }
  } catch {
    return { valid: false, record: null, policy: null, hasRua: false, 
             issues: ['No DMARC record found'] }
  }
}

function calculateHealthScore(results: ReturnType<typeof checkDomainHealth> extends Promise<infer T> ? T : never): number {
  let score = 100
  if (!results.spf.valid) score -= 25
  else if (results.spf.issues.length) score -= 10
  if (!results.dkim.some(d => d.valid)) score -= 25
  if (!results.dmarc.valid) score -= 30
  else if (results.dmarc.policy === 'none') score -= 10
  if (!results.mx.length) score -= 20
  return Math.max(0, score)
}
```

### 6.3 DMARC Report Parser (packages/monitor/dmarc-parser.ts)

```typescript
import { XMLParser } from 'fast-xml-parser'

export function parseDmarcReport(xml: string) {
  const parser = new XMLParser({ ignoreAttributes: false })
  const result = parser.parse(xml)
  const feedback = result.feedback

  const metadata = feedback.report_metadata
  const policyPublished = feedback.policy_published
  const records = Array.isArray(feedback.record) ? feedback.record : [feedback.record]

  return {
    reportId: metadata.report_id,
    orgName: metadata.org_name,
    email: metadata.email,
    dateRangeBegin: new Date(metadata.date_range.begin * 1000),
    dateRangeEnd: new Date(metadata.date_range.end * 1000),
    domain: policyPublished.domain,
    policy: policyPublished.p,
    rows: records.map(record => ({
      sourceIp: record.row.source_ip,
      count: record.row.count,
      disposition: record.row.policy_evaluated?.disposition,
      dkimResult: record.row.policy_evaluated?.dkim,
      spfResult: record.row.policy_evaluated?.spf,
      headerFrom: record.identifiers?.header_from,
    })),
  }
}
```

### 6.4 SMTP Listener for DMARC Reports (packages/monitor/smtp-listener.ts)

DMARC aggregate reports arrive as email attachments (ZIP or GZIP containing XML).

```typescript
import { SMTPServer } from 'smtp-server'
import { simpleParser } from 'mailparser'
import { createGunzip } from 'zlib'
import { createReadStream } from 'fs'
import AdmZip from 'adm-zip'

export function startSmtpListener(port: number, onReport: (xml: string, fromDomain: string) => Promise<void>) {
  const server = new SMTPServer({
    authOptional: true,
    onData(stream, session, callback) {
      simpleParser(stream, async (err, mail) => {
        if (err) return callback(err)
        for (const attachment of (mail.attachments || [])) {
          let xml: string | null = null
          if (attachment.contentType === 'application/zip' || attachment.filename?.endsWith('.zip')) {
            const zip = new AdmZip(attachment.content)
            xml = zip.getEntries()[0]?.getData().toString('utf8') ?? null
          } else if (attachment.contentType === 'application/gzip' || attachment.filename?.endsWith('.gz')) {
            xml = await gunzipBuffer(attachment.content)
          } else if (attachment.filename?.endsWith('.xml')) {
            xml = attachment.content.toString('utf8')
          }
          if (xml) {
            const from = session.envelope.mailFrom?.address ?? 'unknown'
            await onReport(xml, from).catch(console.error)
          }
        }
        callback()
      })
    },
  })
  server.listen(port, () => console.log(`MxWatch SMTP listener on port ${port}`))
  return server
}
```

---

## 7. Application Pages & Routes

### 7.1 Page Structure

```
/                           → Dashboard (overview of all domains)
/domains                    → Domain list + add domain
/domains/[id]               → Domain detail view
/domains/[id]/dmarc         → DMARC reports browser
/domains/[id]/blacklists    → Blacklist check history
/domains/[id]/dns           → DNS record history + diff
/domains/[id]/alerts        → Alert rule config for this domain
/settings                   → User settings
/settings/alerts            → Global alert channels (Slack, email, ntfy)
/settings/smtp              → SMTP listener config (rua address setup)
/onboarding                 → First-run setup wizard
/login                      → Auth
/signup                     → Create account
```

### 7.2 Dashboard Page

The main dashboard shows:
- **Health score cards** — one per domain, coloured red/amber/green, with score 0-100
- **Active alerts** — any current blacklist listings or DNS issues, with "Fix this" CTAs
- **Recent DMARC report summary** — pass/fail ratio across all domains, last 7 days
- **Last checked** — when each domain was last scanned

### 7.3 Domain Detail Page

Tabs:
1. **Overview** — current health score breakdown, SPF/DKIM/DMARC status chips, sending IPs
2. **DMARC** — report timeline chart, pass/fail ratio, source IP breakdown table
3. **Blacklists** — grid of all monitored RBLs, green/red status, last check time
4. **DNS Records** — current SPF/DKIM/DMARC values with inline issue flags, history diff
5. **Alerts** — rules enabled for this domain

---

## 8. Alert System

### Alert Types

| Type | Trigger | Default |
|------|---------|---------|
| `blacklist_listed` | IP or domain appears on any monitored RBL | Enabled, critical severity |
| `dns_record_changed` | Any SPF/DKIM/DMARC record changes vs last snapshot | Enabled |
| `dmarc_fail_spike` | DMARC fail rate exceeds threshold (default 10%) | Enabled |
| `health_score_drop` | Health score drops more than 20 points | Enabled |
| `dmarc_report_received` | New aggregate report parsed | Optional |

### Alert Channels

```typescript
// packages/alerts/channels.ts

export async function sendAlert(channel: AlertChannel, alert: Alert) {
  switch (channel.type) {
    case 'email':
      return sendEmailAlert(channel.config, alert)
    case 'slack':
      return sendSlackAlert(channel.config.webhookUrl, alert)
    case 'webhook':
      return sendWebhookAlert(channel.config.url, alert)
    case 'ntfy':
      return sendNtfyAlert(channel.config.url, channel.config.topic, alert)
  }
}

async function sendNtfyAlert(url: string, topic: string, alert: Alert) {
  // ntfy.sh compatible — works with self-hosted ntfy too
  await fetch(`${url}/${topic}`, {
    method: 'POST',
    headers: {
      'Title': `MxWatch: ${alert.domainName}`,
      'Priority': alert.severity === 'critical' ? 'urgent' : 'default',
      'Tags': alert.type,
    },
    body: alert.message,
  })
}
```

---

## 9. Onboarding Wizard

First-run experience — critical for conversion. 4 steps:

**Step 1: Add your first domain**
- Enter domain name
- Immediate DNS check runs in background while they fill in step 2

**Step 2: Configure DMARC reporting**
- Show the exact DNS TXT record to add as `_dmarc.yourdomain.com`
- The `rua=mailto:` address points to MxWatch' SMTP listener or a provided mailbox
- Self-hosted: `rua=mailto:dmarc@mxwatch.yourdomain.com` (configure MX)
- Cloud: `rua=mailto:reports@in.mxwatch.app`

**Step 3: Add DKIM selectors**
- Enter selector names (e.g. "mail", "dkim2026")
- MxWatch checks if they resolve, shows found/not found

**Step 4: Set up alerts**
- Pick email address for alerts
- Optional: Slack webhook or ntfy topic
- "Send test alert" button

---

## 10. "Fix This" Guided Repairs

Every issue flagged by MxWatch has an inline "Fix this →" button that opens a drawer with:

1. **Plain-English explanation** of what the issue is and why it matters
2. **Exact DNS record** to add or change (copyable)
3. **Verification command** (e.g. `dig TXT _dmarc.yourdomain.com`)
4. **For blacklist listings**: step-by-step removal guide specific to that blacklist

Examples:
- "Your SPF record has 12 DNS lookups (max is 10)" → show which mechanisms to flatten using `include:` substitution
- "Listed on Spamhaus PBL" → explain it's a residential IP policy, link to removal form, explain WireGuard relay workaround
- "DMARC policy is p=none" → explain the three stages (none → quarantine → reject), suggest moving to quarantine

---

## 11. MVP Scope (V1 — Ship in 2–3 Weeks)

### In V1
- [ ] Auth (email/password, single user)
- [ ] Add/remove domains
- [ ] DNS health check: SPF, DKIM (single selector), DMARC
- [ ] Health score calculation
- [ ] Blacklist monitoring: top 8 critical/high RBLs
- [ ] DMARC report ingestion via SMTP listener (port 2525 for self-hosted, port 25 needs root)
- [ ] DMARC report parsing and visualisation (pass/fail chart, source IP table)
- [ ] Alert channels: email only
- [ ] Basic "Fix this" copy for common issues
- [ ] Dashboard + domain detail pages
- [ ] Docker Compose deploy (single container)
- [ ] Onboarding wizard (simplified 2-step)

### V2 (Week 4–6)
- [ ] Multiple DKIM selectors per domain
- [ ] Slack + ntfy + webhook alerts
- [ ] Full blacklist suite (12 RBLs)
- [ ] DNS record diff history
- [ ] DMARC fail spike detection
- [ ] Cloud deploy (Railway)
- [ ] Stripe billing for cloud tier
- [ ] Settings page (alert channels, check intervals)

### V3 (Month 2)
- [ ] IP warm-up scheduler
- [ ] Google Postmaster Tools integration (OAuth)
- [ ] Team members (Teams plan)
- [ ] API access (read-only)
- [ ] Export reports (CSV, PDF)
- [ ] Stalwart/Mailcow native log parsing

---

## 12. Dogfooding Plan

Day 1 of V1 completion: add all 6 domains.

| Domain | Stalwart? | Current score | Notes |
|--------|-----------|---------------|-------|
| gitbay.dev | Yes | Unknown | Primary product |
| homelabza.com | Yes | 10/10 mail-tester | Solid baseline |
| nudgenudge.com | Yes | Unknown | |
| uno-post.com | Yes | Unknown | |
| igotreceipts.app | Yes | Unknown | |
| packetdeck.com | Yes | Unknown | |

DMARC `rua` for all 6 domains will point to the local SMTP listener at `192.168.69.12:2525` (Stalwart's address), or via a Cloudflare tunnel to the MxWatch instance.

---

## 13. Key Dependencies

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "better-auth": "^1.0.0",
    "drizzle-orm": "^0.30.0",
    "better-sqlite3": "^9.0.0",
    "@trpc/server": "^11.0.0",
    "@trpc/client": "^11.0.0",
    "@trpc/next": "^11.0.0",
    "smtp-server": "^3.13.0",
    "mailparser": "^3.6.0",
    "fast-xml-parser": "^4.3.0",
    "adm-zip": "^0.5.16",
    "nodemailer": "^6.9.0",
    "recharts": "^2.12.0",
    "tailwindcss": "^4.0.0",
    "zod": "^3.22.0",
    "bullmq": "^5.0.0",
    "ioredis": "^5.3.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.20.0",
    "typescript": "^5.4.0"
  }
}
```

---

## 14. CLAUDE.md for the Repo

```markdown
# MxWatch

Email infrastructure monitoring dashboard for developers running self-hosted mail.

## Stack
- Next.js 15 + TypeScript (App Router)
- tRPC for type-safe API
- Drizzle ORM + SQLite (WAL mode)
- better-auth for authentication
- Tailwind CSS v4 + shadcn/ui
- BullMQ + Redis for background jobs

## Dev Setup
\`\`\`bash
npm install
cp .env.example .env
npm run db:push      # apply schema
npm run dev
\`\`\`

## Key Conventions
- All API routes go through tRPC routers in `apps/web/src/server/routers/`
- Database access only via Drizzle — no raw SQL
- All monitoring logic lives in `packages/monitor/` — keep it framework-agnostic
- Alert channels in `packages/alerts/` — each channel is a separate file
- Use `nanoid()` for all IDs
- Timestamps stored as Unix integers (mode: 'timestamp')
- Never store raw credentials — encrypt alert channel configs with `MXWATCH_SECRET`

## Database
\`\`\`bash
npm run db:push      # push schema changes
npm run db:studio    # open Drizzle Studio
npm run db:migrate   # run migrations
\`\`\`

## Background Jobs
SMTP listener starts on `SMTP_PORT` (default 2525).
DNS + blacklist checks scheduled via BullMQ workers.
For self-hosted without Redis: fall back to `node-cron` in-process scheduler.

## Environment Variables
- `DATABASE_URL` — path to SQLite file (default: `./mxwatch.db`)
- `MXWATCH_SECRET` — 32-char secret for encrypting stored credentials
- `SMTP_PORT` — port for DMARC report SMTP listener (default: 2525)
- `NEXT_PUBLIC_APP_URL` — public URL of the app
- `REDIS_URL` — optional, for BullMQ (falls back to in-process cron)

## Testing Blacklist Checks Locally
\`\`\`bash
# Test a known-listed IP (Spamhaus test IPs)
curl http://localhost:3000/api/test-blacklist?ip=127.0.0.2
\`\`\`
```

---

## 15. Claude Code Kickoff Prompt

Copy this verbatim into a Claude Code session in the mxwatch project root:

```
You are building MxWatch — an email infrastructure monitoring dashboard for developers who run self-hosted mail servers.

Read the full spec in mxwatch-spec.md before writing any code.

Start with the following tasks in order:

1. Initialise the monorepo with the structure defined in the spec:
   - apps/web (Next.js 15 + TypeScript)
   - packages/db (Drizzle schema)
   - packages/monitor (DNS + blacklist logic)
   - packages/alerts (alert channels)
   - packages/types (shared types)
   
2. Set up the database schema exactly as defined in the spec's schema section. Use Drizzle with better-sqlite3.

3. Implement the core monitoring logic:
   - packages/monitor/dns.ts — checkSpf, checkDkim, checkDmarc, calculateHealthScore
   - packages/monitor/blacklists.ts — BLACKLISTS constant + checkIpAgainstBlacklist
   - packages/monitor/dmarc-parser.ts — parseDmarcReport using fast-xml-parser

4. Set up tRPC routers for:
   - domains (CRUD)
   - checks (trigger + get results)
   - reports (DMARC report list + detail)
   - alerts (rules + history)

5. Build the UI pages in this order:
   - /login and /signup (better-auth)
   - /onboarding (2-step wizard: add domain + set alert email)
   - / dashboard (domain health cards, active alerts)
   - /domains/[id] (detail with tabs: Overview, DMARC, Blacklists, DNS)

6. Set up the SMTP listener in packages/monitor/smtp-listener.ts

7. Create docker-compose.yml for self-hosted deployment (single container)

Use shadcn/ui components throughout. All forms validated with Zod. Health scores use coloured indicators: <50 red, 50-79 amber, 80+ green.

Ask me before making architectural decisions not covered in the spec.
```

---

## 16. Launch Plan

**Week 1–2:** Build V1, dogfood on 6 domains  
**Week 3:** Fix issues found in dogfooding, write the launch blog post  
**Week 4:** Launch

**Launch blog post title:** "How I achieved 10/10 on mail-tester.com and cleared a Spamhaus PBL listing (and built a tool so you don't have to do it manually)"

**Launch channels:**
- r/selfhosted — "Show r/selfhosted: I built MxWatch, an open-source email infra dashboard because I got tired of checking Spamhaus manually"
- r/homelab
- Hacker News Show HN
- Stalwart Discord / community
- Mailcow community forums
- homelabza.com blog post

**First 30 days goal:** 500 self-hosted installs, 20 paying cloud subscribers ($180 MRR)
**3 month goal:** 50 cloud subscribers ($450 MRR), product paying for its own hosting
```
