# MxWatch — V4 Specification
**Version:** 4.0 | **Date:** April 2026 | **Author:** Darius
**Builds on:** V3.5 (gap fixes, IP reputation, propagation checker,
record builder, deliverability testing, Stalwart pull+push)
**Tagline:** Point it at your mail server. It figures out the rest.

---

## What V4 Is

V4 transforms MxWatch from an outside-in monitoring tool into a
full mail server intelligence platform. Instead of only watching
from the internet (DNS lookups, RBL checks, test emails), MxWatch
reaches inside your mail server and understands what's happening:
queue depth, delivery failures, bounce reasons, auth attacks,
per-recipient-domain delivery rates.

**The V4 pitch:** "Add your mail server hostname. MxWatch detects
what you're running, connects to it, and starts showing you things
your mail logs have always known but you've never had a dashboard for."

---

## Part 1 — Auto-Detection Engine

### 1.1 Server fingerprinting

When a user adds a mail server (hostname or IP), MxWatch probes it
to identify what's running before asking for any credentials.

```typescript
// packages/monitors/src/server-detect.ts

export interface ServerFingerprint {
  detectedType: MailServerType | null
  confidence: 'high' | 'medium' | 'low'
  openPorts: number[]
  smtpBanner: string | null
  smtpCapabilities: string[]
  tlsVersion: string | null
  apiDetected: boolean
  apiEndpoint: string | null
  suggestedArchitecture: NetworkArchitecture
  evidence: string[]  // human-readable list of what was found
}

export type MailServerType =
  | 'stalwart'
  | 'mailcow'
  | 'postfix'
  | 'postfix_dovecot'  // iRedMail / typical combo
  | 'mailu'
  | 'maddy'
  | 'haraka'
  | 'exchange'
  | 'unknown'

export async function detectMailServer(
  host: string,
  internalHost?: string,  // if behind NAT, probe internal separately
): Promise<ServerFingerprint> {

  const evidence: string[] = []
  const openPorts: number[] = []

  // Step 1 — Port scan (non-intrusive, just connect + close)
  const portsToCheck = [25, 587, 465, 993, 995, 80, 443, 8080, 8443]
  for (const port of portsToCheck) {
    const open = await isPortOpen(host, port)
    if (open) openPorts.push(port)
  }

  // Step 2 — SMTP banner grab
  let smtpBanner: string | null = null
  let smtpCapabilities: string[] = []
  if (openPorts.includes(587) || openPorts.includes(25)) {
    const port = openPorts.includes(587) ? 587 : 25
    const smtp = await grabSMTPBanner(host, port)
    smtpBanner = smtp.banner
    smtpCapabilities = smtp.capabilities
    if (smtpBanner) evidence.push(`SMTP banner: ${smtpBanner}`)
  }

  // Step 3 — Identify from banner
  let detectedType: MailServerType | null = null
  if (smtpBanner) {
    if (smtpBanner.includes('Stalwart')) {
      detectedType = 'stalwart'
      evidence.push('Identified Stalwart from SMTP banner')
    } else if (smtpBanner.includes('Postfix')) {
      detectedType = 'postfix'
      evidence.push('Identified Postfix from SMTP banner')
    } else if (smtpBanner.includes('Haraka')) {
      detectedType = 'haraka'
    } else if (smtpBanner.includes('Maddy')) {
      detectedType = 'maddy'
    } else if (smtpBanner.includes('Microsoft')) {
      detectedType = 'exchange'
    }
  }

  // Step 4 — API probe (try known management API endpoints)
  let apiDetected = false
  let apiEndpoint: string | null = null

  const apiProbes: { type: MailServerType; paths: string[]; port: number }[] = [
    {
      type: 'stalwart',
      paths: ['/api/server/info'],
      port: 443,
    },
    {
      type: 'mailcow',
      paths: ['/api/v1/get/status/containers'],
      port: 443,
    },
    {
      type: 'mailu',
      paths: ['/api/v1/domain'],
      port: 443,
    },
  ]

  for (const probe of apiProbes) {
    if (!detectedType || detectedType === probe.type) {
      for (const path of probe.paths) {
        const url = `https://${host}${path}`
        const reachable = await probeHTTP(url)
        if (reachable) {
          apiDetected = true
          apiEndpoint = `https://${host}`
          detectedType = probe.type
          evidence.push(`API endpoint found at ${url}`)
          break
        }
      }
    }
  }

  // Step 5 — Postfix refinement
  // Mailcow and iRedMail both use Postfix under the hood
  // Distinguish by checking for Mailcow API or Roundcube
  if (detectedType === 'postfix') {
    const mailcowApi = await probeHTTP(`https://${host}/api/v1/get/status/containers`)
    if (mailcowApi) {
      detectedType = 'mailcow'
      evidence.push('Mailcow API detected over Postfix banner')
    }
  }

  // Step 6 — Architecture inference
  // If the probed host is a private IP, suggest nat_relay
  const isPrivate = isPrivateIP(host)
  const suggestedArchitecture: NetworkArchitecture = isPrivate
    ? 'nat_relay'
    : 'direct'

  const confidence =
    detectedType && apiDetected ? 'high' :
    detectedType ? 'medium' : 'low'

  return {
    detectedType,
    confidence,
    openPorts,
    smtpBanner,
    smtpCapabilities,
    tlsVersion: null, // filled in by TLS probe
    apiDetected,
    apiEndpoint,
    suggestedArchitecture,
    evidence,
  }
}
```

### 1.2 Auto-detect setup flow UI

```
Step 1 — Enter your mail server

  Mail server host or IP:  [mail.homelabza.com      ] [Detect →]

  Running detection...
  ✓ Port 587 open
  ✓ Port 443 open
  ✓ SMTP banner: "220 mail.homelabza.com Stalwart ESMTP"
  ✓ Stalwart API found at https://mail.homelabza.com/api
  
  Detected: Stalwart Mail Server (high confidence)
  
  [Looks right →]   [Override detection ↓]

  -- if override --
  What mail server are you running?
  ○ Stalwart  ● Mailcow  ○ Postfix  ○ Mailu  ○ Maddy  ○ Other

