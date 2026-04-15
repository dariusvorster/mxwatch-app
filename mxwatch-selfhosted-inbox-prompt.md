# MxWatch — Self-Hosted Deliverability Inbox
## Paste into Claude Code in /Users/dariusvorster/Projects/Mxwatch-app

---

Add full self-hosted deliverability testing support to MxWatch.
Self-hosted users get three inbox modes. Cloud users continue
using the existing *@inbox.mxwatch.app flow unchanged.

Read this entire prompt before writing any code.
Build in phase order. Confirm after each phase.

---

## Overview

Three inbox modes for self-hosted:

```
Mode 1 — Own domain inbox
  User owns a domain and has port 25 reachable
  MxWatch SMTP listener accepts *@<their-test-domain>
  Full automated scoring from received headers
  Example: test@mail-test.homelabza.com

Mode 2 — Stalwart relay
  User has Stalwart configured in MxWatch
  MxWatch creates a catchall route on Stalwart via API
  Stalwart receives → forwards to MxWatch webhook
  No additional port 25 needed
  Example: test-uuid@homelabza.com → Stalwart → MxWatch

Mode 3 — Manual header paste
  User sends email, copies raw headers from their mail client
  Pastes into MxWatch header analyser
  MxWatch parses and scores
  Works with any setup, no infrastructure required
```

Cloud mode (unchanged):
  *@inbox.mxwatch.app — Hetzner CX22 port 25 open
  Works automatically, no user configuration needed

---

# PHASE 1 — DATABASE SCHEMA

Add to packages/db/schema.ts:

```typescript
// ── Deliverability inbox configuration ────────────────────────
export const deliverabilityInboxConfig = sqliteTable(
  'deliverability_inbox_config', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id).notNull(),

  mode: text('mode').notNull(),
  // 'own_domain' | 'stalwart_relay' | 'manual' | 'cloud'

  // Mode 1 — own domain
  inboxDomain: text('inbox_domain'),
  // e.g. "mail-test.homelabza.com"
  // MxWatch accepts *@inboxDomain on its SMTP listener

  // Mode 2 — Stalwart relay
  stalwartIntegrationId: text('stalwart_integration_id'),
  // References the Stalwart integration in stalwartIntegrations table
  stalwartCatchallAddress: text('stalwart_catchall_address'),
  // e.g. "mxwatch-test@homelabza.com" — the catchall route created
  webhookSecret: text('webhook_secret'),
  // HMAC secret for Stalwart → MxWatch webhook

  // Setup state
  verified: integer('verified', { mode: 'boolean' }).default(false),
  verifiedAt: integer('verified_at', { mode: 'timestamp' }),
  setupStep: integer('setup_step').default(0),
  // 0=not started 1=mode selected 2=configured 3=verified

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

// ── Deliverability tests ───────────────────────────────────────
// Update existing deliverabilityTests table to add:
// inboxMode: text — which mode was used
// rawHeaders: text — full headers (for manual mode + debugging)
// receivedAt: integer — when email arrived (null until received)
// expiresAt: integer — test address expires after 10 minutes
// analysisSource: text — 'headers' | 'manual_paste'
```

Run: pnpm db:migrate
Verify: pnpm db:studio

**Confirm: Phase 1 complete.**

---

# PHASE 2 — SMTP LISTENER UPDATES

The existing SMTP listener on port 2525 handles DMARC reports.
Extend it to also accept deliverability test emails.

## 2a — Multi-domain acceptance

Update the SMTP listener to accept mail for:
1. The configured DMARC report address (existing)
2. `*@inbox.mxwatch.app` (cloud — existing)
3. Any `inboxDomain` configured by self-hosted users (new)

```typescript
// packages/monitors/src/smtp-listener.ts

// In the onRcptTo handler — accept or reject based on recipient:
server.onRcptTo = async (address, session, callback) => {
  const to = address.address.toLowerCase()

  // Always accept DMARC report addresses
  if (to.startsWith('dmarc@')) {
    return callback()
  }

  // Cloud: accept *@inbox.mxwatch.app
  if (to.endsWith('@inbox.mxwatch.app')) {
    return callback()
  }

  // Self-hosted: accept *@<configured inbox domains>
  const configuredDomains = await getConfiguredInboxDomains()
  // Returns array of all inboxDomain values from
  // deliverabilityInboxConfig where mode = 'own_domain'
  const recipientDomain = to.split('@')[1]
  if (configuredDomains.includes(recipientDomain)) {
    return callback()
  }

  // Reject everything else
  return callback(new Error('Unknown recipient'))
}
```

