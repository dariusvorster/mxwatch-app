# MxWatch — V3.5 Specification
**Version:** 3.5 | **Date:** April 2026 | **Author:** Darius
**Builds on:** V3 (auth, onboarding, dashboard, DNS checks, alerts, SMTP listener)
**Ships as:** Single release — gap fixes + all new features together

---

## Part 1 — Gap Fixes

### 1.1 Why tabs are grayed out

The most likely root causes in order of probability:

**Cause A — node-cron jobs not firing in production**
The instrumentation file that starts cron jobs is not being
executed in the Docker container's production build. Next.js
production mode only runs `instrumentation.ts` if it is
explicitly registered and the runtime is `nodejs`.

Fix:
```typescript
// apps/web/instrumentation.ts
export const runtime = 'nodejs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startMonitoringJobs } = await import('./src/jobs/scheduler')
    await startMonitoringJobs()
  }
}
```

**Cause B — DNS resolution failing inside Docker**
Container network resolvers may block or fail DNS lookups for
external domains. The RBL checks (DNS-based blacklist lookups)
will silently fail if the container can't resolve external DNS.

Fix in docker-compose.yml:
```yaml
services:
  mxwatch:
    dns:
      - 8.8.8.8
      - 1.1.1.1
```

**Cause C — tRPC queries returning empty but not erroring**
The UI shows grayed-out state when the query returns `[]` with
no error. Check that the jobs are actually inserting rows and
that the `domainId` foreign key matches correctly.

Fix: Add a `/api/debug/jobs` endpoint (dev only) that shows
last run time per job type per domain.

---

### 1.2 Blacklists tab — full implementation

**What needs wiring:**

```typescript
// packages/monitors/src/blacklists.ts

export const BLACKLISTS: Blacklist[] = [
  { name: 'Spamhaus ZEN',      host: 'zen.spamhaus.org',      type: 'ip' },
  { name: 'Barracuda',         host: 'b.barracudacentral.org', type: 'ip' },
  { name: 'SORBS',             host: 'dnsbl.sorbs.net',        type: 'ip' },
  { name: 'URIBL',             host: 'multi.uribl.com',        type: 'domain' },
  { name: 'SpamCop',           host: 'bl.spamcop.net',         type: 'ip' },
  { name: 'Spamrats',          host: 'all.spamrats.com',       type: 'ip' },
  { name: 'Mailspike',         host: 'bl.mailspike.net',       type: 'ip' },
  { name: 'SEM-BACKSCATTER',   host: 'bl.score.senderscore.com', type: 'ip' },
]

export async function checkRBL(
  ip: string,
  blacklist: Blacklist,
): Promise<RBLResult> {
  // Reverse the IP octets for DNS lookup
  // e.g. 23.95.170.217 → 217.170.95.23.zen.spamhaus.org
  const reversed = ip.split('.').reverse().join('.')
  const lookup = `${reversed}.${blacklist.host}`

  try {
    await dns.promises.resolve4(lookup)
    // If resolves → listed
    return { listed: true, rbl: blacklist.name, lookup }
  } catch (err: any) {
    if (err.code === 'ENOTFOUND') {
      // NXDOMAIN → not listed
      return { listed: false, rbl: blacklist.name, lookup }
    }
    // Network error → treat as unknown, don't mark as listed
    return { listed: false, rbl: blacklist.name, lookup, error: err.code }
  }
}

export async function checkAllRBLs(
  domainId: string,
  ip: string,
): Promise<void> {
  const results = await Promise.allSettled(
    BLACKLISTS.map(bl => checkRBL(ip, bl))
  )

  for (const result of results) {
    if (result.status === 'fulfilled') {
      await db.insert(rblChecks).values({
        id: nanoid(),
        domainId,
        rblName: result.value.rbl,
        listed: result.value.listed,
        checkedAt: new Date(),
      })
    }
  }
}
```

**tRPC router (blacklists):**
```typescript
blacklists: router({
  // Latest result per RBL for a domain
  latest: authedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ input }) => {
      // Return most recent check per RBL name
      // JOIN with domain to verify ownership
      return getLatestRBLResults(input.domainId)
    }),

  // Trigger immediate check
  runNow: authedProcedure
    .input(z.object({ domainId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const domain = await getDomainWithIp(input.domainId, ctx.user.id)
      await checkAllRBLs(domain.id, domain.resolvedIp)
      return { ok: true }
    }),

  // History for a specific RBL over time
  history: authedProcedure
    .input(z.object({
      domainId: z.string(),
      rblName: z.string(),
      days: z.number().default(30),
    }))
    .query(/* return listing events for this RBL */),
})
```

