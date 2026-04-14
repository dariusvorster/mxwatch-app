# Seed issues

Paste each block below as a new issue on GitHub once the repo is up. They cover the realistic "first week of users" complaints + the V3.5 polish items that didn't quite make it in. Good-first-issue labels where relevant.

---

## 1. Alert evaluation for Watched Domains

**Labels:** `enhancement`, `alerts`

The `watched_domains` table has `alertOnRblListing` and `alertOnDmarcChange` columns that are populated but not yet consumed by the alert evaluator. A `blacklist_listed` alert on a watched domain should fire the moment the sweep detects a new listing, and resolve automatically when it clears.

**Suggested approach:** add a `trigger: 'watched'` branch to `alert-evaluator.ts` that reads the latest `watched_domain_snapshots` row and compares against the previous one.

---

## 2. Plan enforcement for Cloud (gated)

**Labels:** `billing`, `cloud-only`

The Lemon Squeezy billing plumbing is shipped but the plan tier doesn't actually gate any feature yet. Once billing is live, enforce:

- Cloud Solo: max 10 domains (block `domains.create` past the limit)
- Cloud Teams: unlocks unlimited domains and API tokens
- Free / self-hosted: unlimited everything (this is how the code already behaves today)

Read the user's tier from the latest `lemon_subscriptions` row where `status IN ('active', 'on_trial', 'past_due')`.

---

## 3. Team members + workspaces

**Labels:** `enhancement`, `cloud-only`

Spec'd in `mxwatch-v3.5-spec.md` but deferred until billing is active. Introduce a `workspaces` table, migrate every `domains.userId` to `domains.workspaceId`, add `workspace_members` with owner / admin / viewer roles, and signed email invite links.

This is a significant rework touching every tRPC router. Hold until we have paying Solo customers who ask for it.

---

## 4. DNS propagation — persist history

**Labels:** `enhancement`, `good-first-issue`

`reports.propagation.check` returns results ephemerally. Spec §2.2 asks for a `history` query. Add a `dns_propagation_checks` table, store every result, and show the last N checks on the DNS tab.

---

## 5. DMARC reports — alert on unexpected sender spike

**Labels:** `enhancement`, `alerts`

We already have `unexpectedSenders` detection on the DMARC tab. Feed it into the alert evaluator so users get notified when a new IP starts sending as their domain — that's often the first sign of a compromise.

---

## 6. Docker image — smoke-test matrix

**Labels:** `tooling`, `good-first-issue`

Add a CI workflow (GitHub Actions) that on every push:

1. Builds the Docker image
2. Runs the migrator target
3. Starts the runner target
4. Hits `/api/health` and asserts 200

This catches schema drift and missing env var defaults before they hit self-hosters.

---

## 7. Dark-mode screenshots in README

**Labels:** `docs`, `good-first-issue`

Add dark-mode counterparts to each screenshot in `screenshots/`, then update the README to show both via `<picture>` with `prefers-color-scheme`.

---

## 8. Alert history pagination

**Labels:** `enhancement`, `good-first-issue`

`alerts.history` hard-caps at 100 results. Make it cursor-paginated so long-running installations don't lose visibility after a few alerty weeks.

---

## 9. `db:migrate` instead of `db:push` for production

**Labels:** `tooling`

The `migrator` Docker target runs `drizzle-kit push` which is destructive on schema drift. Switch to `drizzle-kit generate` + `drizzle-kit migrate` so upgrades are replayable and rollbackable.

---

## 10. Stalwart integration — actual endpoint coverage

**Labels:** `integration`, `stalwart`

The Stalwart client currently best-effort calls `/api/queue/summary` and `/api/server/info` which aren't official endpoints. Validate against a live Stalwart instance and update `fetchSnapshotSummary` to use the real management API paths. Document the required Stalwart version in README.
