# MxWatch — Mail Server Integrations Spec
## Version: 1.0 | April 2026
## Claude Code prompt at bottom — read spec first

---

## Integration Map

```
Tier 1 — Full API (queue + stats + bounces + auth + relay)
  Stalwart     stalwart      REST API Bearer token
  Mailcow      mailcow       REST API X-API-Key header
  Mailu        mailu         REST API Bearer token
  Modoboa      modoboa       REST API Bearer token

Tier 2 — Partial API (stats + relay, limited intelligence)
  Mail-in-a-Box  miab        REST API Basic auth
  Postal         postal      REST API X-Server-API-Key

Tier 3 — Agent log-based (agent required, full intelligence via parsing)
  Postfix        postfix     Agent tails /var/log/mail.log + mailq
  iRedMail       iredmail    Postfix+Dovecot underneath, agent-based
  Haraka         haraka      HTTP plugin hooks
  Maddy          maddy       Agent tails logs

Tier 4 — Cloud providers (webhook + API, no server access)
  Resend         resend      Webhook + REST API
  Postmark       postmark    Webhook + REST API
  Mailgun        mailgun     Webhook + REST API
  SendGrid       sendgrid    Event webhook + REST API
  Amazon SES     ses         SNS notifications + REST API
  Google Workspace google    Postmaster Tools API (Gmail only)
```

---

## Architecture — Adapter Pattern

Every integration implements the same interface.
Code that consumes integrations never knows which type it's talking to.

```typescript
// packages/monitors/src/integrations/types.ts

export type IntegrationType =
  | 'stalwart' | 'mailcow' | 'mailu' | 'modoboa'
  | 'miab' | 'postal'
  | 'postfix' | 'iredmail' | 'haraka' | 'maddy'
  | 'resend' | 'postmark' | 'mailgun' | 'sendgrid' | 'ses' | 'google'

export type IntegrationCapability =
  | 'queue_stats'        // queue depth, stuck messages
  | 'delivery_stats'     // sent/delivered/bounced counts
  | 'bounce_events'      // individual bounce events
  | 'auth_failures'      // brute force detection
  | 'recipient_stats'    // per-domain delivery rates
  | 'relay_inbox'        // can create test inbox for deliverability

export interface MailServerAdapter {
  readonly type: IntegrationType
  readonly displayName: string
  readonly capabilities: IntegrationCapability[]
  readonly authMethod: 'api_key' | 'basic_auth' | 'bearer' | 'agent' | 'webhook_only'

  test(config: IntegrationConfig): Promise<AdapterTestResult>

  // Only called if capability is listed
  getStats?(config: IntegrationConfig): Promise<ServerStats>
  getQueue?(config: IntegrationConfig): Promise<QueueStats>
  getDeliveryEvents?(config: IntegrationConfig, since: Date, limit: number): Promise<DeliveryEvent[]>
  getAuthFailures?(config: IntegrationConfig, since: Date): Promise<AuthFailureEvent[]>
  getRecipientDomainStats?(config: IntegrationConfig, since: Date): Promise<RecipientDomainStat[]>

  // Relay inbox setup for deliverability testing
  setupRelayInbox?(config: IntegrationConfig, webhookUrl: string, webhookSecret: string): Promise<RelayInboxResult>
  teardownRelayInbox?(config: IntegrationConfig): Promise<void>
}

export interface AdapterTestResult {
  ok: boolean
  version?: string
  serverName?: string
  message: string
  capabilities: IntegrationCapability[]
}

export interface RelayInboxResult {
  catchallPattern: string   // e.g. "mxwatch-test-*@homelabza.com"
  setupInstructions?: string // human-readable for manual setups
}
```

---

## DB Schema

```typescript
// packages/db/schema.ts additions

export const mailIntegrations = sqliteTable('mail_integrations', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id).notNull(),
  name: text('name').notNull(),           // user-defined label
  type: text('type').notNull(),           // IntegrationType
  enabled: integer('enabled', { mode: 'boolean' }).default(true),

  // Connection config — JSON, encrypted with ENCRYPTION_KEY
  encryptedConfig: text('encrypted_config').notNull(),
  // Contains: baseUrl, apiKey, username, password, agentId etc
  // Shape varies per integration type

  // Capabilities detected on last test
  capabilities: text('capabilities'),     // JSON array

  // Association — which domains use this integration
  domainIds: text('domain_ids'),          // JSON array of domain IDs

  // Relay inbox state
  relayInboxConfigured: integer('relay_inbox_configured', { mode: 'boolean' }).default(false),
  relayWebhookSecret: text('relay_webhook_secret'),
  relayCatchallPattern: text('relay_catchall_pattern'),

  // Status
  status: text('status').default('unknown'),
  // 'ok' | 'error' | 'unknown' | 'agent_disconnected'
  lastTestedAt: integer('last_tested_at', { mode: 'timestamp' }),
  lastPulledAt: integer('last_pulled_at', { mode: 'timestamp' }),
  errorMessage: text('error_message'),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

// Snapshots — stored per integration, same shape for all types
export const integrationSnapshots = sqliteTable('integration_snapshots', {
  id: text('id').primaryKey(),
  integrationId: text('integration_id')
    .references(() => mailIntegrations.id).notNull(),
  queueDepth: integer('queue_depth'),
  queueFailed: integer('queue_failed'),
  delivered24h: integer('delivered_24h'),
  bounced24h: integer('bounced_24h'),
  rejected24h: integer('rejected_24h'),
  deferred24h: integer('deferred_24h'),
  tlsPercent: integer('tls_percent'),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull(),
})

// Delivery events — from webhooks or API polling
export const deliveryEvents = sqliteTable('delivery_events', {
  id: text('id').primaryKey(),
  integrationId: text('integration_id')
    .references(() => mailIntegrations.id).notNull(),
  domainId: text('domain_id').references(() => domains.id),
  type: text('type').notNull(),
  // 'delivered' | 'bounced' | 'deferred' | 'rejected' | 'complaint'
  fromAddress: text('from_address'),
  toAddress: text('to_address'),
  recipientDomain: text('recipient_domain'),
  bounceType: text('bounce_type'),        // 'hard' | 'soft' | 'policy'
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  relatedRBL: text('related_rbl'),
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
  raw: text('raw'),                       // JSON raw event from provider
})

// Auth failure events
export const authFailureEvents = sqliteTable('auth_failure_events', {
  id: text('id').primaryKey(),
  integrationId: text('integration_id')
    .references(() => mailIntegrations.id).notNull(),
  ip: text('ip').notNull(),
  count: integer('count').notNull(),
  sampleUsername: text('sample_username'),
  mechanism: text('mechanism'),
  detectedAt: integer('detected_at', { mode: 'timestamp' }).notNull(),
})
```

