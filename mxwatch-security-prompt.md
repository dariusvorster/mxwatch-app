# MxWatch — Security Features Implementation
## Paste into Claude Code in /Users/dariusvorster/Projects/Mxwatch-app

---

Add a full security layer to MxWatch. Read this entire prompt before
writing any code. All features live under /settings/security unless
noted otherwise.

---

## 1. TOTP (Two-Factor Authentication)

### Behaviour
- Self-hosted (MXWATCH_CLOUD unset or 0): TOTP is optional
- Cloud (MXWATCH_CLOUD=1): TOTP is mandatory
  - After login, if TOTP not configured: redirect to /setup/2fa
  - /setup/2fa is a blocking page — cannot navigate away to dashboard
  - Once TOTP is configured, never shown again

### DB additions
```typescript
// Add to users table in packages/db/schema.ts
totpEnabled:     integer('totp_enabled', { mode: 'boolean' }).default(false),
totpSecret:      text('totp_secret'),        // encrypted with ENCRYPTION_KEY
totpBackupCodes: text('totp_backup_codes'),  // JSON array, bcrypt hashed, encrypted
```

### better-auth TOTP plugin
better-auth has a built-in TOTP plugin. Use it:
```typescript
// apps/web/src/lib/auth.ts
import { betterAuth } from 'better-auth'
import { twoFactor } from 'better-auth/plugins'

export const auth = betterAuth({
  // ... existing config ...
  plugins: [
    twoFactor({
      issuer: 'MxWatch',
      totpOptions: {
        period: 30,
        digits: 6,
      },
    }),
  ],
})
```

### TOTP setup flow (/settings/security → Enable 2FA)
Step 1 — Generate secret + QR code
  - Generate TOTP secret via better-auth
  - Display QR code (use `qrcode` npm package → data URL)
  - Show manual entry key below QR code
  - "Scan this with your authenticator app (Google Authenticator,
     Authy, 1Password, etc.)"

Step 2 — Verify code
  - Input: 6-digit code from authenticator
  - On success: TOTP enabled, show backup codes

Step 3 — Backup codes
  - Generate 8 backup codes (random, 10 chars each, format: XXXXX-XXXXX)
  - Display once only — "Save these somewhere safe. Each can only be used once."
  - bcrypt hash each before storing (JSON array in totpBackupCodes, encrypted)
  - "I have saved my backup codes" checkbox before proceeding
  - Download as .txt button

### TOTP login flow
After email/password success → if totpEnabled:
  - Redirect to /auth/2fa (NOT dashboard)
  - 6-digit code input + "Use backup code" link
  - On success: normal session created
  - On backup code: mark that code as used (remove from array)
  - Rate limit: 5 attempts, then 15 minute lockout

### TOTP disable flow
  - Requires current TOTP code to disable (not just password)
  - On cloud (MXWATCH_CLOUD=1): show warning "2FA is required for
    cloud accounts. Disabling it will lock you out on next login."
  - Actually allow disable on cloud — user's choice — but warn clearly

### Mandatory 2FA redirect (cloud only)
```typescript
// apps/web/src/middleware.ts
// Add to existing middleware:
if (
  process.env.MXWATCH_CLOUD === '1' &&
  session &&
  !session.user.totpEnabled &&
  !pathname.startsWith('/setup/2fa') &&
  !pathname.startsWith('/api') &&
  !pathname.startsWith('/auth')
) {
  return NextResponse.redirect(new URL('/setup/2fa', req.url))
}
```

---

## 2. Logout button

### Placement
- Sidebar footer — next to user avatar and name
- Icon button: arrow-right-from-bracket (or similar logout icon)
- No confirmation dialog — just log out immediately
- On logout: clear session, redirect to /login

### Implementation
```typescript
// Use better-auth signOut
import { authClient } from '@/lib/auth-client'

async function handleLogout() {
  await authClient.signOut()
  router.push('/login')
}
```

### "Log out all other sessions" 
Lives in /settings/security (not in sidebar).
Clears all sessions except the current one.

---

## 3. Session Management

### DB additions
```typescript
// better-auth manages sessions table automatically
// Add these fields if not already present via better-auth:
// sessions: id, userId, token, expiresAt, ipAddress, userAgent, createdAt
// better-auth already does this — just make sure it's exposed via tRPC
```

### tRPC router additions
```typescript
sessions: router({
  list: authedProcedure.query(async ({ ctx }) => {
    // Return all sessions for current user
    // Mark which one is the current session (match token)
    return getSessions(ctx.user.id, ctx.session.token)
  }),

  revoke: authedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Cannot revoke current session via this endpoint
      // Use logout for that
      if (input.sessionId === ctx.session.id) {
        throw new TRPCError({ code: 'BAD_REQUEST',
          message: 'Use logout to end your current session' })
      }
      await revokeSession(input.sessionId, ctx.user.id)
    }),

  revokeAll: authedProcedure
    .mutation(async ({ ctx }) => {
      // Revoke all sessions except current
      await revokeAllOtherSessions(ctx.user.id, ctx.session.id)
    }),
}),
```