Step 2 — Connection details (pre-filled from detection)

  Architecture:    ● Direct  ○ NAT relay  ○ Split  ○ Managed
  
  -- if NAT relay selected --
  Relay/VPS IP:    [23.95.170.217                   ]
  Internal server: [192.168.69.12                   ]
  
  SMTP check via:  ● Relay (23.95.170.217)
                   ○ Internal (192.168.69.12)

Step 3 — API credentials (for deep integration)

  Stalwart API token:  [••••••••••••••••••••         ]
  
  How to get this:
  1. Log into Stalwart admin at https://mail.homelabza.com/admin
  2. Go to Management → API Tokens
  3. Create token with "read" permissions
  4. Paste here
  
  [Test connection]  → ✓ Connected · Stalwart 0.7.2 · 3 domains
  
  [Skip for now — monitor from outside only]
```

---

## Part 2 — Mail Server Adapters

Each adapter implements a common interface. V4 ships all four.

```typescript
// packages/monitors/src/adapters/types.ts

export interface MailServerAdapter {
  readonly type: MailServerType
  readonly displayName: string

  // Test if the connection works
  test(config: AdapterConfig): Promise<AdapterTestResult>

  // Pull current stats snapshot
  getStats(config: AdapterConfig): Promise<ServerStats>

  // Pull queue state
  getQueue(config: AdapterConfig): Promise<QueueStats>

  // Pull recent delivery events
  getDeliveryEvents(
    config: AdapterConfig,
    since: Date,
    limit: number,
  ): Promise<DeliveryEvent[]>

  // Pull auth failure events
  getAuthFailures(
    config: AdapterConfig,
    since: Date,
  ): Promise<AuthFailureEvent[]>

  // Pull per-recipient-domain stats
  getRecipientDomainStats(
    config: AdapterConfig,
    since: Date,
  ): Promise<RecipientDomainStat[]>
}

export interface ServerStats {
  queueDepth: number
  queueFailed: number
  delivered24h: number
  bounced24h: number
  rejected24h: number
  deferred24h: number
  tlsPercent: number
  serverVersion: string
  uptime?: number
}

export interface QueueStats {
  total: number
  active: number           // currently being delivered
  deferred: number         // will retry later
  failed: number           // permanently failed
  oldestMessageAge: number // seconds — alert if > 3600
  messages: QueueMessage[]
}

export interface QueueMessage {
  id: string
  from: string
  to: string[]
  size: number
  attempts: number
  lastAttempt: Date
  nextAttempt: Date
  lastError: string | null
  age: number  // seconds in queue
}

export interface DeliveryEvent {
  id: string
  timestamp: Date
  type: 'delivered' | 'bounced' | 'deferred' | 'rejected'
  from: string
  to: string
  recipientDomain: string  // extracted from `to`
  size: number
  delay: number    // milliseconds
  tlsUsed: boolean
  errorCode?: string
  errorMessage?: string
  bounceType?: 'hard' | 'soft' | 'policy'
}

export interface AuthFailureEvent {
  timestamp: Date
  ip: string
  username?: string
  mechanism: string    // 'PLAIN' | 'LOGIN' | 'CRAM-MD5'
  failCount: number
}

export interface RecipientDomainStat {
  domain: string           // 'gmail.com', 'outlook.com'
  sent: number
  delivered: number
  bounced: number
  deferred: number
  deliveryRate: number     // 0-100
  avgDelayMs: number
  lastBounceReason?: string
}
```

---

### 2.1 Stalwart adapter

```typescript
// packages/monitors/src/adapters/stalwart.ts

