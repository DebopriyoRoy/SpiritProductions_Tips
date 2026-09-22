# Spirit Productions Tips — Implementation Plan

A multi-location web application that pulls timecards and tips from Square,
scoped to a selected location, computes tip distribution, and exports a sheet
matching the existing Spirit Theater workbook.

**Locations in scope**
1. ACC Arts and Culture Center
2. Spirit Theater

---

## 0. Blocker to clear before Phase 1

**The Excel sheet is not in this repository.** This repo has zero commits and
no spreadsheet file anywhere on disk — the working container is created fresh
each session, so a file attached to an earlier chat does not persist here.

That sheet is the specification for three things we cannot guess:
- the exact tip-allocation math currently used by hand,
- the column layout and formatting the export must reproduce,
- which roles participate in the pool and at what weight.

**Action:** commit the workbook to `docs/reference/` in this repo (or paste it
into the session again). Everything in Phase 4 and Phase 6 is blocked on it;
Phases 1–3 and 5 can proceed in parallel without it.

---

## 1. How Square actually models this

These constraints shape the whole design, so they come first.

### One merchant, two locations, one token
Both venues live under a single Square merchant account. That means **one OAuth
token covers both locations** — location is a *filter* on every request, not a
separate connection. There is no "log into ACC" and "log into Spirit"; there is
one connection and a `location_id` applied everywhere.

This is the single most important architectural fact: correctness of the whole
app reduces to "is `location_id` applied to every read, every write, every
export, without exception."

### Endpoints we need

| Need | Endpoint | Notes |
|---|---|---|
| Location list | `GET /v2/locations` | Returns id, name, timezone, currency. Seeds the dropdown. |
| Staff roster | `POST /v2/team-members/search` | Filter `location_ids`, `status: ACTIVE`. |
| Hours worked | `POST /v2/labor/timecards/search` | Filter `location_ids`, `team_member_ids`, date range, status. |
| Card tips | `GET /v2/payments` | `location_id`, `begin_time`, `end_time`. Read `tip_money` + `team_member_id`. |
| Order-level tips | `POST /v2/orders/search` | Alternative/cross-check; `total_tip_money` per order. |

### Timecards, not Shifts
Square renamed `Shift` to `Timecard` in **API version 2025-05-21**.
`/v2/labor/shifts/*` and `SearchShifts` are deprecated; use
`/v2/labor/timecards/*` and `SearchTimecards`. They operate on the same
underlying resources, so this is a naming migration, not a data migration —
but pin the API version explicitly in the client config so a future rename
cannot silently change response shapes.

### Fields that matter
- `Timecard.wage.hourly_rate` — required for any labor-cost figure.
- `Timecard.declared_cash_tip_money` — cash tips the team member declared.
  Card tips do **not** appear here; they come from Payments.
- `Payment.tip_money` — the card tip.
- `Payment.team_member_id` — **only populated when the team member was logged
  into a cash drawer shift.** This is the most likely source of real-world data
  gaps, and the app must surface unattributed tips rather than silently dropping
  them (see §4).

### Money is integer cents
Every Square money field is an integer in the smallest currency unit. All
internal arithmetic stays in integer cents. Floats are never used for money
anywhere in this codebase — they are the standard source of "the sheet is off
by three cents" bugs.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | One deployable for UI and API; server actions keep Square tokens server-side. |
| Database | PostgreSQL (Neon or Supabase) | Needs real transactions for sync + allocation. |
| ORM | Prisma | Typed schema, straightforward migrations. |
| Square client | `square` Node SDK, pinned API version | Official, typed, handles pagination cursors. |
| App auth | Auth.js, email magic link | Small trusted staff set; no password management. |
| Export | `exceljs` | Writes real `.xlsx` with formatting, not just CSV. |
| Hosting | Vercel + managed Postgres | Zero-ops for an org this size. |
| Background sync | Vercel cron or a queued route | Sync must not run inside a request that can time out. |

Alternative if the team is Python-first: FastAPI + SQLAlchemy + `openpyxl` +
a React front end. Same design, more moving parts to deploy. Recommend Next.js
unless there is an existing Python codebase to live alongside.

---

## 3. Data model

