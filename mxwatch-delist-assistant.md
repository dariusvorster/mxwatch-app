# MxWatch — RBL Delist Assistant
## Version: 1.0 | April 2026
## Claude Code prompt at bottom — read spec first

---

## Overview

When an IP or domain is listed on a blacklist, MxWatch guides
the user through the delist process with a step-by-step wizard,
pre-filled forms, and status tracking.

Free tier: wizard + delist links + explanations + status tracking
Cloud tier: AI-drafted delist request email/form text

---

## RBL Knowledge Base

Each RBL has a known delist process. This is the source of truth
for the wizard. Add new RBLs here as they are encountered.

```typescript
// packages/monitors/src/delist/rbl-knowledge.ts

export interface RBLKnowledge {
  name: string
  shortName: string              // used in code
  type: 'ip' | 'domain' | 'both'
  listingReasons: string[]       // why IPs/domains get listed here
  delistMethod: DelistMethod
  delistUrl?: string             // direct link to delist form
  delistEmail?: string           // email address for delist requests
  typicalClearTime: string       // human readable e.g. "24-48 hours"
  autoExpires: boolean           // does it clear automatically?
  autoExpireHours?: number       // if autoExpires, how long?
  requiresExplanation: boolean   // does delist form need a reason?
  severityNote: string           // what this listing means in plain English
  preventionTips: string[]       // how to avoid getting listed again
}

export type DelistMethod =
  | 'self_service_form'    // fill out a form, usually instant
  | 'email_request'        // send an email, manual review
  | 'auto_expires'         // nothing to do, just wait
  | 'reputation_based'     // improves automatically over time
  | 'portal_registration'  // register at a portal first
  | 'manual_review'        // reviewed by humans, takes days

export const RBL_KNOWLEDGE: Record<string, RBLKnowledge> = {

  'spamhaus-zen': {
    name: 'Spamhaus ZEN',
    shortName: 'spamhaus-zen',
    type: 'ip',
    listingReasons: [
      'IP is a residential/dynamic IP (PBL)',
      'IP has been used to send spam (SBL)',
      'IP is an open proxy or compromised host (XBL)',
    ],
    delistMethod: 'self_service_form',
    delistUrl: 'https://www.spamhaus.org/lookup/',
    typicalClearTime: 'Instant (PBL) or 1-5 days (SBL)',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'Spamhaus ZEN is checked by most major mail providers. A listing here will cause significant delivery failures to Gmail, Outlook, Yahoo, and others.',
    preventionTips: [
      'Use a static, dedicated IP for sending mail',
      'Ensure your IP is not a residential/dynamic IP',
      'Monitor for signs of server compromise',
      'Keep sending volume consistent — spikes trigger automated listings',
    ],
  },

  'spamhaus-dbl': {
    name: 'Spamhaus DBL',
    shortName: 'spamhaus-dbl',
    type: 'domain',
    listingReasons: [
      'Domain found in spam message bodies',
      'Domain used in phishing campaigns',
      'Domain associated with malware distribution',
    ],
    delistMethod: 'self_service_form',
    delistUrl: 'https://www.spamhaus.org/dbl/removal/',
    typicalClearTime: '1-5 business days',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'Spamhaus DBL lists domains found in spam. If your domain is listed here, recipients using Spamhaus-based filtering will reject or filter emails containing your domain.',
    preventionTips: [
      'Ensure your domain is not being used by third parties in spam',
      'Check for compromised accounts sending spam',
      'Monitor DMARC reports for unauthorized senders',
    ],
  },

  'barracuda': {
    name: 'Barracuda',
    shortName: 'barracuda',
    type: 'ip',
    listingReasons: [
      'Spam reports from Barracuda appliance users',
      'High volume sending from this IP',
      'Poor sending reputation score',
    ],
    delistMethod: 'self_service_form',
    delistUrl: 'https://www.barracudacentral.org/rbl/removal-request',
    typicalClearTime: 'Usually instant',
    autoExpires: false,
    requiresExplanation: false,
    severityNote: 'Barracuda is used by many corporate email gateways. A listing here will affect delivery to businesses using Barracuda hardware or cloud filtering.',
    preventionTips: [
      'Ensure all recipients have opted in to your emails',
      'Honor unsubscribe requests immediately',
      'Maintain a low spam complaint rate (< 0.1%)',
    ],
  },

  'sorbs': {
    name: 'SORBS',
    shortName: 'sorbs',
    type: 'ip',
    listingReasons: [
      'Open relay detected',
      'Spam sent from this IP',
      'Dynamic/residential IP in DUHL zone',
    ],
    delistMethod: 'self_service_form',
    delistUrl: 'https://www.sorbs.net/lookup.shtml',
    typicalClearTime: '24-72 hours',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'SORBS maintains several zone lists. Your listing type determines the removal process. Dynamic IP listings require ISP certification.',
    preventionTips: [
      'Ensure your mail server is not an open relay',
      'Use a static business IP for mail sending',
      'Configure SMTP authentication correctly',
    ],
  },

  'spamcop': {
    name: 'SpamCop',
    shortName: 'spamcop',
    type: 'ip',
    listingReasons: [
      'User spam reports submitted to SpamCop',
      'Automated spam trap hits',
    ],
    delistMethod: 'auto_expires',
    autoExpires: true,
    autoExpireHours: 24,
    typicalClearTime: '24-48 hours (auto-expires)',
    requiresExplanation: false,
    severityNote: 'SpamCop listings expire automatically if no new spam reports are received. No delist action needed — just ensure no more spam is sent from this IP.',
    preventionTips: [
      'SpamCop listings are report-driven — check for compromised accounts',
      'Review your mailing list for spam trap addresses',
      'Use double opt-in for all mailing list signups',
    ],
  },

  'spamrats': {
    name: 'Spamrats',
    shortName: 'spamrats',
    type: 'ip',
    listingReasons: [
      'IP sending spam without reverse DNS',
      'IP on dynamic/residential range',
      'Botnet activity detected',
    ],
    delistMethod: 'self_service_form',
    delistUrl: 'http://www.spamrats.com/removal.php',
    typicalClearTime: '24-48 hours',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'Spamrats focuses on IPs without proper rDNS. Ensure your PTR record is correctly configured before requesting removal.',
    preventionTips: [
      'Configure a proper PTR record for your sending IP',
      'PTR record should resolve back to your mail hostname',
      'Verify PTR with your VPS/hosting provider',
    ],
  },

  'mailspike': {
    name: 'Mailspike',
    shortName: 'mailspike',
    type: 'ip',
    listingReasons: [
      'Poor sending reputation score',
      'Spam reports from Mailspike network',
    ],
    delistMethod: 'reputation_based',
    typicalClearTime: '7-14 days (reputation improves automatically)',
    autoExpires: true,
    autoExpireHours: 336,  // 14 days
    requiresExplanation: false,
    severityNote: 'Mailspike uses a reputation scoring system. Listings improve automatically as you send clean email. No explicit delist process exists.',
    preventionTips: [
      'Send consistently low-volume, legitimate email',
      'Maintain low bounce and complaint rates',
      'Patience — reputation scores improve over time',
    ],
  },

  'invaluement-ivmsip': {
    name: 'Invaluement ivmSIP',
    shortName: 'invaluement-ivmsip',
    type: 'ip',
    listingReasons: [
      'IP associated with snowshoe spam',
      'IP sending high volumes of unsolicited email',
      'IP linked to known spam networks',
    ],
    delistMethod: 'email_request',
    delistEmail: 'delist@invaluement.com',
    typicalClearTime: '1-5 business days',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'Invaluement focuses on snowshoe spam. Listings require manual review. A well-written delist request explaining your sending practices significantly improves approval chances.',
    preventionTips: [
      'Keep sending volume low and consistent',
      'Avoid sending from many IPs simultaneously',
      'Ensure all email is solicited and expected by recipients',
    ],
  },

  'sem-backscatter': {
    name: 'SEM-BACKSCATTER',
    shortName: 'sem-backscatter',
    type: 'ip',
    listingReasons: [
      'Server sending backscatter (bounce messages to innocent parties)',
      'Open relay generating delivery failure notices',
    ],
    delistMethod: 'self_service_form',
    delistUrl: 'https://www.senderscore.org/',
    typicalClearTime: '24-72 hours',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'Backscatter occurs when your server sends bounce messages for emails it never originally sent. This is usually caused by misconfigured spam filtering.',
    preventionTips: [
      'Configure your mail server to reject spam at SMTP time, not after acceptance',
      'Never accept then bounce — reject at RCPT TO stage instead',
      'This prevents your server from becoming a backscatter source',
    ],
  },

  'uribl': {
    name: 'URIBL',
    shortName: 'uribl',
    type: 'domain',
    listingReasons: [
      'Domain found in spam message URLs',
      'Domain registered by known spammers',
    ],
    delistMethod: 'self_service_form',
    delistUrl: 'https://lookup.uribl.com/',
    typicalClearTime: '24-72 hours',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'URIBL lists domains that appear in spam URLs. If your domain is listed here, emails containing links to your domain will be flagged as spam.',
    preventionTips: [
      'Check if your domain registrar or IP range is on known spam lists',
      'Newly registered domains are at higher risk — allow a grace period',
      'Monitor who links to your domain in email campaigns',
    ],
  },

  'microsoft-snds': {
    name: 'Microsoft SNDS',
    shortName: 'microsoft-snds',
    type: 'ip',
    listingReasons: [
      'High spam complaint rate from Outlook/Hotmail users',
      'IP sending to Microsoft spam traps',
      'Poor sender reputation score with Microsoft',
    ],
    delistMethod: 'portal_registration',
    delistUrl: 'https://sendersupport.olc.protection.outlook.com/pm/delist.aspx',
    typicalClearTime: '24-48 hours',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'Microsoft SNDS blocks affect delivery to Outlook.com, Hotmail, and Live.com addresses. This covers a large portion of personal and business email.',
    preventionTips: [
      'Register at https://sendersupport.olc.protection.outlook.com/snds/',
      'Monitor your SNDS dashboard for complaint rates',
      'Keep spam complaint rate below 0.3% for Microsoft',
    ],
  },
}
```