**Blacklists tab UI — matches redesign mockup:**
- 4×2 grid, one cell per RBL
- Green ✓ clean / Red ✗ listed
- Last checked timestamp per cell
- Red alert banner at bottom if any listed (with delist link)
- "Run checks now" button → `blacklists.runNow` mutation
- Spinner while running

---

### 1.3 SMTP health tab — full implementation

```typescript
// packages/monitors/src/smtp.ts

export async function checkSMTP(
  host: string,
  port: number = 587,
): Promise<SMTPCheckResult> {
  const start = Date.now()

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 10000 })
    let banner = ''
    let tlsVersion = ''
    let connected = false

    socket.on('connect', () => {
      connected = true
    })

    socket.on('data', async (data) => {
      const response = data.toString()
      if (response.startsWith('220')) {
        banner = response.split('\r\n')[0]
        // Initiate STARTTLS
        socket.write('EHLO mxwatch.app\r\n')
      }
      if (response.includes('STARTTLS')) {
        socket.write('STARTTLS\r\n')
      }
      if (response.startsWith('220 Go ahead')) {
        // Upgrade to TLS
        const tlsSocket = tls.connect({ socket, servername: host })
        tlsSocket.on('secureConnect', () => {
          tlsVersion = tlsSocket.getProtocol() ?? ''
          socket.destroy()
          resolve({
            connected: true,
            responseTimeMs: Date.now() - start,
            banner: banner.replace('220 ', ''),
            tlsVersion,
            tlsValid: tlsSocket.authorized,
            port,
            checkedAt: new Date(),
          })
        })
      }
    })

    socket.on('timeout', () => {
      socket.destroy()
      resolve({
        connected: false,
        responseTimeMs: Date.now() - start,
        error: 'timeout',
        port,
        checkedAt: new Date(),
      })
    })

    socket.on('error', (err) => {
      resolve({
        connected: false,
        responseTimeMs: Date.now() - start,
        error: err.message,
        port,
        checkedAt: new Date(),
      })
    })
  })
}
```

**SMTP tab UI:**
- Three metric cells: Response time / TLS version / Banner
- Port selector: 25 / 587 / 465 tabs
- Connection status badge
- Run check button
- 24h response time sparkline chart

---

### 1.4 Certificates tab — full implementation

```typescript
// packages/monitors/src/certificates.ts
import tls from 'tls'

export async function checkCertificate(
  hostname: string,
  port: number = 443,
): Promise<CertResult> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: hostname, port, servername: hostname },
      () => {
        const cert = socket.getPeerCertificate()
        const validTo = new Date(cert.valid_to)
        const daysUntilExpiry = Math.floor(
          (validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        )

        socket.destroy()
        resolve({
          hostname,
          issuer: cert.issuer?.O ?? 'Unknown',
          subject: cert.subject?.CN ?? hostname,
          validFrom: new Date(cert.valid_from),
          validTo,
          daysUntilExpiry,
          fingerprint: cert.fingerprint,
          authorized: socket.authorized,
        })
      }
    )
    socket.on('error', reject)
    socket.setTimeout(10000, () => {
      socket.destroy()
      reject(new Error('timeout'))
    })
  })
}
```

**What to check per domain:**
- `mail.{domain}` — mail server cert
- `{domain}` — web cert (if relevant)
- Cert from MX record hostname

**Certificates tab UI:**
- List of certs with expiry countdown
- Green > 30 days / Amber 7–30 days / Red < 7 days
- Issuer, fingerprint, valid dates
- Alert auto-fires when < 14 days remaining

---

### 1.5 History tab — full implementation

History is a unified activity feed across all check types for a domain.

```typescript
// tRPC router
history: authedProcedure
  .input(z.object({
    domainId: z.string(),
    limit: z.number().default(100),
    types: z.array(z.enum([
      'dns_check', 'rbl_check', 'smtp_check',
      'cert_check', 'dmarc_report', 'alert_fired',
    ])).optional(),
  }))
  .query(async ({ input }) => {
    // UNION query across all check tables
    // Returns unified timeline sorted by checkedAt DESC
    return getUnifiedHistory(input.domainId, input.limit, input.types)
  }),
```

**History tab UI:**
- Timeline feed — icon + description + timestamp
- Filter chips: DNS / RBL / SMTP / Certs / DMARC / Alerts
- Colour coding: green=pass, red=fail/listed, amber=warning
- Infinite scroll or "load more"
- Export as CSV button

---

### 1.6 DMARC reports tab — full implementation

The tab exists but data is thin. Flesh out the detail view.