---

## Tier 1 Adapters

### Stalwart (already spec'd — included for completeness)

```typescript
// packages/monitors/src/integrations/adapters/stalwart.ts
// Already implemented in V3.5 spec — no changes needed
// capabilities: all six
```

### Mailcow

```typescript
// packages/monitors/src/integrations/adapters/mailcow.ts

export class MailcowAdapter implements MailServerAdapter {
  readonly type = 'mailcow'
  readonly displayName = 'Mailcow'
  readonly capabilities: IntegrationCapability[] = [
    'queue_stats', 'delivery_stats', 'bounce_events',
    'auth_failures', 'relay_inbox',
  ]
  readonly authMethod = 'api_key' as const

  // Auth: X-API-Key header
  // Base URL: https://mail.example.com

  async test(config) {
    const res = await this.get(config, '/api/v1/get/status/containers')
    const postfix = res.find(c => c.name === 'postfix-mailcow')
    return {
      ok: postfix?.state === 'running',
      message: postfix?.state === 'running'
        ? 'Mailcow running'
        : 'Postfix container not running',
      capabilities: this.capabilities,
    }
  }

  async getStats(config): Promise<ServerStats> {
    const [containers, logs] = await Promise.all([
      this.get(config, '/api/v1/get/status/containers'),
      this.get(config, '/api/v1/get/logs/postfix/500'),
    ])
    return parseMailcowStats(containers, logs)
  }

  async getQueue(config): Promise<QueueStats> {
    const queue = await this.get(config, '/api/v1/get/mailq')
    return parseMailcowQueue(queue)
  }

  async getDeliveryEvents(config, since, limit): Promise<DeliveryEvent[]> {
    const logs = await this.get(config, `/api/v1/get/logs/postfix/${limit}`)
    return PostfixLogParser.parse(logs, since)
  }

  async getAuthFailures(config, since): Promise<AuthFailureEvent[]> {
    const logs = await this.get(config, '/api/v1/get/logs/dovecot/500')
    return parseDovecotAuthFailures(logs, since)
  }

  async setupRelayInbox(config, webhookUrl, webhookSecret): Promise<RelayInboxResult> {
    // Create Sieve script via Mailcow API
    const domain = extractDomain(config.baseUrl)
    const sieve = buildSieveWebhookScript(webhookUrl, webhookSecret, 'mxwatch-test-')
    await this.post(config, '/api/v1/add/filter', {
      username: `mxwatch@${domain}`,
      filter_type: 'prefilter',
      filter_desc: 'MxWatch deliverability test relay',
      script_data: sieve,
      active: 1,
    })
    return { catchallPattern: `mxwatch-test-*@${domain}` }
  }

  private async get(config: IntegrationConfig, path: string) {
    const { baseUrl, apiKey } = decryptConfig(config)
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { 'X-API-Key': apiKey },
    })
    if (!res.ok) throw new Error(`Mailcow API ${res.status}: ${path}`)
    return res.json()
  }

  private async post(config: IntegrationConfig, path: string, body: unknown) {
    const { baseUrl, apiKey } = decryptConfig(config)
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Mailcow API ${res.status}: ${path}`)
    return res.json()
  }
}
```

### Mailu

```typescript
// packages/monitors/src/integrations/adapters/mailu.ts

export class MailuAdapter implements MailServerAdapter {
  readonly type = 'mailu'
  readonly displayName = 'Mailu'
  readonly capabilities: IntegrationCapability[] = [
    'delivery_stats', 'bounce_events', 'relay_inbox',
  ]
  readonly authMethod = 'bearer' as const

  // Auth: Bearer token (Admin API key)
  // Base URL: https://mail.example.com

  async test(config) {
    const res = await this.get(config, '/api/v1/domain')
    return {
      ok: Array.isArray(res),
      message: Array.isArray(res) ? `Connected — ${res.length} domains` : 'Failed',
      capabilities: this.capabilities,
    }
  }

  async getStats(config): Promise<ServerStats> {
    // Mailu API: GET /api/v1/domain — list domains with stats
    // GET /api/v1/user — users (for auth failure context)
    const domains = await this.get(config, '/api/v1/domain')
    return parseMailuStats(domains)
  }

  async getDeliveryEvents(config, since, limit): Promise<DeliveryEvent[]> {
    // Mailu exposes logs via GET /api/v1/log (if enabled in config)
    try {
      const logs = await this.get(config, `/api/v1/log?limit=${limit}`)
      return parseMailuLogs(logs, since)
    } catch {
      return []  // log endpoint may not be enabled
    }
  }

  async setupRelayInbox(config, webhookUrl, webhookSecret): Promise<RelayInboxResult> {
    // Create a user + alias catchall via Mailu API
    const domain = extractDomain(config.baseUrl)
    // POST /api/v1/alias — create wildcard alias that forwards
    await this.post(config, '/api/v1/alias', {
      localpart: 'mxwatch-test',
      domain,
      destination: [''],  // Mailu handles forwarding via Sieve
      wildcard: true,
      comment: 'MxWatch deliverability test relay',
    })
    return { catchallPattern: `mxwatch-test-*@${domain}` }
  }