---

## DB Schema

```typescript
// packages/db/schema.ts additions

export const delistRequests = sqliteTable('delist_requests', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id).notNull(),
  domainId: text('domain_id').references(() => domains.id).notNull(),

  // What's being delisted
  rblName: text('rbl_name').notNull(),      // e.g. 'spamhaus-zen'
  listedValue: text('listed_value').notNull(), // IP or domain
  listingType: text('listing_type').notNull(), // 'ip' | 'domain'

  // Delist status
  status: text('status').notNull().default('not_submitted'),
  // 'not_submitted'  — wizard started, not submitted yet
  // 'submitted'      — user has submitted the request
  // 'pending'        — submitted, still listed, polling
  // 'cleared'        — no longer listed (auto-detected)
  // 'rejected'       — delist was rejected by RBL
  // 'expired'        — auto-expire detected (SpamCop etc)

  // Submission details
  submittedAt: integer('submitted_at', { mode: 'timestamp' }),
  submissionMethod: text('submission_method'),
  // 'form' | 'email' | 'auto_expired' | 'manual_confirmed'
  submissionNote: text('submission_note'), // user's own note

  // AI-drafted request (cloud only)
  draftedRequest: text('drafted_request'), // generated email/form text

  // Polling
  lastPolledAt: integer('last_polled_at', { mode: 'timestamp' }),
  pollingEnabled: integer('polling_enabled', { mode: 'boolean' }).default(true),
  pollIntervalHours: integer('poll_interval_hours').default(1),
  clearedAt: integer('cleared_at', { mode: 'timestamp' }),

  // Timeline events (JSON array of {ts, event, detail})
  timeline: text('timeline').notNull().default('[]'),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})
```