**Report list:**
- Org name, date range, total messages, pass/fail counts
- Pass rate as percentage with colour bar
- Click to expand full report detail

**Report detail:**
- Source IPs that sent email on your behalf
- Per-source: SPF result, DKIM result, DMARC disposition
- Volume per source
- Flag: unexpected senders (IPs not in your SPF record)

```typescript
// tRPC router addition
reports: router({
  list: authedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(/* list reports with pass/fail counts */),

  detail: authedProcedure
    .input(z.object({ reportId: z.string() }))
    .query(/* full parsed report with per-source breakdown */),

  // New: summary stats for charts
  stats: authedProcedure
    .input(z.object({
      domainId: z.string(),
      days: z.number().default(30),
    }))
    .query(/* daily pass/fail counts for chart */),

  // New: flag unexpected senders
  unexpectedSenders: authedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(/* IPs sending as this domain not in SPF */),
})
```

---

### 1.7 Activity feed (dashboard)

Global activity across all domains — not per-domain.

```typescript
activity: authedProcedure
  .input(z.object({ limit: z.number().default(50) }))
  .query(async ({ ctx }) => {
    // All events across all user's domains
    // Most recent first
    // Types: rbl_listed, rbl_delisted, dns_changed,
    //        cert_expiring, dmarc_fail_spike, smtp_down
    return getGlobalActivity(ctx.user.id, input.limit)
  }),
```

**Activity tab UI (sidebar nav item):**
- Unified feed across all domains
- Domain tag on each event
- Severity icon: red/amber/green
- Timestamp

---

## Part 2 — New Features (V3.5)

---

### 2.1 IP Reputation History

**What it is:** Longitudinal chart of your IP's RBL status over time.
MxWatch already checks RBLs every 2 hours and stores results.
Surface that history as a chart.

**DB additions:**
```typescript
// Already stored in rblChecks table
// Add: ipReputationSnapshots for point-in-time aggregate score

export const ipReputationSnapshots = sqliteTable('ip_reputation_snapshots', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').references(() => domains.id),
  ip: text('ip').notNull(),
  totalRbls: integer('total_rbls').notNull(),
  listedCount: integer('listed_count').notNull(),
  reputationScore: integer('reputation_score').notNull(), // 0-100
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull(),
})

// Reputation score formula:
// 100 - (listedCount * 12) — capped at 0
// e.g. listed on 2 RBLs = 76/100
```

**tRPC router:**
```typescript
ipReputation: router({
  history: authedProcedure
    .input(z.object({
      domainId: z.string(),
      days: z.number().default(90),
    }))
    .query(/* time-series data for chart */),

  incidents: authedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(/* listing/delisting events with duration */),

  currentScore: authedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(/* latest snapshot */),
})
```

**UI — IP Reputation tab on domain detail:**
- Line chart: 90-day reputation score (Recharts)
- Incident markers on chart where score dropped
- Incident list: "Listed on Spamhaus ZEN for 4 days (resolved)"
- Current score with coloured ring (same as health score)
- "How to improve" tips panel if score < 80

---

### 2.2 DNS Propagation Checker

**What it is:** After a DNS change is detected, show how it's
spreading across global resolvers in real-time.

**How it works:** Query the same DNS record from multiple
public resolvers in different regions. Show which resolvers
have the new value and which still have the old one.

```typescript
// packages/monitors/src/propagation.ts

export const RESOLVERS: Resolver[] = [
  { name: 'Cloudflare',      ip: '1.1.1.1',        region: 'Global' },
  { name: 'Google',          ip: '8.8.8.8',         region: 'Global' },
  { name: 'OpenDNS',         ip: '208.67.222.222',  region: 'US' },
  { name: 'Quad9',           ip: '9.9.9.9',         region: 'Global' },
  { name: 'NextDNS',         ip: '45.90.28.0',      region: 'Global' },
  { name: 'Comodo',          ip: '8.26.56.26',      region: 'US' },
  { name: 'Verisign',        ip: '64.6.64.6',       region: 'US' },
  { name: 'Hurricane Electric', ip: '74.82.42.42',  region: 'US' },
  { name: 'Level3',          ip: '209.244.0.3',     region: 'US' },
  { name: 'DNS.Watch',       ip: '84.200.69.80',    region: 'EU' },
  { name: 'Freenom',         ip: '80.80.80.80',     region: 'EU' },
  { name: 'Yandex',          ip: '77.88.8.8',       region: 'RU' },
  { name: 'Neustar',         ip: '156.154.70.1',    region: 'US' },
  { name: 'SafeDNS',         ip: '195.46.39.39',    region: 'EU' },
  { name: 'CleanBrowsing',   ip: '185.228.168.168', region: 'EU' },
  { name: 'AdGuard',         ip: '94.140.14.14',    region: 'EU' },
  { name: 'AliDNS',          ip: '223.5.5.5',       region: 'APAC' },
  { name: 'CNNIC',           ip: '1.2.4.8',         region: 'APAC' },
  { name: 'Telstra',         ip: '139.130.4.4',     region: 'APAC' },
  { name: 'Dyn',             ip: '216.146.35.35',   region: 'US' },
]

export async function checkPropagation(
  domain: string,
  recordType: 'TXT' | 'MX' | 'A',
  expectedValue: string,
): Promise<PropagationResult[]> {
  const results = await Promise.allSettled(
    RESOLVERS.map(async (resolver) => {
      const result = await dnsLookupViaResolver(
        domain, recordType, resolver.ip
      )
      return {
        resolver: resolver.name,
        region: resolver.region,
        ip: resolver.ip,
        value: result.value,
        propagated: result.value?.includes(expectedValue) ?? false,
        responseMs: result.responseMs,
      }
    })
  )
  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => (r as PromiseFulfilledResult<PropagationResult>).value)
}
```