  private async get(config: IntegrationConfig, path: string) {
    const { baseUrl, apiKey } = decryptConfig(config)
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) throw new Error(`Mailu API ${res.status}: ${path}`)
    return res.json()
  }

  private async post(config: IntegrationConfig, path: string, body: unknown) {
    const { baseUrl, apiKey } = decryptConfig(config)
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Mailu API ${res.status}: ${path}`)
    return res.json()
  }
}
```

### Mail-in-a-Box

```typescript
// packages/monitors/src/integrations/adapters/miab.ts

export class MiabAdapter implements MailServerAdapter {
  readonly type = 'miab'
  readonly displayName = 'Mail-in-a-Box'
  readonly capabilities: IntegrationCapability[] = [
    'delivery_stats', 'relay_inbox',
  ]
  readonly authMethod = 'basic_auth' as const

  // Auth: Basic auth (admin@domain + password)
  // Base URL: https://box.example.com

  async test(config) {
    const res = await this.get(config, '/admin/me')
    return {
      ok: res.status === 'ok',
      message: res.status === 'ok' ? 'Connected to Mail-in-a-Box' : 'Auth failed',
      capabilities: this.capabilities,
    }
  }

  async getStats(config): Promise<ServerStats> {
    const status = await this.get(config, '/admin/status/checks')
    return parseMiabStatus(status)
  }

  async setupRelayInbox(config, webhookUrl, webhookSecret): Promise<RelayInboxResult> {
    // MIAB doesn't have a forwarding webhook API
    // Fall back to manual instructions
    const domain = extractDomain(config.baseUrl)
    return {
      catchallPattern: `mxwatch-test-*@${domain}`,
      setupInstructions:
        `In your Mail-in-a-Box admin panel, go to Mail → Aliases and create ` +
        `a catchall alias for mxwatch-test-*@${domain} that forwards to ` +
        `${webhookUrl} (use an SMTP-to-HTTP bridge or manual paste mode instead).`,
    }
  }

  private async get(config: IntegrationConfig, path: string) {
    const { baseUrl, username, password } = decryptConfig(config)
    const res = await fetch(`${baseUrl}${path}`, {
      headers: {
        Authorization: `Basic ${btoa(`${username}:${password}`)}`,
      },
    })
    if (!res.ok) throw new Error(`MIAB API ${res.status}: ${path}`)
    return res.json()
  }
}
```

---

## Tier 3 Adapters — Agent-Based

### Postfix (and iRedMail)

```typescript
// packages/monitors/src/integrations/adapters/postfix.ts

export class PostfixAdapter implements MailServerAdapter {
  readonly type = 'postfix'
  readonly displayName = 'Postfix'
  readonly capabilities: IntegrationCapability[] = [
    'queue_stats', 'delivery_stats', 'bounce_events',
    'auth_failures', 'recipient_stats', 'relay_inbox',
  ]
  readonly authMethod = 'agent' as const

  // Requires MxWatch agent installed on Postfix host
  // Agent tails /var/log/mail.log and exposes mailq

  async test(config) {
    const agent = await getAgent(config.agentId)
    if (!agent || agent.status !== 'connected') {
      return {
        ok: false,
        message: 'MxWatch agent not connected. Install agent on this host.',
        capabilities: [],
      }
    }
    const result = await sendAgentCommand(config.agentId, 'postfix_check')
    return {
      ok: result.postfixRunning,
      version: result.version,
      message: result.postfixRunning
        ? `Postfix ${result.version} running`
        : 'Postfix not running on this host',
      capabilities: this.capabilities,
    }
  }

  async getStats(config): Promise<ServerStats> {
    return sendAgentCommand(config.agentId, 'postfix_stats')
  }

  async getQueue(config): Promise<QueueStats> {
    // Agent runs: postqueue -j | parse output
    return sendAgentCommand(config.agentId, 'postfix_queue')
  }

  async getDeliveryEvents(config, since, limit): Promise<DeliveryEvent[]> {
    const lines = await sendAgentCommand(config.agentId,
      'postfix_logs', { since: since.toISOString(), limit })
    return PostfixLogParser.parse(lines, since)
  }

  async getAuthFailures(config, since): Promise<AuthFailureEvent[]> {
    return sendAgentCommand(config.agentId,
      'postfix_auth_failures', { since: since.toISOString() })
  }

  async getRecipientDomainStats(config, since): Promise<RecipientDomainStat[]> {
    const events = await this.getDeliveryEvents(config, since, 10000)
    return PostfixLogParser.aggregateByDomain(events)
  }

  async setupRelayInbox(config, webhookUrl, webhookSecret): Promise<RelayInboxResult> {
    // Agent creates a transport map entry that pipes matching
    // emails to a curl webhook call
    const result = await sendAgentCommand(config.agentId, 'postfix_setup_relay', {
      pattern: 'mxwatch-test-',
      webhookUrl,
      webhookSecret,
    })
    return { catchallPattern: result.catchallPattern }
  }
}

// iRedMail is Postfix + Dovecot underneath
export class IRedMailAdapter extends PostfixAdapter {
  readonly type = 'iredmail' as IntegrationType
  readonly displayName = 'iRedMail'
  // Same implementation as Postfix — identical log format
}
```

### Postfix Agent Commands

The MxWatch agent on the Postfix host handles these commands:

```typescript
// Agent command handlers (runs on the Postfix server):

case 'postfix_check':
  // Runs: postfix status, postconf -h mail_version
  return { postfixRunning: true, version: '3.8.4' }

case 'postfix_stats':
  // Parses last 24h of /var/log/mail.log
  // Counts: sent, bounced, deferred, rejected
  return { delivered24h: 847, bounced24h: 3, ... }

case 'postfix_queue':
  // Runs: postqueue -j
  // Parses JSON output into QueueStats
  return { total: 2, active: 1, deferred: 1, failed: 0, ... }

case 'postfix_logs':
  // Reads /var/log/mail.log from `since` timestamp
  // Returns raw log lines for server-side parsing
  return lines[]

case 'postfix_auth_failures':
  // Parses /var/log/mail.log or /var/log/dovecot.log
  // Groups by IP, counts failures in window
  return authFailureEvents[]

case 'postfix_setup_relay':
  // Adds to /etc/postfix/transport:
  //   mxwatch-test-*@<domain>  webhook:
  // Creates /etc/postfix/webhook_transport master.cf entry
  // Runs: postmap /etc/postfix/transport && postfix reload
  return { catchallPattern: 'mxwatch-test-*@example.com' }
```

### Haraka

```typescript
// packages/monitors/src/integrations/adapters/haraka.ts

export class HarakaAdapter implements MailServerAdapter {
  readonly type = 'haraka'
  readonly displayName = 'Haraka'
  readonly capabilities: IntegrationCapability[] = [
    'delivery_stats', 'bounce_events', 'relay_inbox',
  ]
  readonly authMethod = 'api_key' as const

  // Haraka has an HTTP control interface
  // Also supports plugin hooks for event forwarding

  async test(config) {
    const { baseUrl, apiKey } = decryptConfig(config)
    const res = await fetch(`${baseUrl}/plugins`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    return {
      ok: res.ok,
      message: res.ok ? 'Connected to Haraka' : 'Haraka control API unreachable',
      capabilities: this.capabilities,
    }
  }

  async setupRelayInbox(config, webhookUrl, webhookSecret): Promise<RelayInboxResult> {
    // Haraka: install a routing plugin that forwards mxwatch-test-* emails
    // to an HTTP endpoint. Plugin config injected via Haraka's config API.
    return {
      catchallPattern: `mxwatch-test-*@${extractDomain(config.baseUrl)}`,
      setupInstructions:
        `Add the mxwatch_relay plugin to your Haraka config/plugins file ` +
        `and set MXWATCH_WEBHOOK_URL=${webhookUrl} in your environment.`,
    }
  }
}
```

---

## Tier 4 Adapters — Cloud Providers

### Resend

```typescript
// packages/monitors/src/integrations/adapters/resend.ts

export class ResendAdapter implements MailServerAdapter {
  readonly type = 'resend'
  readonly displayName = 'Resend'
  readonly capabilities: IntegrationCapability[] = [
    'delivery_stats', 'bounce_events', 'relay_inbox',
  ]
  readonly authMethod = 'api_key' as const

  async test(config) {
    const { apiKey } = decryptConfig(config)
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const data = await res.json()
    return {
      ok: res.ok,
      message: res.ok
        ? `Connected — ${data.data?.length ?? 0} domains`
        : data.message ?? 'Auth failed',
      capabilities: this.capabilities,
    }
  }

  async getStats(config): Promise<ServerStats> {
    // GET https://api.resend.com/emails?limit=100
    // Aggregate counts from response
    const { apiKey } = decryptConfig(config)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const res = await fetch(
      `https://api.resend.com/emails?limit=100`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    )
    const data = await res.json()
    return aggregateResendStats(data.data, since)
  }

  async setupRelayInbox(config, webhookUrl, webhookSecret): Promise<RelayInboxResult> {
    // Resend supports inbound email routing
    // POST https://api.resend.com/inbound/routes
    const { apiKey, testDomain } = decryptConfig(config)
    const res = await fetch('https://api.resend.com/inbound/routes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        domain: testDomain,
        recipient: 'mxwatch-test-*',
        destination: webhookUrl,
      }),
    })
    return { catchallPattern: `mxwatch-test-*@${testDomain}` }
  }
}