---

## Delist Wizard — Step by Step

The wizard is triggered from the Blacklists tab when a listing
is detected. "Get help delisting" button per listed RBL.

### Wizard flow

```
Step 1 — What's listed and why

  ┌─────────────────────────────────────────────────────────┐
  │ 🔴 Your IP 23.95.170.217 is listed on Spamhaus ZEN      │
  │                                                         │
  │ What this means:                                        │
  │ Spamhaus ZEN is checked by most major mail providers.   │
  │ A listing here will cause delivery failures to Gmail,   │
  │ Outlook, Yahoo, and others.                             │
  │                                                         │
  │ Common reasons for listing:                             │
  │ • IP is a residential/dynamic IP (PBL)                 │
  │ • IP has been used to send spam (SBL)                  │
  │ • IP is an open proxy or compromised host (XBL)        │
  │                                                         │
  │ Typical clear time: Instant (PBL) or 1-5 days (SBL)   │
  └─────────────────────────────────────────────────────────┘

  Before you request removal, check:
  ☐ My server has not been sending spam
  ☐ My server is not an open relay
  ☐ My PTR record is correctly configured

  [Next: Check your listing type →]

──────────────────────────────────────────────────────────────

Step 2 — Identify your listing type (Spamhaus only)

  First, let's check why you're listed.

  Look up your listing at Spamhaus:
  [Open Spamhaus Lookup: 23.95.170.217 →]
  (opens https://check.spamhaus.org/listed/?searchterm=23.95.170.217)

  What type of listing did you see?
  ○ PBL — Policy Block List (residential/dynamic IP)
  ○ SBL — Spamhaus Block List (spam sent from this IP)
  ○ XBL — Exploits Block List (proxy/compromised host)
  ○ I'm not sure

  [Back] [Next →]

──────────────────────────────────────────────────────────────

Step 3a — PBL removal (if PBL selected)

  PBL listings are for residential and dynamic IPs.
  If your IP is a static VPS/server IP, this is likely
  an error and can be resolved instantly.

  Your IP details:
  IP:       23.95.170.217
  Hostname: mail.homelabza.com  ✓
  PTR:      mail.homelabza.com  ✓
  Provider: RackNerd (detected from IP range)

  Request PBL removal:
  [Open Spamhaus PBL Removal Form →]
  (https://www.spamhaus.org/pbl/removal/)

  The form will ask for:
  • Your email address
  • Confirmation that this is a static server IP

  After submitting:
  ☐ I have submitted the PBL removal form

  [Mark as submitted →]

──────────────────────────────────────────────────────────────

Step 3b — SBL/XBL removal (if SBL/XBL or unsure)

  SBL and XBL listings require investigation before removal.

  Before requesting removal, verify:
  ☐ Check your mail server logs for unusual activity
  ☐ Verify no accounts have been compromised
  ☐ Ensure your server is not an open relay
     Test: [Test open relay →]
  ☐ Check for malware or botnet activity on this server

  When you're confident the issue is resolved:

  ── AI-drafted request (Cloud) ────────────────────────────
  │                                                        │
  │ [Generate delist request →]                           │
  │ MxWatch will draft a delist request using your        │
  │ server details. Upgrade to Cloud to use this feature. │
  │                                                       │
  ── Manual request ────────────────────────────────────  │

  Send an email to: sbl-removal@spamhaus.org

  Include in your email:
  • The listed IP: 23.95.170.217
  • Your mail hostname: mail.homelabza.com
  • What caused the listing (be specific)
  • What steps you've taken to fix it
  • Confirmation it won't happen again

  [Copy email address]  [Open email client →]

  ☐ I have sent the removal request

  [Mark as submitted →]

──────────────────────────────────────────────────────────────

Step 4 — Submitted — tracking begins

  ✓ Delist request submitted to Spamhaus ZEN

  MxWatch will automatically check if your IP is still
  listed every hour and notify you when it's cleared.

  Current status: Still listed (checking every hour)
  Next check: in 52 minutes

  [View delist history]  [Done]
```