export class StalwartAdapter implements MailServerAdapter {
  readonly type = 'stalwart'
  readonly displayName = 'Stalwart Mail Server'

  private async get(config: AdapterConfig, path: string) {
    const res = await fetch(`${config.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${config.apiToken}` },
    })
    if (!res.ok) throw new Error(`Stalwart API ${res.status}: ${path}`)
    return res.json()
  }

  async test(config): Promise<AdapterTestResult> {
    try {
      const info = await this.get(config, '/api/server/info')
      return { ok: true, version: info.version, message: `Connected to Stalwart ${info.version}` }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  }

  async getStats(config): Promise<ServerStats> {
    const [report, queue] = await Promise.all([
      this.get(config, '/api/reports/smtp?period=24h'),
      this.get(config, '/api/queue/messages'),
    ])
    return {
      queueDepth: queue.total ?? 0,
      queueFailed: queue.failed ?? 0,
      delivered24h: report.delivered ?? 0,
      bounced24h: report.bounced ?? 0,
      rejected24h: report.rejected ?? 0,
      deferred24h: report.deferred ?? 0,
      tlsPercent: report.tlsPercent ?? 0,
      serverVersion: report.version ?? 'unknown',
    }
  }

  async getQueue(config): Promise<QueueStats> {
    const data = await this.get(config, '/api/queue/messages?limit=100')
    return {
      total: data.total,
      active: data.active,
      deferred: data.deferred,
      failed: data.failed,
      oldestMessageAge: data.messages?.[0]?.age ?? 0,
      messages: data.messages ?? [],
    }
  }

  async getDeliveryEvents(config, since, limit): Promise<DeliveryEvent[]> {
    const data = await this.get(
      config,
      `/api/logs/delivery?since=${since.toISOString()}&limit=${limit}`
    )
    return data.events.map(this.mapDeliveryEvent)
  }

  async getAuthFailures(config, since): Promise<AuthFailureEvent[]> {
    const data = await this.get(
      config,
      `/api/logs/auth?since=${since.toISOString()}&type=failure`
    )
    return data.events
  }

  async getRecipientDomainStats(config, since): Promise<RecipientDomainStat[]> {
    const data = await this.get(
      config,
      `/api/reports/recipient-domains?since=${since.toISOString()}`
    )
    return data.domains
  }
}
```

---

### 2.2 Mailcow adapter

```typescript
// packages/monitors/src/adapters/mailcow.ts

export class MailcowAdapter implements MailServerAdapter {
  readonly type = 'mailcow'
  readonly displayName = 'Mailcow'

  private async get(config: AdapterConfig, path: string) {
    const res = await fetch(`${config.baseUrl}${path}`, {
      headers: { 'X-API-Key': config.apiToken },
    })
    if (!res.ok) throw new Error(`Mailcow API ${res.status}: ${path}`)
    return res.json()
  }

  async test(config) {
    const status = await this.get(config, '/api/v1/get/status/containers')
    const postfixRunning = status.postfix?.state === 'running'
    return {
      ok: postfixRunning,
      version: status.mailcow_dockerized?.version,
      message: postfixRunning ? 'Connected to Mailcow' : 'Postfix not running',
    }
  }

  async getStats(config): Promise<ServerStats> {
    const [containers, vmail] = await Promise.all([
      this.get(config, '/api/v1/get/status/containers'),
      this.get(config, '/api/v1/get/status/vmail'),
    ])
    // Mailcow exposes container health + vmail usage
    // Delivery stats come from Postfix logs via log endpoint
    const logs = await this.get(config, '/api/v1/get/logs/postfix/100')
    return this.parseMailcowStats(containers, vmail, logs)
  }

  async getQueue(config): Promise<QueueStats> {
    const queue = await this.get(config, '/api/v1/get/status/containers')
    // Mailcow queue via postqueue -j equivalent through API
    const queueData = await this.get(config, '/api/v1/get/mailq')
    return this.parseMailcowQueue(queueData)
  }

  async getDeliveryEvents(config, since, limit): Promise<DeliveryEvent[]> {
    const logs = await this.get(config, `/api/v1/get/logs/postfix/${limit}`)
    return this.parsePostfixLogs(logs, since)
  }

  async getAuthFailures(config, since): Promise<AuthFailureEvent[]> {
    const logs = await this.get(config, `/api/v1/get/logs/dovecot/200`)
    return this.parseDovecotAuthFailures(logs, since)
  }

  async getRecipientDomainStats(config, since): Promise<RecipientDomainStat[]> {
    const logs = await this.get(config, `/api/v1/get/logs/postfix/1000`)
    return this.aggregateByRecipientDomain(this.parsePostfixLogs(logs, since))
  }