// Resend webhook handler
// apps/web/app/api/webhooks/resend/route.ts
export async function POST(req: Request) {
  const signature = req.headers.get('svix-signature')
  // Verify Resend webhook signature
  const payload = await req.json()

  switch (payload.type) {
    case 'email.sent':
      await handleDeliveryEvent({ type: 'delivered', ...payload.data })
      break
    case 'email.bounced':
      await handleDeliveryEvent({ type: 'bounced', ...payload.data })
      break
    case 'email.complained':
      await handleDeliveryEvent({ type: 'complaint', ...payload.data })
      break
    case 'inbound.email':
      // Deliverability test email received
      await handleDeliverabilityTestEmail(
        payload.data.raw_email,
        await simpleParser(payload.data.raw_email),
        payload.data.to,
      )
      break
  }

  return new Response('OK')
}
```

### Postmark

```typescript
// packages/monitors/src/integrations/adapters/postmark.ts

export class PostmarkAdapter implements MailServerAdapter {
  readonly type = 'postmark'
  readonly displayName = 'Postmark'
  readonly capabilities: IntegrationCapability[] = [
    'delivery_stats', 'bounce_events', 'relay_inbox',
  ]
  readonly authMethod = 'api_key' as const

  async test(config) {
    const { serverToken } = decryptConfig(config)
    const res = await fetch('https://api.postmarkapp.com/server', {
      headers: { 'X-Postmark-Server-Token': serverToken },
    })
    const data = await res.json()
    return {
      ok: res.ok,
      serverName: data.Name,
      message: res.ok ? `Connected — server: ${data.Name}` : 'Auth failed',
      capabilities: this.capabilities,
    }
  }

  async getStats(config): Promise<ServerStats> {
    const { serverToken } = decryptConfig(config)
    const toDate = new Date().toISOString().slice(0, 10)
    const fromDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const res = await fetch(
      `https://api.postmarkapp.com/stats/outbound?fromdate=${fromDate}&todate=${toDate}`,
      { headers: { 'X-Postmark-Server-Token': serverToken } }
    )
    return parsePostmarkStats(await res.json())
  }

  async getDeliveryEvents(config, since, limit): Promise<DeliveryEvent[]> {
    const { serverToken } = decryptConfig(config)
    const res = await fetch(
      `https://api.postmarkapp.com/messages/outbound?count=${limit}&offset=0`,
      { headers: { 'X-Postmark-Server-Token': serverToken } }
    )
    return parsePostmarkMessages(await res.json(), since)
  }