### Auto-expire wizard variant (SpamCop, Mailspike)

```
Step 1 — What's listed and why

  ⏱ Your IP is listed on SpamCop

  Good news: SpamCop listings expire automatically.

  What this means:
  SpamCop listings auto-expire after 24-48 hours if no
  new spam reports are received from your IP.

  No delist action needed. Just ensure no more spam
  is being sent from 23.95.170.217.

  Estimated clear time: 24-48 hours
  Listed since: 6 hours ago
  Estimated clear: April 16, 2026 ~10:00 UTC

  What to do while waiting:
  ☐ Check your mail server logs for any spam activity
  ☐ Verify no accounts have been compromised
  ☐ Review your mailing lists for spam trap addresses

  MxWatch will notify you when the listing expires.

  [Start tracking]  [Done]
```

---

## AI-Drafted Delist Request (Cloud Only)

Triggered by "Generate delist request" button in Step 3.
Uses Anthropic API (claude-sonnet-4-20250514).

```typescript
// packages/monitors/src/delist/draft-request.ts

export async function draftDelistRequest(
  rblName: string,
  domain: Domain,
  listedValue: string,
  serverInfo: ServerInfo,
): Promise<string> {

  const rbl = RBL_KNOWLEDGE[rblName]
  if (!rbl) throw new Error(`Unknown RBL: ${rblName}`)

  const prompt = `