## 2b — Route incoming mail to correct handler

```typescript
// In the onData handler — after receiving full message:
server.onData = async (stream, session, callback) => {
  const rawEmail = await streamToString(stream)
  const parsed = await simpleParser(rawEmail)
  const to = session.envelope.rcptTo[0]?.address?.toLowerCase()

  if (!to) return callback()

  // Route 1: DMARC report
  if (to.startsWith('dmarc@')) {
    await handleDMARCReport(rawEmail, parsed)
    return callback()
  }

  // Route 2: Deliverability test (cloud or own-domain mode)
  if (to.endsWith('@inbox.mxwatch.app') || isConfiguredInboxAddress(to)) {
    await handleDeliverabilityTestEmail(rawEmail, parsed, to)
    return callback()
  }

  callback()
}
```

## 2c — Deliverability test email handler

```typescript
// packages/monitors/src/deliverability-handler.ts

export async function handleDeliverabilityTestEmail(
  rawEmail: string,
  parsed: ParsedMail,
  to: string,
): Promise<void> {

  // Extract UUID from the local part of the address
  // e.g. test-a7f3k9x2@inbox.mxwatch.app → a7f3k9x2
  const localPart = to.split('@')[0]
  const uuidMatch = localPart.match(/test-([a-z0-9]+)$/)
  if (!uuidMatch) {
    logger.warn('delivery', 'Deliverability test email has no UUID', { to })
    return
  }

  const testId = uuidMatch[1]

  // Find the pending test
  const test = await db.query.deliverabilityTests.findFirst({
    where: and(
      eq(deliverabilityTests.testId, testId),
      eq(deliverabilityTests.status, 'pending'),
      gt(deliverabilityTests.expiresAt, new Date()),
    ),
  })

  if (!test) {
    logger.warn('delivery', 'No pending test found for UUID', { testId, to })
    return
  }

  // Score the email from headers
  const score = await scoreDeliverabilityFromHeaders(parsed, rawEmail)

  // Update test record
  await db.update(deliverabilityTests).set({
    status: 'analyzed',
    score: score.total,
    results: JSON.stringify(score.breakdown),
    rawHeaders: parsed.headers.toString(),
    receivedAt: new Date(),
    analysisSource: 'headers',
  }).where(eq(deliverabilityTests.id, test.id))

  logger.info('delivery', 'Deliverability test scored', {
    testId,
    domain: test.domain,
    score: score.total,
  })
}
```

## 2d — Header scoring engine