**When it triggers automatically:**
- MxWatch detects a DNS record changed (comparing to previous check)
- Auto-runs propagation check for that record type
- Sends alert: "SPF record change detected — propagation 14/20 resolvers"

**tRPC router:**
```typescript
propagation: router({
  check: authedProcedure
    .input(z.object({
      domainId: z.string(),
      recordType: z.enum(['TXT', 'MX', 'A', 'AAAA']),
    }))
    .mutation(/* run propagation check now, return results */),

  latest: authedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(/* most recent propagation check results */),

  history: authedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(/* past propagation checks */),
})
```

**UI — Propagation page:**
- Trigger: "Check propagation" button on DNS tab
- Results: Grid of resolver cards — green=propagated, amber=stale, red=wrong value
- Grouped by region (Global / US / EU / APAC / RU)
- Progress bar: "14 / 20 resolvers updated"
- Auto-refresh every 60s while propagation is in progress
- "Last checked: DNS changed 2h ago, 20/20 propagated" when complete

---

### 2.3 SPF / DMARC Record Builder

**What it is:** A visual wizard that generates correct SPF and
DMARC records based on your setup. Pre-populated with what
MxWatch already knows about your domain.

**SPF Builder:**
```typescript
// packages/monitors/src/spf-builder.ts

export interface SPFComponent {
  type: 'ip4' | 'ip6' | 'include' | 'a' | 'mx' | 'exists'
  value: string
  description: string  // human-readable explanation
}

export const COMMON_INCLUDES: SPFInclude[] = [
  { value: '_spf.google.com',         description: 'Google Workspace' },
  { value: 'spf.protection.outlook.com', description: 'Microsoft 365' },
  { value: 'spf.mailgun.org',         description: 'Mailgun' },
  { value: 'spf.sendgrid.net',        description: 'SendGrid' },
  { value: 'amazonses.com',           description: 'Amazon SES' },
  { value: '_spf.mx.cloudflare.net',  description: 'Cloudflare Email' },
  { value: 'spf.resend.com',          description: 'Resend' },
  { value: 'mail.zendesk.com',        description: 'Zendesk' },
]

export function buildSPFRecord(components: SPFComponent[], policy: '~all' | '-all' | '?all'): string {
  const parts = ['v=spf1']
  for (const c of components) {
    if (c.type === 'ip4') parts.push(`ip4:${c.value}`)
    else if (c.type === 'ip6') parts.push(`ip6:${c.value}`)
    else if (c.type === 'include') parts.push(`include:${c.value}`)
    else if (c.type === 'mx') parts.push('mx')
    else if (c.type === 'a') parts.push('a')
  }
  parts.push(policy)
  return parts.join(' ')
}

// Warning: SPF has a 10 DNS lookup limit
export function countSPFLookups(components: SPFComponent[]): number {
  return components.filter(c =>
    ['include', 'a', 'mx', 'exists'].includes(c.type)
  ).length
}
```