### Session display UI (/settings/security)
Show each session as a card:
```
[Device icon]  Chrome on macOS          [Current]
               192.168.69.x · Cape Town, ZA
               Active now

[Device icon]  Firefox on Ubuntu
               192.168.80.x · Cape Town, ZA
               Last active 2 days ago          [Revoke]

[Device icon]  Safari on iPhone
               100.87.x.x · Cape Town, ZA
               Last active 1 week ago          [Revoke]

[Revoke all other sessions]
```

Parse userAgent for device/browser name using `ua-parser-js`.
Show IP address. Show relative time (last active).
Current session badge — cannot be revoked from this UI.

### Session expiry
Add to settings:
```
Session expires after:
○ 24 hours (default)
● 7 days
○ 30 days
○ Never (not recommended)
```
Store as `sessionExpiryDays` on user row.
Pass to better-auth session creation as `expiresIn`.

---

## 4. Account Activity Log

### DB additions
```typescript
export const activityLog = sqliteTable('activity_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  action: text('action').notNull(),
  // 'login_success' | 'login_failed' | 'login_2fa_success' |
  // 'login_2fa_failed' | 'logout' | 'password_changed' |
  // '2fa_enabled' | '2fa_disabled' | 'session_revoked' |
  // 'api_token_created' | 'api_token_revoked' |
  // 'domain_added' | 'domain_deleted' | 'settings_changed' |
  // 'ip_allowlist_changed'
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  detail: text('detail'),  // JSON — context-specific
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})
```

Write to activity log on every auth event and sensitive action.
Helper function:
```typescript
export async function logActivity(
  userId: string,
  action: string,
  req: Request,
  detail?: Record<string, unknown>,
) {
  await db.insert(activityLog).values({
    id: nanoid(),
    userId,
    action,
    ipAddress: req.headers.get('x-forwarded-for') ?? 'unknown',
    userAgent: req.headers.get('user-agent') ?? 'unknown',
    detail: detail ? JSON.stringify(detail) : null,
    createdAt: new Date(),
  })
}
```

### tRPC router
```typescript
activityLog: authedProcedure
  .input(z.object({ limit: z.number().default(50) }))
  .query(async ({ ctx, input }) => {
    return db.query.activityLog.findMany({
      where: eq(activityLog.userId, ctx.user.id),
      orderBy: [desc(activityLog.createdAt)],
      limit: input.limit,
    })
  }),
```

### Activity log UI (/settings/security)
Timeline list — icon + action + detail + IP + time:
```
✓ Login         Chrome on macOS · 192.168.69.x    2 min ago
✓ 2FA verified  Chrome on macOS · 192.168.69.x    2 min ago
⚙ Domain added  gitbay.dev                        1 hour ago
✓ Login         Safari on iPhone · 100.87.x.x     2 days ago
⚠ Login failed  Unknown · 45.227.x.x              3 days ago
⚙ 2FA enabled                                     1 week ago
```

Show last 50 entries. "Load more" pagination.
Failed login attempts highlighted in amber.
Unknown IPs highlighted in red.

### New login notification email
When a login occurs from an IP not seen in the last 30 days,
send an email via Resend:
```
Subject: New login to your MxWatch account

A new login was detected:
  Time:     April 15, 2026 at 14:32 UTC
  Browser:  Chrome on macOS
  IP:       45.227.x.x
  Location: São Paulo, Brazil (approximate)

If this was you, no action needed.
If this wasn't you, secure your account immediately:
[Secure my account →]  (links to /settings/security)
```

---

## 5. API Tokens

For the Teams plan (and power users on self-hosted).
Allows programmatic access to MxWatch data.

### DB additions
```typescript
export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),  // SHA-256 hash of token
  // Token itself is shown ONCE at creation, never stored
  prefix: text('prefix').notNull(),          // first 8 chars for display: "mxw_live_xxxxxxxx..."
  scopes: text('scopes').notNull(),          // JSON array
  // 'domains:read' | 'checks:read' | 'reports:read' | 'alerts:read' | 'alerts:write'
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  lastUsedIp: text('last_used_ip'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),  // null = never
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
})
```

### Token format
```
mxw_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
└─────┘ └──┘ └────────────────────────────┘
prefix  env  32 random bytes, base58 encoded

Self-hosted: mxw_self_xxxx
Cloud:       mxw_live_xxxx
Test mode:   mxw_test_xxxx
```