You are drafting a professional email/form submission to request
removal from an email blacklist.

Blacklist: ${rbl.name}
Listed value: ${listedValue} (${rbl.type})
Delist method: ${rbl.delistMethod}

Known server details:
- Domain: ${domain.domain}
- Mail hostname: ${serverInfo.mailHostname ?? 'unknown'}
- IP: ${serverInfo.sendingIp ?? listedValue}
- PTR record: ${serverInfo.ptrRecord ?? 'not checked'}
- SPF status: ${serverInfo.spfStatus ?? 'unknown'}
- DKIM configured: ${serverInfo.dkimValid ? 'yes' : 'unknown'}
- DMARC policy: ${serverInfo.dmarcPolicy ?? 'unknown'}
- Mail server software: ${serverInfo.serverType ?? 'unknown'}

Write a professional, concise delist request that:
1. Clearly identifies the listed IP/domain
2. Explains this is a legitimate mail server
3. Provides the server details above
4. States steps taken to prevent future issues
5. Is polite and to the point (under 200 words)
6. Does NOT make excuses or blame others

Return ONLY the email/form text, no commentary.
Do not include a subject line — just the body.
`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const data = await response.json()
  return data.content[0].text
}
```

**What the AI draft looks like:**

```
To: delist@invaluement.com
Subject: Delist request — 23.95.170.217

I am writing to request removal of IP 23.95.170.217 from the
Invaluement ivmSIP blacklist.

Server information:
  IP address:    23.95.170.217
  Hostname:      mail.homelabza.com
  PTR record:    mail.homelabza.com (verified)
  Mail server:   Stalwart 0.7.2
  SPF:           v=spf1 ip4:23.95.170.217 ~all (pass)
  DKIM:          Configured (selector: mail)
  DMARC:         p=reject

This IP sends legitimate transactional and personal email for
homelabza.com. Average volume is approximately 50 emails per day
to opted-in recipients only.

I have reviewed our sending practices and confirmed this IP is
not associated with any spam campaigns. I believe this may be
a false positive listing.

Could you please review and remove this IP from the ivmSIP list?

Thank you,
[Your name]
[Your email]
```

User can edit before copying/sending.

---

## Auto-Polling

After submission, MxWatch polls the RBL every hour until cleared.

```typescript
// packages/monitors/src/delist/poller.ts

export async function pollPendingDelistRequests(): Promise<void> {
  const pending = await db.query.delistRequests.findMany({
    where: and(
      eq(delistRequests.status, 'pending'),
      eq(delistRequests.pollingEnabled, true),
    ),
  })

  for (const request of pending) {
    await pollDelistRequest(request)
  }
}

async function pollDelistRequest(request: DelistRequest): Promise<void> {
  // Check if still listed
  const rbl = RBL_KNOWLEDGE[request.rblName]
  if (!rbl) return

  try {
    const isListed = await checkRBL(request.listedValue, {
      name: rbl.name,
      host: getRBLHost(request.rblName),
      type: request.listingType as 'ip' | 'domain',
    })

    if (!isListed.listed) {
      // Cleared!
      await db.update(delistRequests).set({
        status: 'cleared',
        clearedAt: new Date(),
        pollingEnabled: false,
        timeline: appendTimelineEvent(request.timeline, {
          event: 'cleared',
          detail: 'IP/domain no longer listed on this RBL',
        }),
        updatedAt: new Date(),
      }).where(eq(delistRequests.id, request.id))

      // Fire alert
      await fireAlert('rbl_delisted', {
        rblName: rbl.name,
        listedValue: request.listedValue,
        daysPending: daysBetween(request.submittedAt!, new Date()),
        domainId: request.domainId,
      })

      logger.info('rbl', `Delist confirmed: ${request.listedValue} cleared from ${rbl.name}`, {
        requestId: request.id,
        domainId: request.domainId,
      })
    } else {
      // Still listed — update last polled time
      await db.update(delistRequests).set({
        lastPolledAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(delistRequests.id, request.id))
    }
  } catch (e) {
    logger.error('rbl', 'Delist polling failed', e, {
      requestId: request.id,
      rblName: request.rblName,
    })
  }
}

// Add to scheduler
cron.schedule('0 * * * *', () => pollPendingDelistRequests()) // every hour
```

---

## tRPC Router