**DMARC Builder:**
```typescript
export interface DMARCConfig {
  policy: 'none' | 'quarantine' | 'reject'
  subdomainPolicy?: 'none' | 'quarantine' | 'reject'
  percentage: number       // pct= tag, 1-100
  ruaEmail: string         // aggregate report destination
  rufEmail?: string        // forensic report destination
  alignmentSpf: 'r' | 's' // relaxed or strict
  alignmentDkim: 'r' | 's'
  reportInterval: number   // ri= tag, seconds
}

export function buildDMARCRecord(config: DMARCConfig): string {
  const parts = [`v=DMARC1`, `p=${config.policy}`]
  if (config.subdomainPolicy) parts.push(`sp=${config.subdomainPolicy}`)
  if (config.percentage < 100) parts.push(`pct=${config.percentage}`)
  parts.push(`rua=mailto:${config.ruaEmail}`)
  if (config.rufEmail) parts.push(`ruf=mailto:${config.rufEmail}`)
  if (config.alignmentSpf === 's') parts.push('aspf=s')
  if (config.alignmentDkim === 's') parts.push('adkim=s')
  if (config.reportInterval !== 86400) parts.push(`ri=${config.reportInterval}`)
  return parts.join('; ')
}
```

**UI — Record Builder page (new nav item under Tools):**

SPF Builder:
- Pre-populated: your mail server IP already added from DNS check
- Checkbox list: common providers (Google, Microsoft, Sendgrid, Resend...)
- Manual IP/include input
- Live preview: generated record updates as you click
- DNS lookup counter with warning if approaching 10
- Policy selector: ~all (softfail) / -all (hardfail) / ?all (neutral)
- "Copy record" button + "How to add this to Cloudflare" guide link
- Diff view if current SPF record exists: shows what changed

DMARC Builder:
- Policy selector with explanation (none/quarantine/reject)
- RUA email: pre-filled with `dmarc@mxwatch.app` (your MxWatch instance)
- Percentage slider (useful for gradual rollout)
- Alignment toggles
- Live preview
- Migration path: "Start with p=none, move to reject in 3 steps"

---

### 2.4 Deliverability Testing

**What it is:** Send a test email from your domain and get a
score. Like mail-tester.com but built into MxWatch with
history, comparison, and two sending modes.

**How it works:**
1. MxWatch generates a unique test address:
   `test-{uuid}@inbox.mxwatch.app` (cloud) or user configures their own
2. User sends a test email to that address
3. MxWatch receives the email via SMTP listener
4. Analyzes: SPF, DKIM, DMARC authentication results from headers,
   spam score, HTML/text ratio, links, blacklist status of sending IP,
   reverse DNS match, HELO/EHLO correctness
5. Returns a score 0–10 with per-item breakdown

**Two sending modes:**

Mode A — Send from your mail server (recommended):
- User sends manually from their mail client or via
  `sendmail` / Stalwart CLI to the test address
- Tests actual deliverability path

Mode B — Send via Resend:
- MxWatch sends a test email via Resend's API
- Tests if Resend + your domain config is correct
- Useful for transactional email setups

```typescript
// DB schema additions
export const deliverabilityTests = sqliteTable('deliverability_tests', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').references(() => domains.id),
  testAddress: text('test_address').notNull(),   // unique inbox address
  sendingMode: text('sending_mode').notNull(),    // 'manual' | 'resend'
  status: text('status').default('pending'),      // 'pending' | 'received' | 'analyzed'
  score: integer('score'),                        // 0-10
  results: text('results'),                       // JSON — per-check breakdown
  rawHeaders: text('raw_headers'),
  receivedAt: integer('received_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

// Score factors (matches mail-tester.com methodology)
export interface DeliverabilityResult {
  score: number           // 0.0 - 10.0
  spfPass: boolean        // +1.0
  dkimPass: boolean       // +1.5
  dmarcPass: boolean      // +1.0
  reverseDnsMatch: boolean // +1.0
  noRblListing: boolean   // +2.0
  heloValid: boolean      // +0.5
  htmlTextRatio: boolean  // +0.5
  noSuspiciousLinks: boolean // +1.0
  subjectNotSpammy: boolean  // +0.5
  bodyNotSpammy: boolean  // +1.0
  details: Record<string, {
    pass: boolean
    score: number
    message: string
    fix?: string
  }>
}
```

**tRPC router:**
```typescript
deliverability: router({
  // Create a test — returns the inbox address to send to
  createTest: authedProcedure
    .input(z.object({
      domainId: z.string(),
      mode: z.enum(['manual', 'resend']),
    }))
    .mutation(/* generate test address, return it */),

  // Poll for result (frontend polls every 5s)
  getResult: authedProcedure
    .input(z.object({ testId: z.string() }))
    .query(/* return test status + score if received */),

  // History of all tests for a domain
  history: authedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(/* list past tests with scores */),
})
```

**UI — Deliverability Test page (Tools section):**

Step 1 — Setup:
- Mode selector: "Test from my server" / "Test via Resend"
- If Resend: from address input + Resend API key (if not set)
- "Generate test inbox" button

