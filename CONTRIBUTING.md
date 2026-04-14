# Contributing to MxWatch

Thanks for taking an interest! MxWatch is built and used by a small number of self-hosters. Contributions that make it more reliable, easier to install, or broaden the list of supported mail servers are especially welcome.

## Dev setup

```bash
pnpm install
cp .env.example .env    # set MXWATCH_SECRET to a 32-char random string
pnpm db:push
pnpm dev
```

Requires **Node 20+** and **pnpm 9+**.

## Before opening a PR

- `pnpm test` (Vitest) passes
- `pnpm --filter @mxwatch/web build` passes
- Any new tRPC procedures are user-scoped (ownership checked before returning data)
- Secrets never hit the database in plaintext — use the `encryptJSON` / `decryptJSON` helpers in `@mxwatch/alerts`

## Code style

- TypeScript strict mode, `noUncheckedIndexedAccess` on
- Tailwind utilities for layout, CSS variables (`var(--bg)` etc) for colours — never hardcode hex codes
- Prefer small subpath exports from `@mxwatch/monitor` over the barrel when the caller is a client component (avoids pulling Node-only modules into the browser bundle)

## File layout

- Per-domain checks live in `apps/web/src/lib/run-*.ts` and return results to a shared helper
- Scheduled sweeps are registered in `apps/web/src/instrumentation.ts`
- All monitor logic (DNS, RBL, DMARC parser, SMTP, cert, propagation, record builder) lives in `packages/monitor` so nothing pulls Next.js into non-web code

## Adding a new blacklist

Edit `packages/monitor/src/blacklists.ts` and `apps/web/src/lib/rbl-meta.ts` together — the second is a client-safe mirror used by the UI.

## Reporting security issues

Please email security concerns privately rather than opening a public issue.