```typescript
// packages/monitors/src/deliverability-scorer.ts

export interface DeliverabilityScore {
  total: number  // 0.0 - 10.0
  breakdown: {
    spf:          { pass: boolean; score: number; detail: string }
    dkim:         { pass: boolean; score: number; detail: string }
    dmarc:        { pass: boolean; score: number; detail: string }
    reverseDns:   { pass: boolean; score: number; detail: string }
    rbl:          { pass: boolean; score: number; detail: string; listed?: string[] }
    helo:         { pass: boolean; score: number; detail: string }
    tlsUsed:      { pass: boolean; score: number; detail: string }
    subjectClean: { pass: boolean; score: number; detail: string }
    bodyBalance:  { pass: boolean; score: number; detail: string }
  }
  sendingIp: string
  sendingHost: string
  deliveryPath: string[]
  rawScore: number
  fixes: string[]  // actionable suggestions for failed checks
}

export async function scoreDeliverabilityFromHeaders(
  parsed: ParsedMail,
  rawEmail: string,
): Promise<DeliverabilityScore> {

  const fixes: string[] = []
  let rawScore = 0

  // ── Extract sending IP from Received headers ──────────────────
  const receivedHeaders = parsed.headers.get('received') as string[] ?? []
  const sendingIp = extractSendingIP(receivedHeaders)
  const sendingHost = extractSendingHost(receivedHeaders)
  const deliveryPath = extractDeliveryPath(receivedHeaders)

  // ── SPF ───────────────────────────────────────────────────────
  const authResults = parsed.headers.get('authentication-results') as string ?? ''
  const spfResult = parseAuthResult(authResults, 'spf')
  const spfPass = spfResult === 'pass'
  if (spfPass) rawScore += 1.5
  else fixes.push('SPF check failed. Verify your SPF record includes your sending IP.')

  // ── DKIM ──────────────────────────────────────────────────────
  const dkimResult = parseAuthResult(authResults, 'dkim')
  const dkimPass = dkimResult === 'pass'
  if (dkimPass) rawScore += 1.5
  else fixes.push('DKIM signature missing or invalid. Check your DKIM selector and key.')

  // ── DMARC ─────────────────────────────────────────────────────
  const dmarcResult = parseAuthResult(authResults, 'dmarc')
  const dmarcPass = dmarcResult === 'pass'
  if (dmarcPass) rawScore += 1.0
  else fixes.push('DMARC failed. Ensure SPF and DKIM both align with your From domain.')

  // ── Reverse DNS ───────────────────────────────────────────────
  let ptrMatch = false
  if (sendingIp) {
    try {
      const ptrs = await dns.promises.reverse(sendingIp)
      ptrMatch = ptrs.some(ptr =>
        ptr.toLowerCase().includes(sendingHost.toLowerCase().split('.')[0])
      )
      if (ptrMatch) rawScore += 1.0
      else fixes.push(`Reverse DNS mismatch. PTR record for ${sendingIp} should match your mail hostname.`)
    } catch {
      fixes.push(`No reverse DNS (PTR) record found for ${sendingIp}. Add one via your VPS provider.`)
    }
  }

  // ── RBL check ─────────────────────────────────────────────────
  let rblClean = true
  const listedOn: string[] = []
  if (sendingIp) {
    for (const rbl of BLACKLISTS) {
      try {
        const result = await checkRBL(sendingIp, rbl)
        if (result.listed) {
          rblClean = false
          listedOn.push(rbl.name)
        }
      } catch { /* ignore RBL timeout during scoring */ }
    }
    if (rblClean) rawScore += 2.0
    else fixes.push(`Your IP is listed on: ${listedOn.join(', ')}. Request delist immediately.`)
  }

  // ── TLS used ──────────────────────────────────────────────────
  const tlsUsed = rawEmail.toLowerCase().includes('tls') ||
    receivedHeaders.some(h => h.toLowerCase().includes('tls'))
  if (tlsUsed) rawScore += 0.5
  else fixes.push('Email was not delivered over TLS. Enable STARTTLS on your mail server.')

  // ── HELO/EHLO hostname valid ──────────────────────────────────
  const heloValid = sendingHost.includes('.') && !sendingHost.match(/^\d+\.\d+\.\d+\.\d+$/)
  if (heloValid) rawScore += 0.5
  else fixes.push('HELO/EHLO hostname should be a valid FQDN, not an IP address.')

  // ── Subject not spammy ────────────────────────────────────────
  const subject = parsed.subject ?? ''
  const spammySubject = /FREE|URGENT|WINNER|CLICK NOW|ACT NOW|\$\$\$/i.test(subject)
  const subjectClean = !spammySubject
  if (subjectClean) rawScore += 0.5
  else fixes.push('Subject line contains spam trigger words.')

  // ── HTML/text balance ─────────────────────────────────────────
  const hasText = !!parsed.text?.trim()
  const hasHtml = !!parsed.html?.trim()
  const bodyBalance = hasText || !hasHtml  // text-only is fine, html-only is not
  if (bodyBalance) rawScore += 0.5
  else fixes.push('HTML-only emails score lower. Add a plain text alternative.')

  // ── Final score (0-10) ────────────────────────────────────────
  const total = Math.min(10, Math.round(rawScore * 10) / 10)

  return {
    total,
    breakdown: {
      spf:          { pass: spfPass, score: spfPass ? 1.5 : 0,
                      detail: spfResult ?? 'not found' },
      dkim:         { pass: dkimPass, score: dkimPass ? 1.5 : 0,
                      detail: dkimResult ?? 'not found' },
      dmarc:        { pass: dmarcPass, score: dmarcPass ? 1.0 : 0,
                      detail: dmarcResult ?? 'not found' },
      reverseDns:   { pass: ptrMatch, score: ptrMatch ? 1.0 : 0,
                      detail: ptrMatch ? 'PTR matches hostname' : 'no match' },
      rbl:          { pass: rblClean, score: rblClean ? 2.0 : 0,
                      detail: rblClean ? '8/8 clean' : `listed on ${listedOn.length}`,
                      listed: listedOn },
      tlsUsed:      { pass: tlsUsed, score: tlsUsed ? 0.5 : 0,
                      detail: tlsUsed ? 'STARTTLS detected' : 'no TLS' },
      helo:         { pass: heloValid, score: heloValid ? 0.5 : 0,
                      detail: sendingHost },
      subjectClean: { pass: subjectClean, score: subjectClean ? 0.5 : 0,
                      detail: subject || '(no subject)' },
      bodyBalance:  { pass: bodyBalance, score: bodyBalance ? 0.5 : 0,
                      detail: hasText && hasHtml ? 'text + html'
                            : hasText ? 'text only' : 'html only' },
    },
    sendingIp: sendingIp ?? 'unknown',
    sendingHost: sendingHost ?? 'unknown',
    deliveryPath,
    rawScore,
    fixes,
  }
}

// ── Manual paste scoring ──────────────────────────────────────
// Same function — just pass the pasted headers as the raw email
export async function scoreFromHeaderPaste(
  headersPaste: string,
): Promise<DeliverabilityScore> {
  // Parse as if it were a full email
  // simpleParser handles header-only input gracefully
  const parsed = await simpleParser(headersPaste)
  return scoreDeliverabilityFromHeaders(parsed, headersPaste)
}
```