Step 2 — Send:
- Shows test address: `test-abc123@inbox.mxwatch.app`
- "Copy address" button
- Instructions: "Send any email from {domain} to this address"
- Waiting spinner (polling every 5s)
- Timeout: 10 minutes

Step 3 — Results:
- Score: large X/10 number with ring indicator
- Per-check breakdown: ✓ SPF pass (+1.0) / ✗ No reverse DNS (-1.0)
- Fix suggestions for failed checks
- "Run again" button
- Score history chart (if previous tests exist)

---

### 2.5 Stalwart Integration

**What it is:** Native integration with Stalwart Mail Server.
Pull model for stats, push model for delivery failure alerts.

**Setup:** User provides Stalwart API URL + API token.
MxWatch stores encrypted in `integrations` table.

**Pull model — every 60s:**
```typescript
// packages/monitors/src/stalwart.ts

export class StalwartClient {
  constructor(
    private baseUrl: string,  // e.g. https://mail.homelabza.com
    private apiToken: string,
  ) {}

  // GET /api/queue/messages
  async getQueueDepth(): Promise<QueueStats> {
    const res = await fetch(`${this.baseUrl}/api/queue/messages`, {
      headers: { Authorization: `Bearer ${this.apiToken}` }
    })
    return res.json()
  }

  // GET /api/reports/smtp
  async getSMTPReport(period: '1h' | '24h' | '7d'): Promise<SMTPReport> {
    return this.get(`/api/reports/smtp?period=${period}`)
  }

  // GET /api/reports/dmarc
  async getDMARCReport(): Promise<DMARCStats>

  // GET /api/queue/messages?status=failed
  async getFailedMessages(): Promise<FailedMessage[]>

  // GET /api/server/info
  async getServerInfo(): Promise<StalwartServerInfo>
}

// What we pull and store:
export interface StalwartSnapshot {
  id: string
  integrationId: string
  queueDepth: number
  queueFailed: number
  messagesDelivered24h: number
  messagesBounced24h: number
  messagesRejected24h: number
  connectionsAccepted1h: number
  connectionsRejected1h: number
  tlsPercentage: number
  recordedAt: Date
}
```

**Push model — Stalwart webhooks:**
```typescript
// apps/web/app/api/webhooks/stalwart/route.ts

// Stalwart sends: delivery_failed, message_rejected, queue_full events
export async function POST(req: Request) {
  const body = await req.json()

  switch (body.type) {
    case 'delivery_failed':
      await handleDeliveryFailure(body)
      // Create alert if configured
      // Store in stalwartEvents table
      break

    case 'message_rejected':
      await handleRejection(body)
      break

    case 'auth_failure':
      await handleAuthFailure(body)
      // Alert: someone is trying to brute-force your mail server
      break
  }
}
```

**DB schema:**
```typescript
export const stalwartIntegrations = sqliteTable('stalwart_integrations', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  encryptedToken: text('encrypted_token').notNull(),
  webhookSecret: text('webhook_secret'),
  pullEnabled: integer('pull_enabled', { mode: 'boolean' }).default(true),
  pushEnabled: integer('push_enabled', { mode: 'boolean' }).default(false),
  lastPulledAt: integer('last_pulled_at', { mode: 'timestamp' }),
  status: text('status').default('unknown'), // 'ok' | 'error' | 'unknown'
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const stalwartSnapshots = sqliteTable('stalwart_snapshots', {
  id: text('id').primaryKey(),
  integrationId: text('integration_id').references(() => stalwartIntegrations.id),
  queueDepth: integer('queue_depth'),
  queueFailed: integer('queue_failed'),
  delivered24h: integer('delivered_24h'),
  bounced24h: integer('bounced_24h'),
  rejected24h: integer('rejected_24h'),
  tlsPercent: integer('tls_percent'),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull(),
})

export const stalwartEvents = sqliteTable('stalwart_events', {
  id: text('id').primaryKey(),
  integrationId: text('integration_id').references(() => stalwartIntegrations.id),
  type: text('type').notNull(),
  // 'delivery_failed' | 'message_rejected' | 'auth_failure' | 'queue_full'
  detail: text('detail'),  // JSON
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
})
```

