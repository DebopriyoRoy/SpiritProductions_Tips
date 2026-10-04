# Adding Screech-In to the tips app — proposal

Based on `Tips_09-08to09-19_.xlsx` (the target output) compared with the app in
`web/`. Nothing in the app mentions screech-in today (`grep -ri screech web/src`
finds nothing).

## 1. What Screech-In is, as the workbook shows it

Screech-In is a **separate, small tip pool** from the screech-in ceremony. It is
never part of the show's 50/50 Cast/Staff split.

| Date | Sheet | Tips | Paid to | How it's split |
|---|---|---|---|---|
| Sep 8 | own sheet | 11.94 | Bridget Hiller | one host, all of it |
| Sep 8 | same sheet, 2nd block | 10.16 | Keith Power 5.08, Adam Blackwood (Helper) 5.08 | equal; note "27 people" |
| Sep 9 | own sheet | 14.55 | Bridget Hiller | one host |
| Sep 10 | under the show sheet | 12.55 | Natalie Noseworthy | one host |
| Sep 11 | under the show sheet | 75.82 (see §6) | Natalie 37.91, Joleen Dickson 37.91 | equal |
| Sep 13 | own sheet | 16.23 | Dan Lasby | one host |
| Sep 15 | own sheet | 55.77 | Peter Halley | one host |
| Sep 16 | own sheet | 11.69 | Natalie Noseworthy | one host |

The rules that fall out of this:

1. **Own pool.** On Sep 10 the show reconciles to 2,428.13 without the 12.55;
   the screech money is added on top, after the show is done.
2. **Split equally among whoever hosted** (1 or 2 people so far). A helper
   gets the same share as a host.
3. **Two kinds of night:**
   - *Screech-In only* (no show): a tiny 3-column sheet — Person, Tips
     Collected, Amount Receivable (Sep 8, 9, 13, 15, 16).
   - *Screech-In on a show night*: a "Screech - IN" block under the show's
     payout table, then a **"Total for <name>"** line that adds the person's
     show payout and screech share (Sep 10: Natalie 29.76 + 12.55 = 42.31;
     Sep 11: Joleen 85.64 + 37.91 = 123.55).
4. **Hosts come from anywhere.** Office (Bridget, Natalie), cast (Dan, Keith),
   bar (Joleen), technical (Adam) — and people on no roster at all (Peter
   Halley).
5. **Guests are counted** ("27 people") but don't change the money.
6. **It flows into the period roll-up.** `TOTAL PAYOUT SPIRIT` pulls screech
   amounts into each person's column for that date, with an
   "Other / Screech-In" group for people with no other row (Peter Halley).

## 2. Where the app stands

- `src/lib/tips.ts` `calculate()` handles one pool: total → cast/staff split.
- `src/lib/db.ts` has `event`, `cast_row`, `staff_row`. Nothing for a second pool.
- `src/lib/xlsxExport.ts` writes one sheet per event, ending at
  "Payout per person" (it matches the show sheets in the workbook exactly).
- There is **no period roll-up** (the `TOTAL PAYOUT` sheets) in the app either.
  That's a separate gap, but screech-in needs it to be fully useful.

## 3. Recommended design

**A screech-in is a second, independent pool attached to an event**, plus a
"Screech-In only" show type for nights without a show. This keeps the show's
reconciliation untouched and reuses all the event plumbing (location, date,
lock/status, export route).

### 3.1 Data (`src/lib/db.ts`)

```sql
ALTER TABLE event ADD COLUMN IF NOT EXISTS screech_tips_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event ADD COLUMN IF NOT EXISTS screech_guests     INTEGER;

CREATE TABLE IF NOT EXISTS screech_row (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'host',   -- 'host' | 'helper', label only
  share        REAL NOT NULL DEFAULT 1,        -- same lever as cast ratio
  pinned_cents INTEGER,                        -- hand-set, like cast/staff
  sort         INTEGER NOT NULL DEFAULT 0
);
```