```
location            square_location_id (unique), name, timezone, currency, active
team_member         square_team_member_id (unique), display_name, active
team_member_location  team_member_id, location_id        -- staff can work both venues
pay_period          location_id, start_date, end_date, status, FK-unique(location,start,end)
                    status: draft | syncing | synced | finalized | exported
timecard            square_timecard_id (unique), location_id, period_id, team_member_id,
                    start_at, end_at, break_minutes, worked_minutes,
                    wage_title, hourly_rate_cents, declared_cash_tip_cents,
                    source(synced|manual), is_overridden, synced_payload jsonb
tip_transaction     square_payment_id (unique), location_id, period_id, order_id,
                    created_at, tip_cents, method(card|cash), team_member_id nullable
tip_rule_set        location_id, effective_from, pool_scope, weights jsonb,
                    min_hours_eligible, cash_tips_pooled bool, rounding_policy
tip_allocation      period_id, team_member_id, worked_minutes, weight,
                    pool_cents, share_cents, manual_adjustment_cents, note
sync_run            location_id, period_id, started_at, finished_at, status,
                    counts jsonb, error_detail
audit_log           actor_id, entity, entity_id, action, before jsonb, after jsonb, at
```

Design notes:
- `location_id` is on every operational table, not just derivable by join. This
  makes the guard in §5 enforceable with a single `WHERE`.
- Square IDs carry unique constraints so re-syncing is **idempotent** — the same
  sync run twice produces the same rows, never duplicates.
- `synced_payload` keeps the raw Square object. When a number is disputed six
  months later, the original response is still there.
- `is_overridden` protects manual corrections from being clobbered by re-sync.
- `tip_rule_set` is per-location with an `effective_from` date, so ACC and Spirit
  can pool differently and a rule change does not retroactively rewrite closed
  periods.

---

## 4. Sync with Square

**Trigger:** user selects a location and a date range, presses *Sync with Square*.

**Sequence:**
1. Create a `sync_run` row (status `running`) — sync is always auditable, even
   when it fails.
2. Refresh `team_member` and `team_member_location` for the selected location.
3. `SearchTimecards` filtered by `location_ids: [selected]` and the range;
   page through `cursor` to exhaustion.
4. `ListPayments` for the same `location_id` and window; keep those with
   non-zero `tip_money`.
5. Upsert by Square ID inside one transaction. Rows with `is_overridden = true`
   keep their edited values; the incoming Square value is stored in
   `synced_payload` and flagged as a conflict for review.
6. Recompute allocations (§5) unless the period is `finalized`.
7. Close out `sync_run` with per-entity counts.

**Sync report** shown to the user afterwards — this is a core feature, not a
nicety:
- N timecards added / updated / unchanged
- N tips totalling $X
- **Tips with no `team_member_id`** and their dollar total ← needs a decision
  from the user each period, since Square only attributes a payment when the
  team member was logged into a cash drawer
- Open (unclosed) timecards in the range ← hours are not final, warn loudly
- Rows where a manual edit now disagrees with Square

**Timezone:** each location carries its own timezone from Square. "Sept 1–15"
means midnight-to-midnight *in that location's* timezone, converted to UTC at
the API boundary. Getting this wrong shifts late shifts into the wrong pay
period — a classic and very visible bug.

**Rate limits and resilience:** respect pagination cursors, retry 429/5xx with
exponential backoff and jitter, cap total runtime, and make the whole sync
resumable — a partial sync must never leave a period half-populated and look
complete.

---

## 5. Location scoping (the requirement that must not break)

The app must never show ACC numbers on a Spirit sheet. Enforce it in layers:

1. **Selected location lives in server-side session state**, not in a client
   variable a stale tab can lie about.
2. **A single data-access helper** (`forLocation(locationId)`) is the only way
   to query operational tables. Direct model access is blocked by lint rule.
   Every query is scoped by construction rather than by remembering.
3. **Every mutation re-validates** that the target row's `location_id` matches
   the session's — a stale form post cannot write across venues.
4. **The export writes the location name and ID into the file header.** If a
   sheet ever does leak, it is self-identifying.
5. **A test suite that seeds both locations** and asserts every list endpoint,
   every allocation, and every export returns exactly one location's rows.