**tRPC router:**
```typescript
stalwart: router({
  // Integration management
  list: authedProcedure.query(/* all integrations */),
  create: authedProcedure.input(StalwartSchema).mutation(/* add integration */),
  test: authedProcedure.input(z.object({ id: z.string() })).mutation(/* ping API */),
  delete: authedProcedure.input(z.object({ id: z.string() })).mutation(/* */),

  // Stats
  current: authedProcedure
    .input(z.object({ integrationId: z.string() }))
    .query(/* latest snapshot */),

  history: authedProcedure
    .input(z.object({
      integrationId: z.string(),
      hours: z.number().default(24),
    }))
    .query(/* time-series for charts */),

  // Events
  events: authedProcedure
    .input(z.object({
      integrationId: z.string(),
      limit: z.number().default(50),
    }))
    .query(/* recent delivery failures etc */),

  // Webhook registration helper
  webhookConfig: authedProcedure
    .input(z.object({ integrationId: z.string() }))
    .query(/* returns webhook URL + secret + Stalwart config snippet */),
})
```

**UI — Stalwart page (new nav section: Integrations):**

Overview card:
- Queue depth gauge (0 = green, growing = amber, stuck = red)
- 24h delivery stats: X delivered / Y bounced / Z rejected
- TLS adoption percentage
- Server version + uptime

Charts (24h):
- Delivery success rate line chart
- Queue depth over time
- Connections accepted vs rejected

Events feed:
- Recent delivery failures with recipient domain + error code
- Auth failure attempts (possible brute force)
- "Configure webhook alerts" CTA if push not enabled

Setup flow:
- Enter Stalwart URL + API token
- Test connection button
- Optional: webhook config (shows Stalwart config snippet to paste)

---

### 2.6 Competitor / External Domain Monitoring

**What it is:** Monitor any domain's mail reputation without
owning it. No DNS verification required. Read-only — checks
only publicly available data (RBLs, DNS records, DMARC policy).

**Use cases:**
- Agency watching clients' competitor domains
- SaaS checking if transactional email providers are on blacklists
- Hobbyist watching domains they receive email from

**DB schema:**
```typescript
export const watchedDomains = sqliteTable('watched_domains', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  domain: text('domain').notNull(),
  label: text('label'),          // custom name e.g. "Competitor A"
  notes: text('notes'),
  alertOnRblListing: integer('alert_on_rbl_listing', { mode: 'boolean' }).default(true),
  alertOnDmarcChange: integer('alert_on_dmarc_change', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})
// Shares rblChecks and dnsChecks tables with owned domains
// Distinguished by: no userId on domain, linked via watchedDomains
```