  // Postfix log parsing — shared with PostfixAdapter
  private parsePostfixLogs(lines: string[], since: Date): DeliveryEvent[] {
    return PostfixLogParser.parse(lines, since)
  }
}
```

---

### 2.3 Postfix adapter (log-based via agent)

```typescript
// packages/monitors/src/adapters/postfix.ts
// Requires MxWatch agent installed on the Postfix host
// Agent tails /var/log/mail.log and pushes parsed events via WebSocket

export class PostfixAdapter implements MailServerAdapter {
  readonly type = 'postfix'
  readonly displayName = 'Postfix'

  // No direct API — relies on agent WebSocket connection
  // Agent handles: log tailing, mailq parsing, postconf -n for config

  async test(config): Promise<AdapterTestResult> {
    // Check if agent is connected and reporting this host
    const agent = await getAgentForHost(config.agentId)
    if (!agent || agent.status !== 'connected') {
      return { ok: false, message: 'MxWatch agent not connected. Install agent on this host.' }
    }
    return { ok: true, message: `Agent connected — ${agent.hostname}` }
  }

  async getStats(config): Promise<ServerStats> {
    // Request snapshot from agent via WebSocket command
    return sendAgentCommand(config.agentId, 'postfix_stats')
  }

  async getQueue(config): Promise<QueueStats> {
    // Agent runs: postqueue -j | parse
    return sendAgentCommand(config.agentId, 'postfix_queue')
  }

  async getDeliveryEvents(config, since, limit): Promise<DeliveryEvent[]> {
    // Agent streams parsed mail.log entries
    return sendAgentCommand(config.agentId, 'postfix_logs', { since, limit })
  }

  async getAuthFailures(config, since): Promise<AuthFailureEvent[]> {
    return sendAgentCommand(config.agentId, 'postfix_auth_failures', { since })
  }

  async getRecipientDomainStats(config, since): Promise<RecipientDomainStat[]> {
    const events = await this.getDeliveryEvents(config, since, 10000)
    return PostfixLogParser.aggregateByDomain(events)
  }
}
```

---

### 2.4 Postfix log parser (shared by Postfix + Mailcow)

```typescript
// packages/monitors/src/adapters/postfix-log-parser.ts

// Postfix log format:
// Apr 14 10:23:45 mail postfix/smtp[1234]: ABC123: to=<user@gmail.com>,
//   relay=gmail-smtp-in.l.google.com[142.250.27.27]:25,
//   delay=1.2, delays=0.1/0/0.5/0.6, dsn=2.0.0, status=sent
//   (250 2.0.0 OK  1744620225 ...)

export class PostfixLogParser {
  static parse(lines: string[], since: Date): DeliveryEvent[] {
    const events: DeliveryEvent[] = []

    for (const line of lines) {
      const ts = parsePostfixTimestamp(line)
      if (ts < since) continue

      // Delivery success
      if (line.includes('status=sent')) {
        events.push(parseDeliveryLine(line, 'delivered'))
      }
      // Bounce (permanent failure)
      else if (line.includes('status=bounced')) {
        events.push(parseDeliveryLine(line, 'bounced'))
      }
      // Deferral (temporary failure, will retry)
      else if (line.includes('status=deferred')) {
        events.push(parseDeliveryLine(line, 'deferred'))
      }
    }

    return events
  }

  static aggregateByDomain(events: DeliveryEvent[]): RecipientDomainStat[] {
    const byDomain = new Map<string, RecipientDomainStat>()

    for (const event of events) {
      const domain = event.recipientDomain
      if (!byDomain.has(domain)) {
        byDomain.set(domain, {
          domain,
          sent: 0, delivered: 0, bounced: 0, deferred: 0,
          deliveryRate: 0, avgDelayMs: 0,
        })
      }
      const stat = byDomain.get(domain)!
      stat.sent++
      if (event.type === 'delivered') stat.delivered++
      if (event.type === 'bounced') {
        stat.bounced++
        stat.lastBounceReason = event.errorMessage
      }
      if (event.type === 'deferred') stat.deferred++
    }

    // Calculate rates
    for (const stat of byDomain.values()) {
      stat.deliveryRate = stat.sent > 0
        ? Math.round((stat.delivered / stat.sent) * 100)
        : 0
    }

    return Array.from(byDomain.values())
      .sort((a, b) => b.sent - a.sent)
  }
}
```

---

### 2.5 Adapter registry

```typescript
// packages/monitors/src/adapters/index.ts

export const ADAPTER_REGISTRY: Record<MailServerType, MailServerAdapter> = {
  stalwart:        new StalwartAdapter(),
  mailcow:         new MailcowAdapter(),
  postfix:         new PostfixAdapter(),
  postfix_dovecot: new PostfixAdapter(),  // same adapter
  mailu:           new MailuAdapter(),    // stub — V4.1
  maddy:           new MaddyAdapter(),    // stub — V4.1 (log only)
  haraka:          new HarakaAdapter(),   // stub — V4.1
  exchange:        new ExchangeAdapter(), // stub — enterprise, V5
  unknown:         new GenericSMTPAdapter(), // SMTP-only, no API
}