**Confirm: Phase 2 complete. SMTP listener routes correctly.**

---

# PHASE 3 — MODE 2: STALWART RELAY

When the user has Stalwart configured, MxWatch can create a
catchall route on Stalwart and receive forwarded emails via webhook.

## 3a — Stalwart catchall setup

```typescript
// packages/monitors/src/stalwart-relay.ts

export async function setupStalwartCatchall(
  integrationId: string,
  webhookSecret: string,
  mxwatchWebhookUrl: string,  // e.g. https://mxwatch.homelabza.com/api/webhooks/stalwart-delivery
): Promise<{ catchallAddress: string }> {

  const config = await getIntegrationConfig(integrationId)
  const client = new StalwartClient(config.baseUrl, config.apiToken)

  // Create a sieve script on Stalwart that:
  // 1. Matches any email to mxwatch-test-*@<domain>
  // 2. POSTs the raw email to MxWatch webhook
  // 3. Discards the message (don't store it in Stalwart)

  const sieveScript = `
require ["vnd.stalwart.http"];

if address :contains "to" "mxwatch-test-" {
  http :method "POST"
       :url "${mxwatchWebhookUrl}"
       :header "X-Webhook-Secret: ${webhookSecret}"
       :header "Content-Type: message/rfc822"
       :body "raw";
  discard;
}
`

  await client.createSieveScript('mxwatch-deliverability', sieveScript)

  // The catchall address pattern — user sends to any of these:
  // mxwatch-test-<uuid>@<their-domain>
  const domain = config.baseUrl.replace('https://', '').replace('http://', '')
  const catchallAddress = `mxwatch-test-*@${domain}`

  return { catchallAddress }
}
```

## 3b — Stalwart webhook endpoint

```typescript
// apps/web/app/api/webhooks/stalwart-delivery/route.ts

export async function POST(req: Request) {
  // Verify webhook secret
  const secret = req.headers.get('x-webhook-secret')
  const config = await db.query.deliverabilityInboxConfig.findFirst({
    where: eq(deliverabilityInboxConfig.mode, 'stalwart_relay'),
  })

  if (!config || secret !== config.webhookSecret) {
    return new Response('Unauthorized', { status: 401 })
  }

  const rawEmail = await req.text()
  const parsed = await simpleParser(rawEmail)

  // Route to deliverability handler — same as SMTP listener
  const to = parsed.headers.get('to') as string ?? ''
  await handleDeliverabilityTestEmail(rawEmail, parsed, to)

  return new Response('OK', { status: 200 })
}
```