```typescript
delist: router({
  // Get all delist requests for a domain
  list: authedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ ctx, input }) => {
      const domain = await verifyDomainOwnership(input.domainId, ctx.user.id)
      return db.query.delistRequests.findMany({
        where: eq(delistRequests.domainId, domain.id),
        orderBy: [desc(delistRequests.createdAt)],
      })
    }),

  // Get or create a delist request for a specific RBL listing
  getOrCreate: authedProcedure
    .input(z.object({
      domainId: z.string(),
      rblName: z.string(),
      listedValue: z.string(),
      listingType: z.enum(['ip', 'domain']),
    }))
    .mutation(async ({ ctx, input }) => {
      const domain = await verifyDomainOwnership(input.domainId, ctx.user.id)

      // Check for existing active request
      const existing = await db.query.delistRequests.findFirst({
        where: and(
          eq(delistRequests.domainId, domain.id),
          eq(delistRequests.rblName, input.rblName),
          eq(delistRequests.listedValue, input.listedValue),
          inArray(delistRequests.status, ['not_submitted', 'submitted', 'pending']),
        ),
      })
      if (existing) return existing

      // Create new request
      const id = nanoid()
      await db.insert(delistRequests).values({
        id,
        userId: ctx.user.id,
        domainId: domain.id,
        rblName: input.rblName,
        listedValue: input.listedValue,
        listingType: input.listingType,
        status: 'not_submitted',
        timeline: JSON.stringify([{
          ts: new Date().toISOString(),
          event: 'started',
          detail: 'Delist wizard opened',
        }]),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      return db.query.delistRequests.findFirst({
        where: eq(delistRequests.id, id),
      })
    }),

  // Mark as submitted (user confirms they submitted)
  markSubmitted: authedProcedure
    .input(z.object({
      requestId: z.string(),
      method: z.enum(['form', 'email', 'manual_confirmed']),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const request = await verifyRequestOwnership(input.requestId, ctx.user.id)
      const rbl = RBL_KNOWLEDGE[request.rblName]
      const newStatus = rbl?.autoExpires ? 'pending' : 'pending'

      await db.update(delistRequests).set({
        status: newStatus,
        submittedAt: new Date(),
        submissionMethod: input.method,
        submissionNote: input.note ?? null,
        pollingEnabled: true,
        lastPolledAt: new Date(),
        timeline: appendTimelineEvent(request.timeline, {
          event: 'submitted',
          detail: `Submitted via ${input.method}`,
        }),
        updatedAt: new Date(),
      }).where(eq(delistRequests.id, input.requestId))

      logger.info('rbl', 'Delist request submitted', {
        requestId: input.requestId,
        rblName: request.rblName,
        method: input.method,
      })
    }),

  // AI draft (cloud only)
  generateDraft: authedProcedure
    .mutation(async ({ ctx, input }) => {
      // Gate: cloud only
      if (process.env.MXWATCH_CLOUD !== '1') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'AI-drafted requests are available on MxWatch Cloud plans.',
        })
      }
      // Check plan
      if (!['solo', 'teams'].includes(ctx.user.plan)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Upgrade to MxWatch Cloud to use AI-drafted delist requests.',
        })
      }

      const request = await verifyRequestOwnership(input.requestId, ctx.user.id)
      const domain = await getDomain(request.domainId)
      const serverInfo = await getLatestServerInfo(domain)

      const draft = await draftDelistRequest(
        request.rblName,
        domain,
        request.listedValue,
        serverInfo,
      )

      await db.update(delistRequests).set({
        draftedRequest: draft,
        updatedAt: new Date(),
      }).where(eq(delistRequests.id, request.id))

      return { draft }
    }),

  // Manual poll trigger
  checkNow: authedProcedure
    .input(z.object({ requestId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const request = await verifyRequestOwnership(input.requestId, ctx.user.id)
      await pollDelistRequest(request)
      return db.query.delistRequests.findFirst({
        where: eq(delistRequests.id, input.requestId),
      })
    }),

  // Get RBL knowledge for a specific RBL
  getRBLInfo: publicProcedure
    .input(z.object({ rblName: z.string() }))
    .query(({ input }) => {
      return RBL_KNOWLEDGE[input.rblName] ?? null
    }),
}),
```

---

## UI — Blacklists Tab Updates

Update the existing Blacklists tab to show delist status
and trigger the wizard.

