# Spirit Productions Tips — Implementation Plan

A multi-location web application that pulls timecards and tips from Square,
scoped to a selected location, computes tip distribution, and exports a sheet
matching the existing Spirit Theater workbook.

**Locations in scope**
1. ACC Arts and Culture Center
2. Spirit Theater

---

## 0. Status

**The sample workbooks are in the repo** (`main`): three files covering
Aug 26, Aug 28 and Sep 3, 2026. They are analysed in full in
[`EXCEL_ANALYSIS.md`](./EXCEL_ANALYSIS.md). That analysis corrected several
assumptions in an earlier draft of this plan — most importantly that the unit
of work is **a show night, not a pay period**, and that the sheets contain
**no dollar amounts at all**.

**Git:** read access to the repo works. **Push is blocked** — the Claude GitHub
App is not installed on `DebopriyoRoy/SpiritProductions_Tips`, so commits are
local only until that is fixed at
https://github.com/apps/claude/installations/select_target.

**Still blocking design work:** the money question (Q1 in the analysis) and the
ACC format question (Q5). Everything else can proceed.

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
event               location_id, event_date, show_name, guest_attendance,
                    staff_meals_note, source_pdf_ref, source_reported_hours,
                    status: draft | syncing | synced | finalized | exported
                    unique(location_id, event_date, show_name)
timecard            square_timecard_id (unique), location_id, event_id, team_member_id,
                    start_at, end_at, break_minutes, worked_minutes,
                    wage_title, hourly_rate_cents, declared_cash_tip_cents,
                    source(synced|manual), is_overridden, synced_payload jsonb
tip_transaction     square_payment_id (unique), location_id, event_id, order_id,
                    created_at, tip_cents, method(card|cash), team_member_id nullable
tip_rule_set        location_id, effective_from, pool_scope, weights jsonb,
                    min_hours_eligible, cash_tips_pooled bool, rounding_policy
tip_allocation      event_id, team_member_id, worked_minutes, weight,
                    pool_cents, share_cents, manual_adjustment_cents, note
sync_run            location_id, event_id, started_at, finished_at, status,
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

## 6. Tip hours engine

The sample workbooks compute **hours, not dollars** (analysis §2). So the engine
is built in two separable layers, and layer 2 is only built if the answer to Q1
is "yes, we need dollars".

**Layer 1 — tip hours (confirmed, build now)**

```
tipHours(timecards, syntheticParticipants, ruleSet) -> rows + reconciliation
```

- Pull each timecard's worked minutes; subtract breaks; round to 2dp.
- Apply eligibility: Cast & Band and Tech excluded by default (analysis §7);
  per-row override with a mandatory note (analysis §5).
- Append synthetic participants — `Office` at a flat 6.00 h.
- Emit the reconciliation triple: calculated included hours, source reported
  total (manual, optional), difference.

Excluded rows are **retained and shown**, never dropped — matching the SUMIFS
behaviour in the sheet.

**Layer 2 — dollar allocation (only if Q1 says so)**

```
allocate(tipHourRows, poolCents, ruleSet) -> allocations
```

Pro-rata by tip hours, integer cents throughout, largest-remainder distribution
so `sum(share_cents) == pool_cents` exactly — asserted in code and tested. No
floats for money, ever. Where the pool comes from (Square card tips vs a figure
someone types in) is itself part of Q1.

**Golden-file tests.** The three sample workbooks are regression fixtures: given
their hour rows, the engine must reproduce 90.10, 69.56 and 73.44 exactly, and
must reproduce Paul Philpot's exclusion on Sep 3. This is the cheapest
correctness guarantee available and should land in Phase 5.

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
| 0 | Install GitHub App; answer Q1 (dollars?) and Q5 (ACC format) | **user** |
| 1 | Repo scaffold, Next.js + Prisma + Postgres, app auth, location model | — |
| 2 | Square OAuth, Locations + Team sync, location switcher | 1 |
| 3 | Event model, timecard sync per event date, timezone handling | 2 |
| 4 | Identity: alias table, match-confirmation UI | 3 |
| 5 | Tip hours engine + golden-file tests against the three workbooks | 3, 4 |
| 6 | UI: Tip Hours grid, Night Staff sheet, exclusions with notes, reconciliation | 5 |
| 7 | Excel export reproducing the exact layout and formatting (analysis §11) | 6 |
| 8 | Dollar allocation layer — **only if Q1 requires it** | 5, 7 |
| 9 | Hardening: scoping tests, roles, deploy, paper-parallel runbook | 7 |

Phases 1–3 can start immediately. Phase 8 may not exist at all.

**Paper-parallel rollout.** For the first few events, run the app alongside the
existing paper process and enter the form's handwritten total into
`source_reported_hours`. The difference row then reads as "Square vs the form"
and proves the integration before anyone trusts it. That is the same safeguard
the workbook already uses, pointed at a new source.

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Name matching wrong (Marila/Maria, William/Ash) | Tips to the wrong person | Square `team_member_id` as identity; alias table; human confirms every proposed match once |
| Staff don't clock in/out in Square | No timecard, no hours, person silently missing | Compare Night Staff roster against synced timecards; flag anyone present but unclocked |
| Cast & Band / Tech never in Square | Night Staff sheet incomplete | Manual rows alongside synced ones |
| Timezone boundary errors | Late shifts land on the wrong show date | Per-location timezone from Square; tests around midnight and DST |
| Open timecards at sync time | Hours understated | Block finalize while open timecards exist for the event date |
| Two shows on one date | Hours split across the wrong event | `unique(location, date, show)`; assign timecards to a show by time window |
| Square API version drift | Silent response shape changes | Pin API version; contract tests against sandbox |
| Float money arithmetic (if Phase 8 happens) | Off-by-cents, lost trust | Integer cents only; reconciliation invariant enforced |
| Re-sync overwriting manual edits | Corrections and exclusion notes lost | `is_overridden`; conflicts reported, never auto-resolved |
| Cross-location leakage | Wrong pay, real harm | Scoping enforced at data layer + tested (§5) |

---

## 10. Open questions

Ordered by how much they block. Full detail in
[`EXCEL_ANALYSIS.md`](./EXCEL_ANALYSIS.md) §13.

1. **Does the app need to produce dollar amounts, or only tip hours?** The
   sample sheets contain no money whatsoever. If dollars, where does the pool
   total come from — Square card tips, or a figure someone enters? *This decides
   whether Phase 8 exists.*
2. **Does ACC use the same two-sheet format**, same roles, same exclusion rules?
   If it differs, the export needs per-location templates.
3. Is `Lundrigan, William` the same person as `Lundrigan, Ash`?
4. What is the `Office` row's flat 6.00 hours, and is it also 6.00 at ACC?
5. Do Cast & Band and Tech clock into Square at all?
6. Is 8.00 hours a cap, or a coincidence in this sample?
7. Should `Source reported total` remain permanently, or retire after the
   paper-parallel period?
8. One workbook per event, or one per month with a tab per show?
9. Who needs access, and should a manager see only their own venue?
10. Square sandbox credentials — who administers the account?