**Confirm: Phase 3 complete. Stalwart relay works.**

---

# PHASE 4 — MODE 3: MANUAL HEADER PASTE

Simplest mode — no infrastructure needed.

## 4a — tRPC mutation for manual scoring

```typescript
// Add to deliverability tRPC router:
analyseHeaders: authedProcedure
  .input(z.object({
    domainId: z.string(),
    headersPaste: z.string().min(50).max(50000),
  }))
  .mutation(async ({ ctx, input }) => {
    // Verify domain belongs to user
    const domain = await getDomain(input.domainId, ctx.user.id)
    if (!domain) throw new TRPCError({ code: 'NOT_FOUND' })

    // Score from the pasted headers
    const score = await scoreFromHeaderPaste(input.headersPaste)

    // Store as a completed test
    const testId = nanoid()
    await db.insert(deliverabilityTests).values({
      id: testId,
      domainId: input.domainId,
      userId: ctx.user.id,
      mode: 'manual',
      status: 'analyzed',
      score: score.total,
      results: JSON.stringify(score.breakdown),
      rawHeaders: input.headersPaste,
      receivedAt: new Date(),
      analysisSource: 'manual_paste',
      createdAt: new Date(),
    })

    logger.info('delivery', 'Manual header analysis complete', {
      domainId: input.domainId,
      score: score.total,
    })

    return { testId, score }
  }),
```

**Confirm: Phase 4 complete. Manual paste scoring works.**

---

# PHASE 5 — INBOX SETUP WIZARD

First-time wizard shown when user first visits the
deliverability test page on a self-hosted instance.
(Cloud users skip this — they already have inbox.mxwatch.app)

## 5a — Wizard trigger logic

```typescript
// In the deliverability test page:
// If MXWATCH_CLOUD !== '1' AND no inboxConfig exists:
//   Show wizard instead of test UI
// If inboxConfig exists AND verified:
//   Show test UI directly
// If inboxConfig exists AND NOT verified:
//   Show "complete setup" prompt
```

## 5b — Wizard UI (3 steps)

```
Step 1 — Choose your inbox mode

  How would you like to receive test emails?

  ┌─────────────────────────────────────────────────────────┐
  │ ● Own domain inbox              RECOMMENDED             │
  │   You have a domain and port 25 reachable               │
  │   Example: test@mail-test.homelabza.com                 │
  │   Full automated scoring · No extra software            │
  └─────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────┐
  │ ○ Stalwart relay                                        │
  │   You have Stalwart configured in MxWatch               │
  │   MxWatch creates a route on your Stalwart              │
  │   Full automated scoring · Requires Stalwart API        │
  └─────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────┐
  │ ○ Manual header paste           ALWAYS WORKS            │
  │   Send a test email, copy the raw headers               │
  │   Paste them here for analysis                          │
  │   No infrastructure needed · Less automated             │
  └─────────────────────────────────────────────────────────┘

  [Next →]

─────────────────────────────────────────────────────────────

Step 2a — Own domain inbox configuration

  Test inbox domain:
  [mail-test.homelabza.com________________]

  MxWatch will accept test emails for *@mail-test.homelabza.com

  Add this DNS record to your domain:
  ┌─────────────────────────────────────────────────────────┐
  │ Type  Name                    Value                     │
  │ MX    mail-test.homelabza.com  10 mxwatch.homelabza.com │
  └─────────────────────────────────────────────────────────┘
  [Copy record]

  Make sure port 25 is reachable at mxwatch.homelabza.com

  [← Back]  [Verify DNS →]
    (polls DNS every 5s for up to 2 minutes)

─────────────────────────────────────────────────────────────

Step 2b — Stalwart relay configuration

  Select Stalwart integration:
  [homelab-stalwart (mail.homelabza.com) ▾]

  MxWatch will:
  1. Create a Sieve script on your Stalwart
  2. Any email to mxwatch-test-*@homelabza.com will be
     forwarded to MxWatch automatically

  [← Back]  [Create route →]

─────────────────────────────────────────────────────────────

Step 2c — Manual paste (no configuration needed)

  No setup required. When running a deliverability test,
  MxWatch will give you instructions on how to copy
  your email headers for analysis.

  [← Back]  [Finish →]

─────────────────────────────────────────────────────────────

Step 3 — Verify (own domain + Stalwart modes only)

  Send a test email to verify everything works:

  Send any email to:
  test-verify@mail-test.homelabza.com
  [Copy address]

  Waiting for email...  ⟳ (polling every 3s)

  ✓ Email received!
  ✓ SPF: pass
  ✓ DKIM: pass
  ✓ Score: 9.5/10

  Your inbox is configured and working.
  [Go to deliverability tests →]
```