export function getAdapter(type: MailServerType): MailServerAdapter {
  return ADAPTER_REGISTRY[type] ?? ADAPTER_REGISTRY.unknown
}
```

---

## Part 3 — Bounce Intelligence

### 3.1 DSN parsing

MxWatch already receives email via the SMTP listener on port 2525.
Extend it to also receive and parse DSN (bounce) emails.

```typescript
// packages/monitors/src/bounce-parser.ts

import { simpleParser } from 'mailparser'

export interface ParsedBounce {
  timestamp: Date
  originalTo: string           // who you tried to send to
  originalFrom: string         // your sending address
  recipientDomain: string      // extracted from originalTo
  bounceType: 'hard' | 'soft' | 'policy' | 'unknown'
  errorCode: string            // '550', '421', '550 5.1.1', etc.
  errorMessage: string         // human-readable from DSN
  remoteMTA: string | null     // which server bounced it
  relatedRBL: string | null    // if RBL mentioned in bounce reason
  // Decoded from original message headers
  originalSubject?: string
  originalMsgId?: string
  originalSentAt?: Date
}

export async function parseDSN(rawEmail: string): Promise<ParsedBounce | null> {
  const parsed = await simpleParser(rawEmail)

  // DSNs have content-type: multipart/report; report-type=delivery-status
  if (!parsed.headers.get('content-type')?.toString().includes('report')) {
    return null
  }

  // Extract the delivery-status part
  const statusPart = parsed.attachments?.find(
    a => a.contentType === 'message/delivery-status'
  )
  if (!statusPart) return null

  const statusText = statusPart.content.toString()

  // Parse Final-Recipient, Status, Diagnostic-Code
  const finalRecipient = extractDSNField(statusText, 'Final-Recipient')
  const status = extractDSNField(statusText, 'Status')         // '5.1.1'
  const diagnostic = extractDSNField(statusText, 'Diagnostic-Code')
  const remoteMTA = extractDSNField(statusText, 'Remote-MTA')

  if (!finalRecipient || !status) return null

  const to = finalRecipient.replace(/^rfc822;\s*/, '').trim()

  // Classify bounce type from status code
  // 5.x.x = permanent (hard), 4.x.x = temporary (soft)
  // 5.7.x = policy (RBL block, spam policy, etc.)
  const bounceType =
    status.startsWith('4') ? 'soft' :
    status.startsWith('5.7') ? 'policy' :
    status.startsWith('5') ? 'hard' : 'unknown'

  // Check if an RBL is mentioned in the diagnostic
  const rblMentioned = detectRBLMention(diagnostic ?? '')

  return {
    timestamp: new Date(),
    originalTo: to,
    originalFrom: parsed.envelope?.from ?? '',
    recipientDomain: to.split('@')[1] ?? '',
    bounceType,
    errorCode: status,
    errorMessage: diagnostic ?? status,
    remoteMTA: remoteMTA?.replace('dns;', '').trim() ?? null,
    relatedRBL: rblMentioned,
  }
}

// Detect RBL mentions in bounce messages
// e.g. "blocked using zen.spamhaus.org"
function detectRBLMention(text: string): string | null {
  const rblPatterns = [
    /zen\.spamhaus\.org/i,
    /b\.barracudacentral\.org/i,
    /bl\.spamcop\.net/i,
    /dnsbl\.sorbs\.net/i,
    /bl\.mailspike\.net/i,
    /spamrats/i,
  ]
  for (const pattern of rblPatterns) {
    const match = text.match(pattern)
    if (match) return match[0]
  }
  return null
}
```

### 3.2 Bounce correlation

When a bounce is parsed, MxWatch correlates it with existing data:

```typescript
// packages/monitors/src/bounce-correlator.ts