  async setupRelayInbox(config, webhookUrl, webhookSecret): Promise<RelayInboxResult> {
    const { serverToken, inboundDomain } = decryptConfig(config)
    // Postmark inbound: configure via dashboard or API
    // POST https://api.postmarkapp.com/webhooks
    await fetch('https://api.postmarkapp.com/webhooks', {
      method: 'POST',
      headers: {
        'X-Postmark-Account-Token': serverToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        Url: webhookUrl,
        MessageStream: 'inbound',
        HttpAuth: { Username: 'mxwatch', Password: webhookSecret },
        Triggers: { InboundEmail: { Enabled: true } },
      }),
    })
    return { catchallPattern: `mxwatch-test-*@${inboundDomain}` }
  }
}

// Postmark webhook handler
// apps/web/app/api/webhooks/postmark/route.ts
export async function POST(req: Request) {
  const payload = await req.json()

  if (payload.RecordType === 'Delivery') {
    await handleDeliveryEvent({ type: 'delivered', ...payload })
  } else if (payload.RecordType === 'Bounce') {
    await handleDeliveryEvent({
      type: payload.Type === 'HardBounce' ? 'bounced' : 'deferred',
      ...payload,
    })
  } else if (payload.RecordType === 'SpamComplaint') {
    await handleDeliveryEvent({ type: 'complaint', ...payload })
  } else if (payload.RecordType === 'InboundEmail') {
    await handleDeliverabilityTestEmail(
      payload.RawEmail,
      await simpleParser(payload.RawEmail),
      payload.To,
    )
  }

  return new Response('OK')
}
```

### Mailgun

```typescript
// packages/monitors/src/integrations/adapters/mailgun.ts

export class MailgunAdapter implements MailServerAdapter {
  readonly type = 'mailgun'
  readonly displayName = 'Mailgun'
  readonly capabilities: IntegrationCapability[] = [
    'delivery_stats', 'bounce_events', 'relay_inbox',
  ]
  readonly authMethod = 'api_key' as const

  // Auth: Basic auth — api:YOUR_API_KEY
  // Regions: api.mailgun.net (US) or api.eu.mailgun.net (EU)

  async test(config) {
    const { apiKey, domain, region } = decryptConfig(config)
    const base = region === 'eu'
      ? 'https://api.eu.mailgun.net'
      : 'https://api.mailgun.net'
    const res = await fetch(`${base}/v3/domains/${domain}`, {
      headers: { Authorization: `Basic ${btoa(`api:${apiKey}`)}` },
    })
    return {
      ok: res.ok,
      message: res.ok ? `Connected — domain: ${domain}` : 'Auth failed',
      capabilities: this.capabilities,
    }
  }

  async getStats(config): Promise<ServerStats> {
    const { apiKey, domain, region } = decryptConfig(config)
    const base = region === 'eu'
      ? 'https://api.eu.mailgun.net'
      : 'https://api.mailgun.net'
    const res = await fetch(
      `${base}/v3/${domain}/stats/total?event=delivered&event=bounced&duration=1d`,
      { headers: { Authorization: `Basic ${btoa(`api:${apiKey}`)}` } }
    )
    return parseMailgunStats(await res.json())
  }

  async setupRelayInbox(config, webhookUrl, webhookSecret): Promise<RelayInboxResult> {
    const { apiKey, domain, region } = decryptConfig(config)
    const base = region === 'eu'
      ? 'https://api.eu.mailgun.net'
      : 'https://api.mailgun.net'
    // Create a route that matches mxwatch-test-* and forwards to webhook
    await fetch(`${base}/v3/routes`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`api:${apiKey}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        priority: '0',
        description: 'MxWatch deliverability test relay',
        expression: `match_recipient("mxwatch-test-.*@${domain}")`,
        action: `forward("${webhookUrl}")`,
        action2: 'stop()',
      }),
    })
    return { catchallPattern: `mxwatch-test-*@${domain}` }
  }
}

// Mailgun webhook handler
// apps/web/app/api/webhooks/mailgun/route.ts
export async function POST(req: Request) {
  const body = await req.formData()
  const signature = body.get('signature')
  // Verify Mailgun webhook signature (HMAC-SHA256)

  const eventData = JSON.parse(body.get('event-data') as string ?? '{}')
  const event = eventData.event

  if (event === 'delivered') {
    await handleDeliveryEvent({ type: 'delivered', ...eventData })
  } else if (event === 'failed') {
    await handleDeliveryEvent({
      type: eventData.severity === 'permanent' ? 'bounced' : 'deferred',
      ...eventData,
    })
  } else if (event === 'complained') {
    await handleDeliveryEvent({ type: 'complaint', ...eventData })
  }

  // Inbound: Mailgun sends raw email body in multipart form
  const rawEmail = body.get('body-mime') as string
  if (rawEmail) {
    const to = body.get('recipient') as string
    await handleDeliverabilityTestEmail(
      rawEmail,
      await simpleParser(rawEmail),
      to,
    )
  }

  return new Response('OK')
}
```

### SendGrid

```typescript
// packages/monitors/src/integrations/adapters/sendgrid.ts

export class SendGridAdapter implements MailServerAdapter {
  readonly type = 'sendgrid'
  readonly displayName = 'SendGrid'
  readonly capabilities: IntegrationCapability[] = [
    'delivery_stats', 'bounce_events', 'relay_inbox',
  ]
  readonly authMethod = 'api_key' as const

  async test(config) {
    const { apiKey } = decryptConfig(config)
    const res = await fetch('https://api.sendgrid.com/v3/scopes', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    return {
      ok: res.ok,
      message: res.ok ? 'Connected to SendGrid' : 'Auth failed',
      capabilities: this.capabilities,
    }
  }

  async getStats(config): Promise<ServerStats> {
    const { apiKey } = decryptConfig(config)
    const startDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const res = await fetch(
      `https://api.sendgrid.com/v3/stats?start_date=${startDate}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    )
    return parseSendGridStats(await res.json())
  }

  async setupRelayInbox(config, webhookUrl, webhookSecret): Promise<RelayInboxResult> {
    const { apiKey, inboundDomain } = decryptConfig(config)
    // SendGrid Inbound Parse Webhook
    await fetch('https://api.sendgrid.com/v3/user/webhooks/parse/settings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hostname: inboundDomain,
        url: webhookUrl,
        spam_check: false,
        send_raw: true,
      }),
    })
    return { catchallPattern: `mxwatch-test-*@${inboundDomain}` }
  }
}