**What gets checked:**
- RBL status (all 8 blacklists) — every 2 hours
- DMARC policy (is it p=none? p=reject?) — every 6 hours
- MX record validity — every 6 hours
- No SMTP check (don't connect to servers you don't own)
- No deliverability test (can't receive on their behalf)

**tRPC router:**
```typescript
watched: router({
  list: authedProcedure.query(/* all watched domains with latest status */),
  add: authedProcedure.input(z.object({
    domain: z.string(),
    label: z.string().optional(),
    alertOnRblListing: z.boolean().default(true),
  })).mutation(/* add watched domain, trigger first check */),
  remove: authedProcedure.input(z.object({ id: z.string() })).mutation(/* */),
  status: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(/* latest check results for this domain */),
})
```

**UI — Watched Domains page (new nav item):**
- Table: domain / label / DMARC policy / RBL status / last checked
- "Add domain" modal — no verification needed, just enter domain
- Click row → mini detail panel: DMARC record, MX record, RBL grid
- Alert badge if any watched domain is newly listed

---

## Part 3 — Updated Job Scheduler

```typescript
// apps/web/src/jobs/scheduler.ts

export async function startMonitoringJobs() {
  // Existing jobs
  cron.schedule('0 */6 * * *', () => runDNSChecksAllDomains())
  cron.schedule('0 */2 * * *', () => runRBLChecksAllDomains())
  cron.schedule('*/30 * * * *', () => runSMTPChecksAllDomains())
  cron.schedule('0 0 * * *',   () => runCertChecksAllDomains())

  // New jobs
  cron.schedule('*/60 * * * * *', () => pullStalwartStats())   // every 60s
  cron.schedule('0 */2 * * *',    () => runRBLChecksWatched()) // watched domains
  cron.schedule('0 */6 * * *',    () => runDNSChecksWatched()) // watched domains
  cron.schedule('0 */2 * * *',    () => snapshotIPReputation()) // save reputation snapshots

  console.log('[MxWatch] Monitoring jobs started')
}
```

---

## Part 4 — New Navigation Structure

```
Sidebar:
├── Overview
│   ├── Dashboard        ← existing
│   └── Activity         ← fix grayed out
│
├── Monitoring
│   ├── Domains          ← existing (all owned domains)
│   ├── Blacklists       ← fix grayed out (global RBL view)
│   ├── DMARC reports    ← fix grayed out
│   └── Certificates     ← fix grayed out
│
├── Tools                ← NEW SECTION
│   ├── Deliverability test  ← new
│   ├── Record builder       ← new
│   └── Propagation check    ← new
│
├── Integrations         ← NEW SECTION
│   └── Stalwart             ← new
│
└── Watched domains      ← new
```

---

## Part 5 — New DB Migration

```typescript
// New tables to add via Drizzle migration
// 1. ipReputationSnapshots
// 2. deliverabilityTests
// 3. stalwartIntegrations
// 4. stalwartSnapshots
// 5. stalwartEvents
// 6. watchedDomains

// Run: pnpm db:migrate
```

---

## Part 6 — New Environment Variables

```env
# Stalwart integration (optional — only needed if user adds Stalwart)
# Stored per-integration in DB, not global env vars

# Deliverability test inbox (for receiving test emails)
# Cloud: mxwatch.app SMTP listener already handles this
# Self-hosted: user's own SMTP listener on port 2525
DELIVERABILITY_TEST_DOMAIN=inbox.mxwatch.app

# Resend (for Mode B deliverability tests)
# Already set: RESEND_API_KEY
```

---

## Part 7 — Claude Code Prompt (V3.5)

```
You are adding V3.5 features to MxWatch. The app is at V3 with
auth, onboarding, dashboard, DNS checks, alerts, and SMTP listener
all working. Read mxwatch-spec-v3.5.md completely before writing code.

FIRST: Fix the grayed-out tabs. Most likely cause is node-cron jobs
not starting in production. Check instrumentation.ts — ensure it has:
  export const runtime = 'nodejs'
  Only runs startMonitoringJobs() when NEXT_RUNTIME === 'nodejs'

Also add to docker-compose.yml:
  dns: [8.8.8.8, 1.1.1.1]

Then wire each grayed-out tab in this order:

STEP 1 — Blacklists tab
  Wire checkAllRBLs() from packages/monitors/src/blacklists.ts
  Wire tRPC blacklists router (latest, runNow, history)
  Build the 4×2 RBL grid UI matching the redesign mockup
  Add "Run checks now" button with loading state

STEP 2 — SMTP health tab
  Implement checkSMTP() in packages/monitors/src/smtp.ts
  Wire tRPC smtp router
  Build 3-column metric UI (response time / TLS / banner)
  Add port tabs (25 / 587 / 465)

STEP 3 — Certificates tab
  Implement checkCertificate() in packages/monitors/src/certificates.ts
  Wire tRPC certs router
  Build cert list with expiry countdown badges

STEP 4 — History tab
  Build unified history query (UNION across check tables)
  Build timeline feed UI with filter chips

STEP 5 — DMARC reports tab
  Flesh out report detail view (per-source breakdown)
  Add unexpected senders detection
  Add pass rate chart (Recharts line chart)

STEP 6 — Activity feed
  Build global activity query
  Wire the Activity nav item

Then build the new features in this order:

STEP 7 — IP Reputation History
  Add ipReputationSnapshots table (Drizzle migration)
  Snapshot job runs every 2h alongside RBL checks
  Build reputation history chart (Recharts)
  Build incident list

STEP 8 — DNS Propagation Checker
  Implement checkPropagation() with 20 resolvers
  Wire tRPC propagation router
  Build resolver grid UI (grouped by region)
  Auto-trigger when DNS change detected

STEP 9 — Record Builder
  Implement buildSPFRecord() and buildDMARCRecord()
  Build SPF wizard UI (checkboxes + live preview)
  Build DMARC wizard UI (policy selector + live preview)
  Add DNS lookup counter warning for SPF

STEP 10 — Deliverability Testing
  Add deliverabilityTests table
  Build test flow: create → wait → results
  Build score breakdown UI (per-check with fix suggestions)
  Wire both modes (manual send + Resend)

STEP 11 — Stalwart Integration
  Add stalwartIntegrations, stalwartSnapshots, stalwartEvents tables
  Implement StalwartClient (pull model)
  Add webhook endpoint for push events
  Build Stalwart dashboard page
  Build setup flow

STEP 12 — Watched Domains
  Add watchedDomains table
  Wire RBL + DNS checks for watched domains
  Build watched domains table UI
  Add "Add domain" modal (no verification)

STEP 13 — Update navigation
  Add Tools section (Deliverability, Record Builder, Propagation)
  Add Integrations section (Stalwart)
  Add Watched Domains nav item
  Fix grayed-out items to show live badge counts

After each step: tsc --noEmit, fix all errors before proceeding.
Confirm with me before adding any new dependency not already in package.json.
```