### Token creation flow
1. User enters name + selects scopes + optional expiry
2. Server generates token, stores SHA-256 hash only
3. Token shown once in UI with copy button
4. Warning: "This token will not be shown again. Copy it now."
5. Activity logged: 'api_token_created'

### tRPC router
```typescript
apiTokens: router({
  list: authedProcedure.query(/* all tokens — no secret values, prefix only */),

  create: authedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      scopes: z.array(z.enum([
        'domains:read', 'checks:read', 'reports:read',
        'alerts:read', 'alerts:write'
      ])),
      expiresInDays: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const token = generateAPIToken(ctx.isProd)
      const hash = sha256(token)
      const prefix = token.slice(0, 16) + '...'

      await db.insert(apiTokens).values({
        id: nanoid(),
        userId: ctx.user.id,
        name: input.name,
        tokenHash: hash,
        prefix,
        scopes: JSON.stringify(input.scopes),
        expiresAt: input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * 86400000)
          : null,
        createdAt: new Date(),
      })

      await logActivity(ctx.user.id, 'api_token_created', ctx.req,
        { name: input.name, scopes: input.scopes })

      // Return the token ONCE — not stored
      return { token, prefix }
    }),

  revoke: authedProcedure
    .input(z.object({ tokenId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await db.update(apiTokens)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(apiTokens.id, input.tokenId),
          eq(apiTokens.userId, ctx.user.id),
        ))
      await logActivity(ctx.user.id, 'api_token_revoked', ctx.req)
    }),
}),
```

### API token authentication middleware
```typescript
// apps/web/src/server/middleware/api-token.ts
// For API routes — checks Bearer token in Authorization header

export async function validateAPIToken(
  req: Request,
): Promise<{ userId: string; scopes: string[] } | null> {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer mxw_')) return null

  const token = auth.slice(7)
  const hash = sha256(token)

  const record = await db.query.apiTokens.findFirst({
    where: and(
      eq(apiTokens.tokenHash, hash),
      isNull(apiTokens.revokedAt),
      or(
        isNull(apiTokens.expiresAt),
        gt(apiTokens.expiresAt, new Date()),
      ),
    ),
  })

  if (!record) return null

  // Update last used
  await db.update(apiTokens)
    .set({ lastUsedAt: new Date(), lastUsedIp: getClientIP(req) })
    .where(eq(apiTokens.id, record.id))

  return {
    userId: record.userId,
    scopes: JSON.parse(record.scopes),
  }
}
```

### API tokens UI (/settings/security)
```
API tokens                              [Create token]

mxw_live_abc12345...                    domains:read, checks:read
"Monitoring script"                     Never expires
                                        Last used: 2 days ago from 192.168.x.x
                                        [Revoke]

mxw_live_def67890...                    domains:read
"Grafana dashboard"                     Expires: June 15, 2026
                                        Last used: 1 hour ago
                                        [Revoke]
```

---

## 6. IP Allowlist

Optional. When configured, only listed IPs/CIDRs can access
the dashboard. API tokens are also restricted.

### DB additions
```typescript
// Add to users table:
ipAllowlist: text('ip_allowlist'),  // JSON array of CIDR strings, null = disabled

// Example: ["192.168.0.0/16", "100.64.0.0/10", "41.x.x.x/32"]
```

### Validation logic
```typescript
import { isInSubnet } from 'is-in-subnet'  // or implement manually

export function isIPAllowed(ip: string, allowlist: string[]): boolean {
  if (!allowlist || allowlist.length === 0) return true  // no list = allow all
  return allowlist.some(cidr => {
    if (cidr.includes('/')) return isInSubnet(ip, cidr)
    return ip === cidr
  })
}
```

Add to middleware — check after session validation:
```typescript
if (session && user.ipAllowlist) {
  const list = JSON.parse(user.ipAllowlist) as string[]
  const clientIP = req.headers.get('x-forwarded-for') ?? ''
  if (list.length > 0 && !isIPAllowed(clientIP, list)) {
    return NextResponse.redirect(new URL('/auth/blocked', req.url))
  }
}
```

### IP allowlist UI (/settings/security)
```
IP allowlist                           [disabled — click to enable]

When enabled, only these IPs can access your dashboard.
Be careful — locking yourself out requires database access to fix.

[+ Add IP or CIDR range]

192.168.0.0/16       Home network         [Remove]
100.64.0.0/10        Tailscale            [Remove]
41.x.x.x/32         Your current IP      [Remove]

⚠ Your current IP (41.x.x.x) is in the allowlist.
  If you remove it, you will be locked out immediately.
```