## 5c — tRPC wizard routes

```typescript
inboxSetup: router({
  getConfig: authedProcedure.query(async ({ ctx }) => {
    return db.query.deliverabilityInboxConfig.findFirst({
      where: eq(deliverabilityInboxConfig.userId, ctx.user.id),
    })
  }),

  configure: authedProcedure
    .input(z.discriminatedUnion('mode', [
      z.object({
        mode: z.literal('own_domain'),
        inboxDomain: z.string().min(3),
      }),
      z.object({
        mode: z.literal('stalwart_relay'),
        stalwartIntegrationId: z.string(),
      }),
      z.object({
        mode: z.literal('manual'),
      }),
    ]))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.query.deliverabilityInboxConfig.findFirst({
        where: eq(deliverabilityInboxConfig.userId, ctx.user.id),
      })

      if (input.mode === 'own_domain') {
        await upsertInboxConfig(ctx.user.id, {
          mode: 'own_domain',
          inboxDomain: input.inboxDomain,
          setupStep: 2,
        })
        // Return DNS records for user to add
        return {
          dnsRecords: [{
            type: 'MX',
            name: input.inboxDomain,
            value: `10 ${getAppHostname()}`,
          }]
        }
      }

      if (input.mode === 'stalwart_relay') {
        const webhookSecret = generateRandomHex(32)
        const webhookUrl = `${getAppUrl()}/api/webhooks/stalwart-delivery`
        const { catchallAddress } = await setupStalwartCatchall(
          input.stalwartIntegrationId,
          webhookSecret,
          webhookUrl,
        )
        await upsertInboxConfig(ctx.user.id, {
          mode: 'stalwart_relay',
          stalwartIntegrationId: input.stalwartIntegrationId,
          stalwartCatchallAddress: catchallAddress,
          webhookSecret,
          setupStep: 2,
        })
        return { catchallAddress }
      }

      if (input.mode === 'manual') {
        await upsertInboxConfig(ctx.user.id, {
          mode: 'manual',
          verified: true,
          verifiedAt: new Date(),
          setupStep: 3,
        })
        return {}
      }
    }),

  verifyDns: authedProcedure
    .input(z.object({ domain: z.string() }))
    .query(async ({ input }) => {
      // Check if MX record is pointing to this MxWatch instance
      try {
        const mxRecords = await dns.promises.resolveMx(input.domain)
        const appHostname = getAppHostname()
        const found = mxRecords.some(mx =>
          mx.exchange.toLowerCase() === appHostname.toLowerCase()
        )
        return { propagated: found, mxRecords }
      } catch {
        return { propagated: false, mxRecords: [] }
      }
    }),

  markVerified: authedProcedure.mutation(async ({ ctx }) => {
    await db.update(deliverabilityInboxConfig).set({
      verified: true,
      verifiedAt: new Date(),
      setupStep: 3,
    }).where(eq(deliverabilityInboxConfig.userId, ctx.user.id))
  }),
}),
```

**Confirm: Phase 5 complete. Wizard works end-to-end.**

---

# PHASE 6 — DELIVERABILITY TEST UI UPDATES

Update the existing deliverability test UI to support all modes.

## 6a — Test creation flow