// SendGrid webhook handler
// apps/web/app/api/webhooks/sendgrid/route.ts
export async function POST(req: Request) {
  const payload = await req.json()
  // SendGrid sends array of events
  for (const event of Array.isArray(payload) ? payload : [payload]) {
    if (event.event === 'delivered') {
      await handleDeliveryEvent({ type: 'delivered', ...event })
    } else if (event.event === 'bounce') {
      await handleDeliveryEvent({
        type: event.type === 'blocked' ? 'deferred' : 'bounced',
        ...event,
      })
    } else if (event.event === 'spamreport') {
      await handleDeliveryEvent({ type: 'complaint', ...event })
    }
  }
  return new Response('OK')
}

// SendGrid inbound webhook (separate endpoint)
// apps/web/app/api/webhooks/sendgrid-inbound/route.ts
export async function POST(req: Request) {
  const body = await req.formData()
  const rawEmail = body.get('email') as string
  const to = body.get('to') as string
  if (rawEmail && to) {
    await handleDeliverabilityTestEmail(
      rawEmail,
      await simpleParser(rawEmail),
      to,
    )
  }
  return new Response('OK')
}
```

### Amazon SES

```typescript
// packages/monitors/src/integrations/adapters/ses.ts

export class SESAdapter implements MailServerAdapter {
  readonly type = 'ses'
  readonly displayName = 'Amazon SES'
  readonly capabilities: IntegrationCapability[] = [
    'delivery_stats', 'bounce_events', 'relay_inbox',
  ]
  readonly authMethod = 'api_key' as const

  async test(config) {
    const { accessKeyId, secretAccessKey, region } = decryptConfig(config)
    // GET SendQuota — simple, always available
    const quota = await sesApiCall(
      'GET', '/v2/email/sending-quota',
      accessKeyId, secretAccessKey, region,
    )
    return {
      ok: !!quota.MaxSendRate,
      message: quota.MaxSendRate
        ? `Connected — ${quota.MaxSendRate} sends/sec max`
        : 'Auth failed',
      capabilities: this.capabilities,
    }
  }

  async getStats(config): Promise<ServerStats> {
    const { accessKeyId, secretAccessKey, region } = decryptConfig(config)
    const stats = await sesApiCall(
      'GET', '/v2/email/sending-quota',
      accessKeyId, secretAccessKey, region,
    )
    return parseSESStats(stats)
  }

  async setupRelayInbox(config, webhookUrl, webhookSecret): Promise<RelayInboxResult> {
    // SES inbound: create receipt rule that forwards to SNS → Lambda → webhook
    // This is complex — provide manual instructions instead
    const { inboundDomain } = decryptConfig(config)
    return {
      catchallPattern: `mxwatch-test-*@${inboundDomain}`,
      setupInstructions:
        `In AWS SES Console: Rules → Create Rule → ` +
        `Recipient: mxwatch-test-*@${inboundDomain} → ` +
        `Action: SNS notification to an SNS topic → ` +
        `Subscribe the SNS topic to ${webhookUrl} (HTTPS endpoint). ` +
        `Or use the manual paste mode — send a test email and paste the headers.`,
    }
  }
}

// SES SNS webhook handler
// apps/web/app/api/webhooks/ses/route.ts
export async function POST(req: Request) {
  const body = await req.json()

  // SNS subscription confirmation
  if (body.Type === 'SubscriptionConfirmation') {
    await fetch(body.SubscribeURL)
    return new Response('OK')
  }

  if (body.Type === 'Notification') {
    const message = JSON.parse(body.Message)
    const notificationType = message.notificationType

    if (notificationType === 'Delivery') {
      await handleDeliveryEvent({ type: 'delivered', ...message.delivery })
    } else if (notificationType === 'Bounce') {
      await handleDeliveryEvent({
        type: message.bounce.bounceType === 'Permanent' ? 'bounced' : 'deferred',
        ...message.bounce,
      })
    } else if (notificationType === 'Complaint') {
      await handleDeliveryEvent({ type: 'complaint', ...message.complaint })
    }
  }

  return new Response('OK')
}
```

### Google Workspace (Postmaster Tools)

```typescript
// packages/monitors/src/integrations/adapters/google.ts

export class GoogleWorkspaceAdapter implements MailServerAdapter {
  readonly type = 'google'
  readonly displayName = 'Google Workspace / Postmaster Tools'
  readonly capabilities: IntegrationCapability[] = [
    'delivery_stats',
    // Note: Google Postmaster Tools only reports Gmail-bound delivery stats
    // relay_inbox NOT supported — Google doesn't offer inbound routing
  ]
  readonly authMethod = 'api_key' as const