export async function correlateBounce(
  bounce: ParsedBounce,
  domainId: string,
): Promise<BounceCorrelation> {
  const correlation: BounceCorrelation = {
    bounce,
    relatedRBLListing: null,
    relatedDMARCFailure: null,
    suggestedAction: null,
    severity: 'info',
  }

  // Check if recipient domain has been having issues
  const recentBouncesToSameDomain = await getRecentBounces(
    domainId,
    bounce.recipientDomain,
    24, // hours
  )

  // Check if this matches an active RBL listing
  if (bounce.relatedRBL || bounce.bounceType === 'policy') {
    const activeListing = await getActiveRBLListing(domainId)
    if (activeListing) {
      correlation.relatedRBLListing = activeListing
      correlation.severity = 'critical'
      correlation.suggestedAction =
        `Your IP is listed on ${activeListing.rblName}. ` +
        `This is causing delivery failures to ${bounce.recipientDomain}. ` +
        `Request delist at ${getDelistUrl(activeListing.rblName)}.`
    }
  }

  // Spike detection — 3+ bounces to same domain in 1h = alert
  if (recentBouncesToSameDomain.length >= 3) {
    correlation.severity = 'warning'
    correlation.suggestedAction =
      `${recentBouncesToSameDomain.length} bounces to ${bounce.recipientDomain} ` +
      `in the last hour. Check your sending reputation with this provider.`
  }

  return correlation
}
```

### 3.3 DB schema for bounce intelligence

```typescript
export const bounceEvents = sqliteTable('bounce_events', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').references(() => domains.id),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  originalTo: text('original_to').notNull(),
  recipientDomain: text('recipient_domain').notNull(),
  bounceType: text('bounce_type').notNull(),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  remoteMTA: text('remote_mta'),
  relatedRBL: text('related_rbl'),
  severity: text('severity').default('info'),
  acknowledged: integer('acknowledged', { mode: 'boolean' }).default(false),
})

export const recipientDomainStats = sqliteTable('recipient_domain_stats', {
  id: text('id').primaryKey(),
  domainId: text('domain_id').references(() => domains.id),
  serverIntegrationId: text('server_integration_id'),
  recipientDomain: text('recipient_domain').notNull(),
  period: text('period').notNull(),              // '1h' | '24h' | '7d'
  sent: integer('sent').default(0),
  delivered: integer('delivered').default(0),
  bounced: integer('bounced').default(0),
  deferred: integer('deferred').default(0),
  deliveryRate: integer('delivery_rate'),         // 0-100
  avgDelayMs: integer('avg_delay_ms'),
  lastBounceReason: text('last_bounce_reason'),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull(),
})
```

---

## Part 4 — Per-Recipient Domain Intelligence

### 4.1 Delivery rate dashboard

The crown jewel of V4. Shows you exactly how well your email
reaches each major provider — the data Google Postmaster Tools
only gives you for Gmail, MxWatch gives you for everyone.

```typescript
// tRPC router addition
recipientDomains: router({
  stats: authedProcedure
    .input(z.object({
      domainId: z.string(),
      period: z.enum(['1h', '24h', '7d', '30d']).default('24h'),
      minSent: z.number().default(5),  // filter noise
    }))
    .query(async ({ input }) => {
      // Pull from recipientDomainStats table
      // Also pull from server integration if available
      return getRecipientDomainStats(input)
    }),

  trend: authedProcedure
    .input(z.object({
      domainId: z.string(),
      recipientDomain: z.string(),
      days: z.number().default(30),
    }))
    .query(/* daily delivery rate trend for one recipient domain */),

  problems: authedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(/* recipient domains with delivery rate < 95% */),
}),
```

**UI — Recipient Domains page:**

```
Your email delivery rates — last 24 hours

Provider          Sent    Delivered    Deferred    Bounced    Rate
─────────────────────────────────────────────────────────────────
gmail.com          847       841           4           2      99.3% ✓
outlook.com        312       308           3           1      98.7% ✓
yahoo.com           84        76           8           0      90.5% ⚠
hotmail.com         67        64           2           1      95.5% ✓
icloud.com          23        15           0           8      65.2% ✗  ← problem
protonmail.com      18        18           0           0     100.0% ✓
zoho.com            12        12           0           0     100.0% ✓

icloud.com → 8 hard bounces
  Last error: "550 5.1.1 The email account that you tried to reach 
  does not exist"
  → These are invalid addresses, not a deliverability problem
```

---

## Part 5 — Queue Intelligence

### 5.1 Queue health monitoring

```typescript
// Cron job: check queue every 5 minutes
// Alert conditions:
// - Queue depth > configurable threshold (default: 50)
// - Message in queue > 1 hour
// - Failed queue not empty
// - Queue growing faster than it's draining