Add both columns to the migration list in `db.ts` (the comment at ~line 312
warns that `CREATE TABLE IF NOT EXISTS` won't add new columns to old databases).

**Superseded by §5:** a night can have several screech-ins, so this becomes a
`screech_session` table with hosts hanging off each session.

### 3.2 Engine (`src/lib/tips.ts`)

```ts
export interface ScreechEntry { id: string; name: string; share: number;
  role: 'host' | 'helper'; pinnedCents?: Cents | null }

export interface EventInput { ...; screech?: { tipsCents: Cents; hosts: ScreechEntry[] } }

export interface Result { ...;
  screech: (Payout & { role: string; share: number })[];
  screechTotalCents: Cents;
  screechUnallocatedCents: Cents;   // tips entered, nobody ticked yet
}
```

- Compute with the existing `allocateByWeight(tipsCents, shares)` from
  `money.ts`, so it's integer cents and reconciles to the penny, same as the
  rest of the engine. Pinned amounts work the same way as for cast.
- **Do not** add screech into `totalCents`, `castPoolCents`, or `staffPoolCents`.
  Give it its own check: `sum(screech) + unallocated = screechTipsCents`.
- `perPerson` gets screech parts merged by name (a part labelled
  `Screech-In`), so "Total for Natalie" falls straight out of the existing
  aggregation at `tips.ts:383`. Keep a `showAmountCents` beside the combined
  amount so the export can print both lines.

### 3.3 Show type (`src/lib/config.ts`)

Add a `screech-in` entry to `SHOW_TYPES`: `hasCast: false`, `sections: []`,
cast share 0, office hours 0. Add it to both locations' `showTypeIds` (or only
Spirit, if ACC never hosts one). The event page then shows only the screech
card for these nights.

Host picker: a union of every roster in `config.ts` (cast, bar, servers,
kitchen, office), with free-text for people on none (Peter Halley). Names
must match the roster spelling so the "Total for" merge works; reuse
`NAME_ALIASES` matching from `mapping.ts`.

### 3.4 UI (`src/app/events/[id]/page.tsx`, `actions.ts`)

A **Screech-In** card under "Payout per person":
- Tips collected, guests (optional).
- Host rows: name (picker), role, share, amount (computed, pinnable), delete.
- Live preview of each share and, for people also paid on the show, their
  combined total.
- Server actions: extend `saveEventAction` for the two event fields, add
  `addScreechHostAction` / `deleteScreechAction` modelled on
  `addStaffAction` / `deleteStaffAction`. Wire into `service.ts`
  `loadEvent` / `toEngineInput`.

### 3.5 Export (`src/lib/xlsxExport.ts`)

- **Show night:** after the `TOTAL` row, write the "Screech - IN" block (name,
  amount), then "Total for <name>" for each host who also has a show payout —
  exactly the workbook layout.
- **Screech-only night:** the small sheet — `Event: Screech - IN`, `Date`, then
  `Person Name | Tips Collected | Amount Receivable`, guests in a note.

### 3.6 Period roll-up (new, needed to match `TOTAL PAYOUT SPIRIT`)

A "Payout for period" export (date range + location) that lists every person
once by section, one column per event date, and a TOTAL column. Screech-in
amounts land in that person's date column; people with no other row go
under **Other / Screech-In**. I'd recommend a separate "Screech-In" column
or sub-row per date rather than silently adding it into a cast/office cell,
because today the workbook mixes them (Keith's Sep 8 screech sits in his
cast row), which makes the sheet hard to audit.

### 3.7 Tests (`src/lib/tips.test.ts`)

Lock the workbook figures in: Sep 8 (10.16 → 5.08 + 5.08), Sep 10 (show
reconciles to 2,428.13 with screech present; Natalie total 42.31), Sep 11
(Joleen 123.55, Natalie 59.32), odd-cent split (e.g. 10.15 across 2), and
"tips entered, no hosts" goes to unallocated.

## 4. Build order

1. Engine + tests (no UI) — small, safe.
2. DB columns + `screech_row` + service wiring.
3. Event page card + actions.
4. Per-event export block and screech-only sheet.
5. Period roll-up export.

Steps 1–4 are a self-contained PR. Step 5 is its own piece of work.

## 5. Answers from Debopriyo (2026-10-04)

1. **Helpers always get an equal share.** Keep `share` fixed at 1 in the UI;
   the `role` field is only a label (host / helper).
2. **Mainly cash, sometimes Square** (online screech-in bookings with a tip).
   Each screech-in gets `cash_cents` + `square_cents`, same as a show.
3. **One night can have two or more screech-ins.** So it's a
   `screech_session` table (one row per ceremony), not columns on `event`:

```sql
CREATE TABLE IF NOT EXISTS screech_session (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  cash_cents   INTEGER NOT NULL DEFAULT 0,
  square_cents INTEGER NOT NULL DEFAULT 0,
  guests       INTEGER,
  sage_ref     TEXT NOT NULL DEFAULT '',   -- e.g. J6924, see §6
  sort         INTEGER NOT NULL DEFAULT 0
);
-- screech_row.event_id becomes session_id REFERENCES screech_session(id)
```

   Each session is split on its own; a person's "Total for" adds up all
   their sessions plus their show payout.

## 6. Source of truth: Sage account 2118 "Accounts Payable Tips"

The Sage *Transactions by Account* report for 09/07–09/20
(`docs/sage_AP_tips_2026-09-07_to_09-20.pdf`) is where every number in the
workbook comes from. One journal line per show and **one per screech-in**,
with the hosts, helpers and guest count in the comment, e.g.
`record sales screech-in, Keith & Adam as a helper, 27 ppl — J6924 — 10.16`.

What it settles:

- **Sep 11:** Sage J7031 is **75.82** for "Natalie & Joleen as a helper,
  5 ppl". So 75.82 was collected and each got 37.91; the workbook just has
  the two numbers in each other's cells.
- **Sep 8's two blocks** are two journal entries (J6912 Bridget, J6924
  Keith & Adam), confirming two sessions on one night.
- **Lori Pynn 1.74** is AR J7113: *"payment from Lori Pynn for the show on
  Sept. 11, 2026"*. It is a **late tip paid by a customer** for the Sep 11
  show, posted after that show was split. In the workbook it is listed as if
  Lori were owed $1.74 (row 95 of TOTAL PAYOUT SPIRIT, under Other /
  Screech-In). That looks wrong: the money belongs to the Sep 11 show's
  pool, not to Lori.
- **Every credit in the period adds to 6,604.67**, the report's total, and
  the same figure should be the roll-up's GRAND TOTAL.

What it adds to the design:

- **Late tips / adjustments on an event** (new, small): an `event_adjustment`
  row (amount, payer/description, date received, Sage ref). Default
  behaviour: it is added to the show's total and the show is re-split, so
  the extra 1.74 lands on the Sep 11 staff and cast by the normal rules.
  Optionally, show the before/after difference per person so it can be paid
  as a top-up in the next run.
- **Sage reference on every pool** (show, screech session, adjustment), so
  the app's lines match the ledger one-for-one.
- **Period reconciliation** in the roll-up export: "Total paid out this
  period = sum of shows + screech-ins + adjustments", with a box to type
  the Sage 2118 credits total and a CHECK that must be 0.00, the same way
  each show sheet already self-checks.
- Later, optionally: import the Sage report (CSV export rather than PDF) to
  pre-create the screech-in sessions with hosts, helpers and guest counts
  parsed from the comment, for a person to confirm.

## 7. Late tips: the user decides (answered 2026-10-04)

Each late tip has a "Goes to" choice: **Re-split with the show** (added to
the show total and split by the normal rules) or **One person** (paid
straight to the named payee, show split untouched).

## 8. What was built (2026-10-04)

- `tips.ts`: `ScreechSession`, `LateTip` inputs; `screech`, `personTotals`,
  `grandTotalCents`, `lateSplitCents`, `latePersonal` results. Names are
  matched word-order-free, so "Noseworthy, Natalie" and "Natalie Noseworthy"
  meet on one "Total for" line.
- `db.ts`: `screech_session`, `screech_host`, `late_tip` tables; `event.sage_ref`.
- `config.ts`: "Screech-In only" show type (Spirit), `everyone()` host list.
- `service.ts` / `actions.ts`: load and save; add/remove screech-ins, hosts,
  late tips (each saves the sheet first).
- Event page: Screech-In and Late tips cards, "Total for each person" table,
  "Paid out tonight" figure; screech-only nights show just the screech-in.
- Excel export: Late tips, Screech - IN, "Total for <name>" blocks under the
  payout table; the small screech-in sheet for screech-only nights.
- `screech.test.ts`: 12 tests on the Sep 8, 10, 11 and Lori Pynn figures.

Not built yet: the period roll-up (TOTAL PAYOUT sheet) and its Sage check.