Optional later: per-user location permissions, so a Spirit manager cannot open
ACC at all.

---

## 6. Tip allocation engine

Pure function, no I/O, fully unit-testable:

```
allocate(timecards, tipTransactions, ruleSet) -> allocations
```

Configurable per location via `tip_rule_set`:
- **Pool composition** — card tips always; cash tips pooled or kept by the
  declarer (`cash_tips_pooled`).
- **Eligibility** — minimum hours, which `wage_title` roles participate.
- **Weighting** — pro-rata by minutes worked, optionally scaled by a role weight
  (e.g. bartender 1.0, usher 0.5).
- **Rounding** — integer cents with **largest-remainder distribution**, so the
  sum of shares equals the pool exactly, every time. The leftover cents go where
  the rule set says (house, or longest-hours member).

**Invariant, asserted in code and tested:** `sum(share_cents) == pool_cents`.
No exceptions. A tip sheet that does not reconcile to the penny is a tip sheet
nobody trusts.

Manual adjustments live in `manual_adjustment_cents` with a required note — the
computed figure and the human correction stay separately visible, so the
adjustment is always explainable.

---

## 7. UI

- **Location switcher** in the top bar — the primary control, always visible,
  showing the active venue prominently. Never a buried setting.
- **Period picker** — date range plus saved recurring periods.
- **Sync with Square** button, with progress and the §4 report on completion.
- **Timecard grid** — staff, in/out, break, hours, declared cash tips. Editable,
  with edits flagged and audited.
- **Tips panel** — card tips by team member, unattributed bucket surfaced at the
  top for assignment.
- **Allocation view** — pool total, each person's hours, weight, share, running
  reconciliation showing pool minus allocated equals zero.
- **Export** — `.xlsx` matching the existing workbook, plus CSV.
- **History** — past periods, read-only once finalized, with their sync runs.

Everything on every screen is scoped to the selected location.

---

## 8. Phases

| Phase | Work | Depends on |
|---|---|---|
| 0 | Get workbook into repo; Square sandbox credentials; confirm pooling rules | **user** |
| 1 | Repo scaffold, Next.js + Prisma + Postgres, app auth, location model | — |
| 2 | Square OAuth, Locations + Team sync, location switcher | 1 |
| 3 | Timecard sync, sync runs, sync report, timezone handling | 2 |
| 4 | Payments/tips ingestion, unattributed-tip workflow | 3 |
| 5 | Allocation engine + per-location rule sets | 4, 0 |
| 6 | UI: grid, editing, overrides, audit | 3–5 |
| 7 | Excel export matching the existing sheet | 6, 0 |
| 8 | Hardening: scoping tests, roles, webhooks, deploy, runbook | 7 |

Phase 0 is genuinely blocking for 5 and 7. Phases 1–4 and 6 can start now.

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `Payment.team_member_id` empty (no cash drawer login) | Tips cannot be attributed | Surface unattributed total every sync; manual assignment UI; train staff to log in |
| Timezone boundary errors | Shifts land in the wrong pay period | Per-location timezone from Square; boundary tests around midnight and DST |
| Open timecards at sync time | Hours understated | Block finalize while open timecards exist in range |
| Square API version drift | Silent response shape changes | Pin API version; contract tests against sandbox |
| Float money arithmetic | Off-by-cents, lost trust | Integer cents only; reconciliation invariant enforced in code |
| Re-sync overwriting manual edits | Corrections silently lost | `is_overridden` flag; conflicts reported, never auto-resolved |
| Cross-location leakage | Wrong pay, real harm | Scoping enforced at data layer + tested (§5) |

---

## 10. Open questions

1. **The workbook** — can you commit it to this repo?
2. **Pooling rules** — is the pool split purely pro-rata by hours, or weighted by
   role? Do ACC and Spirit use the same rules?
3. **Cash tips** — pooled, or kept by whoever declared them?
4. **Period length** — weekly, biweekly, per-event?
5. **Users** — who needs access, and should a manager see only their own venue?
6. **Square access** — who administers the Square account, and can we get sandbox
   credentials to develop against?
7. **Historical data** — how far back should the first sync reach?
8. **Downstream** — does the export feed a payroll system, or is it read by a
   person?