export async function monitorQueue(integrationId: string): Promise<void> {
  const adapter = getAdapterForIntegration(integrationId)
  const queue = await adapter.getQueue(config)

  // Store snapshot
  await db.insert(queueSnapshots).values({
    integrationId,
    total: queue.total,
    active: queue.active,
    deferred: queue.deferred,
    failed: queue.failed,
    oldestMessageAge: queue.oldestMessageAge,
    recordedAt: new Date(),
  })

  // Alert: stuck messages
  if (queue.oldestMessageAge > 3600) {
    await fireAlert('queue_message_stuck', {
      age: queue.oldestMessageAge,
      messageId: queue.messages[0]?.id,
      lastError: queue.messages[0]?.lastError,
    })
  }

  // Alert: failed queue not empty
  if (queue.failed > 0) {
    await fireAlert('queue_messages_failed', {
      count: queue.failed,
      sample: queue.messages.filter(m => m.attempts > 5).slice(0, 3),
    })
  }

  // Alert: queue spike
  const prevSnapshot = await getLatestQueueSnapshot(integrationId)
  if (prevSnapshot && queue.total > prevSnapshot.total * 2 && queue.total > 20) {
    await fireAlert('queue_spike', {
      current: queue.total,
      previous: prevSnapshot.total,
    })
  }
}
```

**UI — Queue tab on server integration page:**

```
Mail queue — mail.homelabza.com

  Active: 2   Deferred: 0   Failed: 0   Oldest: 4 min

  Queue depth (24h)
  [sparkline chart — should be near zero most of the time]

  Current queue
  ─────────────────────────────────────────────────────
  ID        To                  Age    Attempts  Last error
  A1B2C3    user@gmail.com      2m     1         —
  D4E5F6    user@yahoo.com      4m     1         —
```

---

## Part 6 — Auth Failure Monitoring

### 6.1 Brute force detection

```typescript
// Runs every 5 minutes via cron
export async function monitorAuthFailures(integrationId: string): Promise<void> {
  const since = new Date(Date.now() - 5 * 60 * 1000) // last 5 min
  const adapter = getAdapterForIntegration(integrationId)
  const failures = await adapter.getAuthFailures(config, since)

  if (failures.length === 0) return

  // Group by IP
  const byIP = groupBy(failures, f => f.ip)

  for (const [ip, events] of Object.entries(byIP)) {
    // Alert if any IP has > 10 failures in 5 minutes
    if (events.length >= 10) {
      await fireAlert('auth_brute_force', {
        ip,
        count: events.length,
        usernames: [...new Set(events.map(e => e.username).filter(Boolean))],
        mechanism: events[0].mechanism,
        period: '5 minutes',
      })

      // Store for history
      await db.insert(authFailureEvents).values({
        integrationId,
        ip,
        count: events.length,
        sampleUsername: events[0].username,
        mechanism: events[0].mechanism,
        detectedAt: new Date(),
      })
    }
  }
}
```

**UI — Auth failures tab:**

```
Authentication failures — last 24h

  ⚠ 847 failed auth attempts from 3 IPs in the last hour

  IP Address        Country    Attempts    Usernames tried    Last seen
  ───────────────────────────────────────────────────────────────────
  185.220.101.45    Russia      623        admin, root, info   2 min ago
  103.149.28.91     China       187        postmaster, abuse   14 min ago
  45.128.232.19     Germany      37        admin               1h ago

  → Consider adding these IPs to Stalwart's blocklist
    [Copy IPs for blocklist]
```

---

## Part 7 — Updated Navigation & Pages

```
Sidebar (V4):
├── Overview
│   ├── Dashboard
│   └── Activity
│
├── Monitoring
│   ├── Domains
│   ├── Blacklists
│   ├── DMARC reports
│   └── Certificates
│
├── Server intelligence    ← NEW SECTION
│   ├── Mail servers       ← server integrations list
│   ├── Delivery rates     ← per-recipient-domain stats
│   ├── Bounce analysis    ← parsed DSN intelligence
│   ├── Queue monitor      ← queue depth + stuck messages
│   └── Auth failures      ← brute force detection
│
├── Tools
│   ├── Deliverability test
│   ├── Record builder
│   └── Propagation check
│
├── Integrations
│   └── Stalwart           ← moved under Server intelligence in V4
│
└── Watched domains
```

---

## Part 8 — Updated DB Schema

```typescript
// New tables for V4

export const serverIntegrations = sqliteTable('server_integrations', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  domainId: text('domain_id').references(() => domains.id),
  name: text('name').notNull(),
  serverType: text('server_type').notNull(),    // MailServerType enum
  architecture: text('architecture').notNull(), // NetworkArchitecture enum
  baseUrl: text('base_url'),                    // API base URL
  encryptedToken: text('encrypted_token'),      // API key/token
  agentId: text('agent_id'),                    // For Postfix agent-based
  internalHost: text('internal_host'),          // e.g. 192.168.69.12
  relayHost: text('relay_host'),                // e.g. 23.95.170.217
  sendingIps: text('sending_ips'),              // JSON array
  autoDetected: integer('auto_detected', { mode: 'boolean' }).default(false),
  detectionConfidence: text('detection_confidence'),
  status: text('status').default('unknown'),
  lastPulledAt: integer('last_pulled_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const queueSnapshots = sqliteTable('queue_snapshots', {
  id: text('id').primaryKey(),
  integrationId: text('integration_id').references(() => serverIntegrations.id),
  total: integer('total').notNull(),
  active: integer('active').notNull(),
  deferred: integer('deferred').notNull(),
  failed: integer('failed').notNull(),
  oldestMessageAge: integer('oldest_message_age'),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull(),
})