```typescript
// When user clicks "Run deliverability test":

if (inboxConfig.mode === 'own_domain' || inboxConfig.mode === 'cloud') {
  // Generate unique test address
  const uuid = nanoid(8).toLowerCase()
  const testAddress = inboxConfig.mode === 'cloud'
    ? `test-${uuid}@inbox.mxwatch.app`
    : `test-${uuid}@${inboxConfig.inboxDomain}`

  // Create pending test record
  await createPendingTest(testAddress, 'auto')

  // Show: "Send any email to test-abc123@mail-test.homelabza.com"
  // Poll every 3s for up to 10 minutes
}

if (inboxConfig.mode === 'stalwart_relay') {
  const uuid = nanoid(8).toLowerCase()
  // Use Stalwart catchall domain
  const domain = inboxConfig.stalwartCatchallAddress.split('@')[1]
  const testAddress = `mxwatch-test-${uuid}@${domain}`

  await createPendingTest(testAddress, 'stalwart_relay')

  // Show: "Send any email to mxwatch-test-abc123@homelabza.com"
  // Poll every 3s for up to 10 minutes
}

if (inboxConfig.mode === 'manual') {
  // Skip straight to paste UI — no pending test needed
  // Show textarea for header paste
}
```

## 6b — Manual paste UI

```
Run deliverability test — Manual mode

Step 1: Send a test email
  Send any email from darius@homelabza.com to any address
  (even to yourself)

Step 2: Get the raw headers
  Gmail:    Open email → ⋮ menu → "Show original" → Copy headers
  Outlook:  File → Properties → copy from "Internet headers"
  Apple Mail: View → Message → All Headers → select all + copy
  Thunderbird: View → Headers → All → right-click → Copy

Step 3: Paste headers below

  ┌───────────────────────────────────────────────────────────┐
  │ Received: from mail.homelabza.com...                      │
  │ Authentication-Results: mx.google.com;                    │
  │    dkim=pass header.i=@homelabza.com...                   │
  │ ...                                                       │
  │                                                           │
  │ [paste full headers here]                                 │
  └───────────────────────────────────────────────────────────┘

  [Analyse headers →]
```

## 6c — Results UI (same for all modes)

```
Deliverability score: 9.5 / 10        ● Excellent

┌─ Authentication ──────────────────────────────────────────────┐
│ ✓ SPF      pass    ip4:23.95.170.217 in SPF record    +1.5   │
│ ✓ DKIM     pass    mail._domainkey.homelabza.com       +1.5   │
│ ✓ DMARC    pass    p=reject aligned                    +1.0   │
└───────────────────────────────────────────────────────────────┘

┌─ Infrastructure ───────────────────────────────────────────────┐
│ ✓ Reverse DNS    mail.homelabza.com → 23.95.170.217   +1.0   │
│ ✓ RBL status     8/8 blacklists clean                 +2.0   │
│ ✓ TLS            STARTTLS (TLS 1.3)                   +0.5   │
│ ✓ HELO           mail.homelabza.com (valid FQDN)      +0.5   │
└───────────────────────────────────────────────────────────────┘

┌─ Content ──────────────────────────────────────────────────────┐
│ ✓ Subject        No spam triggers detected            +0.5   │
│ ✗ HTML/Text      HTML only — no plain text part        +0.0   │
│                  Fix: Add plain text alternative              │
└───────────────────────────────────────────────────────────────┘

┌─ Delivery path ────────────────────────────────────────────────┐
│ Stalwart (192.168.69.12)                                      │
│ → WireGuard tunnel                                            │
│ → RackNerd VPS (23.95.170.217)                               │
│ → Internet                                                    │
│ → MxWatch inbox (received in 1.2s)                           │
└───────────────────────────────────────────────────────────────┘

1 issue found:
⚠ Add a plain text version to your emails to improve
  deliverability to strict spam filters.

[Run again]  [View raw headers]  [History]
```

**Confirm: Phase 6 complete. All modes work in UI.**

---

# PHASE 7 — /settings/deliverability PAGE

For users who want to change their inbox mode after initial setup.

```
/settings/deliverability

── Inbox configuration ─────────────────────────────────────────

Current mode: Own domain inbox
Inbox domain: mail-test.homelabza.com
Status: ✓ Verified (April 14, 2026)

[Change mode]  [Re-verify]

── Test history ────────────────────────────────────────────────

April 15  9.5/10  homelabza.com   own domain
April 14  8.0/10  gitbay.dev      stalwart relay
April 12  7.5/10  homelabza.com   manual paste

[View all tests]
```