Always show current IP with a warning if it's not in the list.
Pre-fill "Add IP" with the user's current IP as the default.
Add `is-in-subnet` package or implement CIDR check manually.

---

## 7. Password Management

### Change password (/settings/security)
```typescript
// Requires current password + new password + confirm
// Use better-auth changePassword
changePassword: authedProcedure
  .input(z.object({
    currentPassword: z.string(),
    newPassword: z.string().min(12),
    confirmPassword: z.string(),
  }))
  .mutation(async ({ ctx, input }) => {
    if (input.newPassword !== input.confirmPassword) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Passwords do not match' })
    }
    await authClient.changePassword({
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    })
    await logActivity(ctx.user.id, 'password_changed', ctx.req)
    // Send email: "Your password was changed"
  }),
```

### Password requirements
```
Minimum 12 characters
Show strength meter (zxcvbn or simple entropy check)
Reject: common passwords, password same as email
```

---

## 8. /settings/security page structure

Single page, multiple sections. No sub-routes.

```
/settings/security

┌─ Two-factor authentication ──────────────────────────────────┐
│  Status: ● Enabled / ○ Not configured                        │
│  [Set up 2FA] or [Disable 2FA]                               │
│  Backup codes: 6 remaining  [View / Regenerate]              │
└──────────────────────────────────────────────────────────────┘

┌─ Active sessions ────────────────────────────────────────────┐
│  [session cards as described above]                          │
│  [Log out all other sessions]                                │
└──────────────────────────────────────────────────────────────┘

┌─ API tokens ─────────────────────────────────────────────────┐
│  [token list + create button]                                │
└──────────────────────────────────────────────────────────────┘

┌─ IP allowlist ───────────────────────────────────────────────┐
│  [allowlist UI — disabled by default]                        │
└──────────────────────────────────────────────────────────────┘

┌─ Password ───────────────────────────────────────────────────┐
│  [change password form — collapsed by default]               │
└──────────────────────────────────────────────────────────────┘

┌─ Account activity ───────────────────────────────────────────┐
│  [activity log timeline — last 50 entries]                   │
└──────────────────────────────────────────────────────────────┘

┌─ Danger zone ────────────────────────────────────────────────┐
│  Export my data    [Download JSON]                           │
│  Delete account    [Delete account] (red, requires typing    │
│                    "DELETE" to confirm)                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 9. Logout button

Add to sidebar footer (already has user avatar + name + theme toggle):

```tsx
// apps/web/src/components/sidebar.tsx
// Add logout button next to existing elements

<button
  onClick={handleLogout}
  title="Log out"
  className="..." // icon button, muted color, hover red
>
  <LogOutIcon size={16} />
</button>
```

---

## 10. DB migrations

Run after all schema additions:
```bash
pnpm db:migrate
```

New tables: activityLog, apiTokens
New columns on users: totpEnabled, totpSecret, totpBackupCodes,
                      ipAllowlist, sessionExpiryDays

---

## 11. New dependencies

```bash
pnpm add qrcode         # QR code generation for TOTP setup
pnpm add ua-parser-js   # Parse user agent strings for session display
pnpm add is-in-subnet   # CIDR matching for IP allowlist
# zxcvbn — optional, for password strength meter
```

better-auth already has TOTP plugin — no separate totp library needed.

---

## 12. Build order

Confirm after each step before proceeding:

STEP 1 — DB schema additions + migration
  Add all new columns and tables. Run pnpm db:migrate.
  Verify with pnpm db:studio.

STEP 2 — Activity log helper
  packages/db/activity-log.ts — logActivity() function
  Wire into existing auth callbacks (login, logout)

STEP 3 — TOTP setup and verify
  better-auth twoFactor plugin wired
  /settings/security TOTP section (setup QR, verify, backup codes)
  /auth/2fa page (TOTP code entry after login)
  Mandatory redirect middleware (cloud only)

STEP 4 — Logout button
  Sidebar footer logout icon button
  better-auth signOut() on click

STEP 5 — Session management
  tRPC sessions router
  Session cards UI in /settings/security
  "Revoke all other sessions" button

STEP 6 — API tokens
  tRPC apiTokens router
  Token creation modal (with one-time display)
  Token list UI with revoke

STEP 7 — IP allowlist
  tRPC ipAllowlist mutation
  Middleware check
  IP allowlist UI with CIDR input

STEP 8 — Password change
  tRPC changePassword mutation
  Change password form in /settings/security

STEP 9 — Activity log UI
  Timeline display in /settings/security
  New login email via Resend

STEP 10 — Danger zone
  Export data endpoint (JSON of all user's domains/checks)
  Delete account mutation (soft delete → hard delete after 30 days)

tsc --noEmit after each step. Do not add dependencies beyond
those listed without asking.
```