export const authFailureEvents = sqliteTable('auth_failure_events', {
  id: text('id').primaryKey(),
  integrationId: text('integration_id').references(() => serverIntegrations.id),
  ip: text('ip').notNull(),
  count: integer('count').notNull(),
  sampleUsername: text('sample_username'),
  mechanism: text('mechanism'),
  detectedAt: integer('detected_at', { mode: 'timestamp' }).notNull(),
})

// bounceEvents and recipientDomainStats defined in Part 3/4 above
```

---

## Part 9 — V4 Build Order (Claude Code prompt)

```
You are building MxWatch V4 — server intelligence features.
V3.5 is complete. Read mxwatch-v4-spec.md completely before writing code.

STEP 1 — Auto-detection engine
  packages/monitors/src/server-detect.ts
  Implement: isPortOpen(), grabSMTPBanner(), probeHTTP(), isPrivateIP()
  Implement: detectMailServer() — full fingerprinting flow
  Unit test: known banners correctly identified

STEP 2 — Adapter interface + registry
  packages/monitors/src/adapters/types.ts — all interfaces
  packages/monitors/src/adapters/index.ts — registry + getAdapter()

STEP 3 — Stalwart adapter (primary, your setup)
  Full implementation — all 6 interface methods
  Test against 192.168.69.12

STEP 4 — Postfix log parser
  packages/monitors/src/adapters/postfix-log-parser.ts
  Parse: delivered, bounced, deferred from Postfix log format
  Aggregate: by recipient domain

STEP 5 — Mailcow adapter
  Uses Postfix log parser for delivery events
  Adds Mailcow-specific API endpoints for container status

STEP 6 — DB migrations
  Add: serverIntegrations, queueSnapshots, authFailureEvents,
       bounceEvents, recipientDomainStats tables
  Run: pnpm db:migrate

STEP 7 — Bounce intelligence
  packages/monitors/src/bounce-parser.ts — DSN parsing
  packages/monitors/src/bounce-correlator.ts — correlation with RBL
  Wire SMTP listener to also call parseDSN on incoming messages

STEP 8 — tRPC routers
  serverIntegrations router (CRUD + detect + test)
  recipientDomains router (stats, trend, problems)
  bounces router (list, detail, acknowledge)
  queue router (current, history, snapshots)
  authFailures router (list, by-ip, history)

STEP 9 — Cron jobs
  Every 60s: pullServerStats() for all integrations
  Every 5m: monitorQueue() for all integrations
  Every 5m: monitorAuthFailures() for all integrations
  Every 1h: aggregateRecipientDomainStats()

STEP 10 — UI: Server intelligence section
  /servers — integration list + "Add server" wizard
  /servers/new — auto-detect flow (Step 1: enter host → detect)
  /servers/[id] — tabbed detail:
    Overview tab: stats cards + delivery rate summary
    Delivery rates tab: recipient domain table
    Queue tab: depth chart + current messages
    Auth failures tab: IP table + attack timeline
    Bounces tab: parsed bounce feed + correlation
  /delivery-rates — cross-server delivery rate dashboard
  /bounces — unified bounce feed across all domains

STEP 11 — Update domain onboarding
  Add topology step (direct/nat_relay/split/managed)
  Wire to serverIntegrations on domain creation
  Pre-populate from auto-detection if user ran detect

After each step: tsc --noEmit, fix errors before proceeding.
Do not add dependencies without confirming.
Stalwart adapter is highest priority — test against
192.168.69.12 before building other adapters.
```

---

## Part 10 — V4 Competitive Position

After V4 ships, MxWatch does something no other tool does:

| Capability | MxWatch V4 | MXToolbox | Mail-tester | Postmaster Tools |
|------------|-----------|-----------|-------------|-----------------|
| External DNS/RBL monitoring | ✓ | ✓ | ✗ | ✗ |
| DMARC report parsing | ✓ | paid | ✗ | ✓ (Gmail only) |
| Server auto-detection | ✓ | ✗ | ✗ | ✗ |
| Queue monitoring | ✓ | ✗ | ✗ | ✗ |
| Per-recipient-domain rates | ✓ | ✗ | ✗ | ✓ (Gmail only) |
| Bounce intelligence | ✓ | ✗ | ✗ | ✗ |
| Auth failure / brute force | ✓ | ✗ | ✗ | ✗ |
| Stalwart native integration | ✓ | ✗ | ✗ | ✗ |
| Mailcow native integration | ✓ | ✗ | ✗ | ✗ |
| Self-hosted | ✓ | ✗ | ✗ | ✗ |

The "point it at your mail server" pitch is real and unique.
No monitoring tool in this space does server-side intelligence
for self-hosted mail. This is MxWatch's moat.