```
Blacklists tab — homelabza.com

RBL Status (last checked 2h ago)              [Run checks now]

✓ Spamhaus ZEN        clean     2h ago
✗ Invaluement ivmSIP  LISTED    2h ago    [Get help delisting →]
✓ Barracuda           clean     2h ago
✓ SORBS               clean     2h ago
⏱ SpamCop             LISTED    2h ago    [Track auto-expiry →]
   (auto-expires in ~18 hours)
✓ Spamrats            clean     2h ago
✓ Mailspike           clean     2h ago
✓ SEM-BACKSCATTER     clean     2h ago

── Active delist requests ──────────────────────────────────────

Invaluement ivmSIP · 23.95.170.217
Submitted 1 day ago · Still listed · Checking hourly
[View details]  [Check now]

SpamCop · 23.95.170.217
Auto-expires · Checking hourly · Est. clear in 18h
[View details]
```

**Delist request detail panel (slide-in drawer):**

```
Invaluement ivmSIP — Delist Request

Status: ⏳ Pending — submitted 1 day ago

Listed value:  23.95.170.217
Submitted:     April 14, 2026 at 14:32
Method:        Email
Last checked:  5 minutes ago
Next check:    in 55 minutes

[Check now]  [Disable auto-polling]

── Timeline ────────────────────────────────────────────────────
April 14 14:30  Delist wizard opened
April 14 14:32  Email submitted to delist@invaluement.com
April 14 15:00  Still listed (auto-check)
April 14 16:00  Still listed (auto-check)
April 14 17:00  Still listed (auto-check)
[... more entries]

── Your submission ─────────────────────────────────────────────
"Sent email to delist@invaluement.com with server details"

── Prevention tips ─────────────────────────────────────────────
• Keep sending volume low and consistent
• Avoid sending from many IPs simultaneously
• Ensure all email is solicited and expected
```

---

## Environment Variables

```env
# Required for AI delist drafts (cloud only)
ANTHROPIC_API_KEY=
```

---

## Build Order (Claude Code Prompt)

```
STEP 1 — RBL knowledge base
  Create packages/monitors/src/delist/rbl-knowledge.ts
  Add all 11 RBLs from spec above
  Export RBL_KNOWLEDGE and helper getRBLHost(name)

STEP 2 — DB schema + migration
  Add delistRequests table
  Add appendTimelineEvent() helper function
  Run: pnpm db:migrate

STEP 3 — Delist poller
  Create packages/monitors/src/delist/poller.ts
  pollPendingDelistRequests() — checks all pending requests
  pollDelistRequest() — individual check + status update
  Add to scheduler: every hour

STEP 4 — AI draft (cloud only)
  Create packages/monitors/src/delist/draft-request.ts
  draftDelistRequest() using Anthropic API
  Gate: MXWATCH_CLOUD=1 AND plan = 'solo' | 'teams'

STEP 5 — tRPC delist router
  All routes from spec above
  Wire into main tRPC router

STEP 6 — Delist wizard UI
  Create apps/web/src/components/delist/
    delist-wizard.tsx    — main wizard component
    wizard-steps/
      step-why.tsx       — what's listed and why
      step-type.tsx      — listing type identification (Spamhaus)
      step-action.tsx    — form link / email / auto-expire
      step-submitted.tsx — tracking begins
    delist-drawer.tsx    — detail panel for existing requests
    delist-status.tsx    — status badge component

STEP 7 — Blacklists tab updates
  Add "Get help delisting" button per listed RBL
  Add "Active delist requests" section at bottom of tab
  Wire wizard open on button click

STEP 8 — Auto-expire wizard variant
  Detect auto-expire RBLs (autoExpires: true)
  Show simplified wizard without submission step
  Show estimated clear time from autoExpireHours

STEP 9 — Notifications
  Add alert type: 'rbl_delisted'
  Email: "Your IP has been removed from [RBL name]"
  Dashboard activity feed entry

STEP 10 — Cloud upsell
  In wizard Step 3, show AI draft section:
  - Cloud users: "Generate delist request" button
  - Free/self-hosted: same button, grayed, "Cloud feature"
    tooltip: "Upgrade to MxWatch Cloud for AI-drafted requests"

tsc --noEmit after each step.
Never pass ANTHROPIC_API_KEY to the client.
AI draft endpoint is server-side only via tRPC mutation.
All delist requests are user-scoped — verify ownership always.
```