  async test(config) {
    // OAuth2 with Google Postmaster Tools API
    const { accessToken } = await getGoogleToken(config)
    const res = await fetch(
      'https://gmailpostmastertools.googleapis.com/v1/domains',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const data = await res.json()
    return {
      ok: res.ok,
      message: res.ok
        ? `Connected — ${data.domains?.length ?? 0} domains tracked`
        : 'Auth failed — check OAuth credentials',
      capabilities: this.capabilities,
    }
  }

  async getStats(config): Promise<ServerStats> {
    const { accessToken } = await getGoogleToken(config)
    const domain = decryptConfig(config).domain
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const res = await fetch(
      `https://gmailpostmastertools.googleapis.com/v1/domains/${domain}/trafficStats/${date}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    return parseGooglePostmasterStats(await res.json())
  }

  // No relay inbox for Google — Gmail doesn't support inbound routing
  // Users can still use manual paste mode
}
```

---

## Adapter Registry

```typescript
// packages/monitors/src/integrations/registry.ts

import { MailServerAdapter, IntegrationType } from './types'
import { StalwartAdapter } from './adapters/stalwart'
import { MailcowAdapter } from './adapters/mailcow'
import { MailuAdapter } from './adapters/mailu'
import { MiabAdapter } from './adapters/miab'
import { PostfixAdapter, IRedMailAdapter } from './adapters/postfix'
import { HarakaAdapter } from './adapters/haraka'
import { ResendAdapter } from './adapters/resend'
import { PostmarkAdapter } from './adapters/postmark'
import { MailgunAdapter } from './adapters/mailgun'
import { SendGridAdapter } from './adapters/sendgrid'
import { SESAdapter } from './adapters/ses'
import { GoogleWorkspaceAdapter } from './adapters/google'

export const ADAPTER_REGISTRY: Record<IntegrationType, MailServerAdapter> = {
  stalwart:   new StalwartAdapter(),
  mailcow:    new MailcowAdapter(),
  mailu:      new MailuAdapter(),
  modoboa:    new MailuAdapter(),     // similar API shape — stub
  miab:       new MiabAdapter(),
  postal:     new MiabAdapter(),     // stub
  postfix:    new PostfixAdapter(),
  iredmail:   new IRedMailAdapter(),
  haraka:     new HarakaAdapter(),
  maddy:      new PostfixAdapter(),  // log-based, same pattern
  resend:     new ResendAdapter(),
  postmark:   new PostmarkAdapter(),
  mailgun:    new MailgunAdapter(),
  sendgrid:   new SendGridAdapter(),
  ses:        new SESAdapter(),
  google:     new GoogleWorkspaceAdapter(),
}

export function getAdapter(type: IntegrationType): MailServerAdapter {
  return ADAPTER_REGISTRY[type]
}

// Display list for the UI — grouped by tier
export const INTEGRATION_GROUPS = [
  {
    label: 'Self-hosted mail servers',
    items: [
      { type: 'stalwart',  label: 'Stalwart',        logo: 'stalwart.svg' },
      { type: 'mailcow',   label: 'Mailcow',          logo: 'mailcow.svg'  },
      { type: 'mailu',     label: 'Mailu',            logo: 'mailu.svg'    },
      { type: 'iredmail',  label: 'iRedMail',         logo: 'iredmail.svg' },
      { type: 'postfix',   label: 'Postfix',          logo: 'postfix.svg'  },
      { type: 'miab',      label: 'Mail-in-a-Box',    logo: 'miab.svg'     },
      { type: 'haraka',    label: 'Haraka',           logo: 'haraka.svg'   },
      { type: 'maddy',     label: 'Maddy',            logo: 'maddy.svg'    },
    ],
  },
  {
    label: 'Email delivery providers',
    items: [
      { type: 'resend',    label: 'Resend',           logo: 'resend.svg'   },
      { type: 'postmark',  label: 'Postmark',         logo: 'postmark.svg' },
      { type: 'mailgun',   label: 'Mailgun',          logo: 'mailgun.svg'  },
      { type: 'sendgrid',  label: 'SendGrid',         logo: 'sendgrid.svg' },
      { type: 'ses',       label: 'Amazon SES',       logo: 'ses.svg'      },
    ],
  },
  {
    label: 'Reporting & analytics',
    items: [
      { type: 'google',    label: 'Google Postmaster Tools', logo: 'google.svg' },
    ],
  },
]
```

---

## Webhook Endpoints Summary

```
/api/webhooks/stalwart-delivery   Stalwart Sieve forwarding
/api/webhooks/resend              Resend delivery + inbound events
/api/webhooks/postmark            Postmark delivery + inbound
/api/webhooks/mailgun             Mailgun events + inbound
/api/webhooks/sendgrid            SendGrid delivery events
/api/webhooks/sendgrid-inbound    SendGrid inbound parse
/api/webhooks/ses                 Amazon SES via SNS
```

All webhook handlers:
1. Verify signature (HMAC or provider-specific method)
2. Parse event type
3. Route to handleDeliveryEvent() or handleDeliverabilityTestEmail()
4. Return 200 OK immediately (async processing)

---

## tRPC Router

```typescript
integrations: router({
  list: authedProcedure.query(/* all integrations + status */),

  available: publicProcedure.query(() => INTEGRATION_GROUPS),

  create: authedProcedure
    .input(z.object({
      name: z.string(),
      type: z.string(),
      config: z.record(z.string()),  // varies per type
      domainIds: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const encrypted = encryptConfig(input.config)
      const id = nanoid()
      await db.insert(mailIntegrations).values({
        id,
        userId: ctx.user.id,
        name: input.name,
        type: input.type,
        encryptedConfig: encrypted,
        domainIds: JSON.stringify(input.domainIds ?? []),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      return { id }
    }),

  test: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const integration = await getIntegration(input.id, ctx.user.id)
      const adapter = getAdapter(integration.type as IntegrationType)
      const config = decryptConfig(integration.encryptedConfig)
      const result = await adapter.test(config)
      await db.update(mailIntegrations).set({
        status: result.ok ? 'ok' : 'error',
        capabilities: JSON.stringify(result.capabilities),
        lastTestedAt: new Date(),
        errorMessage: result.ok ? null : result.message,
      }).where(eq(mailIntegrations.id, input.id))
      return result
    }),

  setupRelay: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const integration = await getIntegration(input.id, ctx.user.id)
      const adapter = getAdapter(integration.type as IntegrationType)
      if (!adapter.setupRelayInbox) {
        throw new TRPCError({ code: 'BAD_REQUEST',
          message: 'This integration does not support relay inbox' })
      }
      const webhookSecret = generateRandomHex(32)
      const webhookUrl = `${getAppUrl()}/api/webhooks/${integration.type}-delivery`
      const config = decryptConfig(integration.encryptedConfig)
      const result = await adapter.setupRelayInbox(config, webhookUrl, webhookSecret)
      await db.update(mailIntegrations).set({
        relayInboxConfigured: true,
        relayWebhookSecret: webhookSecret,
        relayCatchallPattern: result.catchallPattern,
      }).where(eq(mailIntegrations.id, input.id))
      return result
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(/* */),

  stats: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(/* latest snapshot for this integration */),

  events: authedProcedure
    .input(z.object({
      id: z.string(),
      limit: z.number().default(50),
      type: z.string().optional(),
    }))
    .query(/* delivery events for this integration */),
}),
```

---

## UI — /settings/integrations

```
/settings/integrations

── Connected integrations ───────────────────────────────────────

[Stalwart]  homelab-stalwart     ● connected   relay ✓
            mail.homelabza.com   queue: 0      last pull: 2m ago

[Mailcow]   Not connected                      [+ Add]

[Resend]    resend-transactional ● connected   relay ✓
            3 domains            847 sent/24h  last event: 5m ago

── Add integration ──────────────────────────────────────────────

Self-hosted mail servers
  [Stalwart] [Mailcow] [Mailu] [iRedMail] [Postfix] [MIAB] [Haraka] [Maddy]

Email delivery providers
  [Resend] [Postmark] [Mailgun] [SendGrid] [Amazon SES]

Reporting
  [Google Postmaster Tools]
```

**Add integration modal — 3 steps:**

```
Step 1 — Select type (logo grid as above)

Step 2 — Configure
  Label: [My Stalwart server_________________]
  [type-specific fields]

  Stalwart:
    Base URL:   [https://mail.homelabza.com]
    API token:  [•••••••••••••••••••••••••••]
    [Test connection →]

  Mailcow:
    Base URL:   [https://mail.homelabza.com]
    API key:    [•••••••••••••••••••••••••••]
    [Test connection →]

  Postfix:
    Host:       [192.168.69.12              ]
    Agent:      [Select agent ▾             ]
    (must have MxWatch agent installed)
    [Test connection →]

  Resend:
    API key:    [re_•••••••••••••••••••••••]
    Test domain:[homelabza.com             ]
    [Test connection →]

  Amazon SES:
    Access Key: [AKIA••••••••••••••••••••  ]
    Secret Key: [••••••••••••••••••••••••••]
    Region:     [us-east-1 ▾               ]
    Inbound domain: [mail.homelabza.com    ]
    [Test connection →]

  ✓ Connected — Stalwart 0.7.2

Step 3 — Assign to domains
  Which domains should use this integration?
  ☑ homelabza.com
  ☑ gitbay.dev
  ☐ nudgenudge.com

  [Save integration →]
```

---

## Per-Domain Integration Display

On domain detail page → Overview tab:

```
homelabza.com — Overview

┌─ Mail server ─────────────────────────────────────────────────┐
│ Stalwart · mail.homelabza.com                      [Settings] │
│                                                               │
│ Queue: 0    Sent/24h: 847    Bounced: 3    TLS: 98%          │
│ ● Connected · last pull 2m ago                               │
└───────────────────────────────────────────────────────────────┘

┌─ Delivery provider ───────────────────────────────────────────┐
│ Resend · transactional                             [Settings] │
│                                                               │
│ Sent/24h: 312    Delivered: 311    Bounced: 1               │
│ ● Webhook active                                             │
└───────────────────────────────────────────────────────────────┘
```

If no integration: "No mail server connected — [Add integration]"

---

## Build Order (Claude Code Prompt)

```
STEP 1 — DB migration
  Add mailIntegrations, integrationSnapshots,
  deliveryEvents, authFailureEvents tables
  Run: pnpm db:migrate

STEP 2 — Shared utilities
  packages/monitors/src/integrations/utils.ts
  - encryptConfig / decryptConfig (uses ENCRYPTION_KEY)
  - extractDomain(url)
  - getAppUrl() / getAppHostname()
  - buildSieveWebhookScript(webhookUrl, secret, prefix)
  - PostfixLogParser class (parse + aggregateByDomain)

STEP 3 — Types + registry
  packages/monitors/src/integrations/types.ts
  packages/monitors/src/integrations/registry.ts
  INTEGRATION_GROUPS constant

STEP 4 — Tier 1 adapters
  stalwart.ts (already exists — verify interface match)
  mailcow.ts
  mailu.ts
  miab.ts

STEP 5 — Tier 3 adapters
  postfix.ts (+ iredmail alias)
  haraka.ts
  maddy.ts (alias of postfix — log format identical)

STEP 6 — Tier 4 adapters
  resend.ts
  postmark.ts
  mailgun.ts
  sendgrid.ts
  ses.ts
  google.ts

STEP 7 — Webhook endpoints
  /api/webhooks/stalwart-delivery (already exists — verify)
  /api/webhooks/resend
  /api/webhooks/postmark
  /api/webhooks/mailgun
  /api/webhooks/sendgrid
  /api/webhooks/sendgrid-inbound
  /api/webhooks/ses

  All webhooks: verify signature first, then route to
  handleDeliveryEvent() or handleDeliverabilityTestEmail()

STEP 8 — tRPC integrations router
  Full router from spec above

STEP 9 — Cron jobs
  Every 60s: pullStatsForAllIntegrations()
    Calls getStats() on all enabled API-based integrations
    Stores in integrationSnapshots
  Every 5m: checkAuthFailures() for Tier 1 + Postfix
  Every 1h: aggregateRecipientDomainStats()

STEP 10 — /settings/integrations page
  Integration list with status badges
  Add integration modal (type picker → config form → domain assign)
  Test connection button in modal

STEP 11 — Per-domain integration widget
  Add to domain detail Overview tab
  Shows connected integrations with live stats

STEP 12 — Update deliverability inbox config
  Update deliverabilityInboxConfig to use integration ID
  instead of stalwartIntegrationId (now generic)
  Update deliverability wizard to show all integrations
  that support relay_inbox capability

tsc --noEmit after each step.
Never log decrypted config values.
All API keys stored encrypted — use encryptConfig() always.
```