---

# PHASE 8 — README AND DOCS UPDATE

Scan the entire codebase for cloud-only references to
deliverability testing and update them.

Files to scan:
- README.md
- CLAUDE.md
- Any file in /docs
- Any inline documentation comments mentioning deliverability
- The .env.example file

Changes to make:

1. README.md — find any section describing deliverability testing
   Remove: references to inbox.mxwatch.app being required
   Remove: references to cloud-only for deliverability
   Add: description of all three self-hosted modes
   Add: brief setup instructions for own-domain mode

2. CLAUDE.md — update deliverability test description:
   Remove: "requires cloud deployment" or similar
   Add: "works self-hosted via own domain, Stalwart relay, or manual paste"

3. .env.example — add new env vars:
```env
# Deliverability inbox (self-hosted)
# Leave empty to use manual paste mode
# Set to your test domain for own-domain mode
MXWATCH_INBOX_DOMAIN=

# App hostname (used for DNS record generation in wizard)
# Set to the public hostname of your MxWatch instance
MXWATCH_APP_HOSTNAME=mxwatch.homelabza.com
MXWATCH_APP_URL=https://mxwatch.homelabza.com
```

4. Do NOT mention inbox.mxwatch.app, Hetzner, or cloud
   infrastructure in any docs. Those are internal implementation
   details, not user-facing information.

**Confirm: Phase 8 complete. No cloud-only references remain.**

---

# PHASE 9 — DOCKER COMPOSE UPDATE

```yaml
# docker-compose.yml
services:
  mxwatch:
    ports:
      - "3000:3000"
      - "25:2525"    # Map host port 25 to SMTP listener
                     # Required for own-domain inbox mode
                     # Optional — remove if port 25 not available
      - "2525:2525"  # Also expose 2525 directly if preferred
    environment:
      - MXWATCH_INBOX_DOMAIN=${MXWATCH_INBOX_DOMAIN:-}
      - MXWATCH_APP_HOSTNAME=${MXWATCH_APP_HOSTNAME:-localhost}
      - MXWATCH_APP_URL=${MXWATCH_APP_URL:-http://localhost:3000}
```

Add comment to docker-compose.yml:
```yaml
# Port 25 mapping is OPTIONAL.
# Required only if using own-domain inbox mode for deliverability testing.
# If your host blocks port 25 (most residential ISPs do),
# use Stalwart relay mode or manual paste mode instead.
# Remove the "- 25:2525" line if not needed.
```

**Confirm: Phase 9 complete.**

---

# FINAL CHECKS

1. tsc --noEmit — zero errors
2. Test Mode 1 (own domain):
   - Configure inbox domain in wizard
   - Add MX record → verify DNS check passes
   - Send test email → received + scored
3. Test Mode 2 (Stalwart relay):
   - Select Stalwart integration in wizard
   - Verify Sieve script created on Stalwart
   - Send test email to catchall address → scored
4. Test Mode 3 (manual paste):
   - Skip wizard → paste headers → scored correctly
   - Score matches expected values for known-good headers
5. Test cloud mode unchanged:
   - MXWATCH_CLOUD=1 → wizard not shown
   - inbox.mxwatch.app flow works as before
6. Verify README has no cloud-only deliverability references
7. Verify .env.example has new vars documented

---

# IMPORTANT NOTES

- Never mention inbox.mxwatch.app, Hetzner, or cloud infrastructure
  in any user-facing text, README, or documentation
- MXWATCH_APP_HOSTNAME is critical for generating correct DNS
  records in the wizard — must reflect the actual public hostname
- The Stalwart Sieve script webhook sends raw RFC822 email —
  handle Content-Type: message/rfc822 in the webhook endpoint
- Manual paste accepts headers-only or full email source —
  simpleParser handles both gracefully
- All three modes produce identical score output — same UI,
  same breakdown, same fix suggestions
- Port 25 mapping in Docker is optional and clearly commented
  as such — don't make it appear required
