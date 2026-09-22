# Spirit Tips

Web app for distributing show-night tips at **Spirit Theater** and the
**ACC Arts and Culture Center**, with timecards pulled from Square.

The calculation it implements is documented in [`../docs/TIP_LOGIC.md`](../docs/TIP_LOGIC.md).

## Quick start

```bash
npm install
npm run seed     # loads the verified Forever Country show (28 Aug 2026)
npm run dev      # http://localhost:3000
```

No Square credentials are needed: with `SQUARE_ACCESS_TOKEN` unset the app uses a
built-in demo provider, and the header shows **Demo data**. Copy `.env.example`
to `.env.local` and fill it in to hit the real account.

```bash
npm test         # 22 tests, including golden tests against the real figures
npm run build
```

## How it calculates

Total tips split by percentage between two groups that are paid on different units:

| | Pool | Divided by | Unit |
|---|---|---|---|
| Cast & Musicians | 50% | sum of ratios for those who **worked** | per head |
| Staff | 50% | total **tipping hours** | per hour |

Everything is **integer cents**, distributed by the largest-remainder method, so
each pool is paid out exactly. `cast + staff + unallocated = total` is asserted
on every calculation; if it ever fails the engine throws rather than paying out
a wrong number.

### Two deliberate differences from the spreadsheet

1. **Exact cents.** The workbook displays rounded amounts but sums *unrounded*
   cells, so paying its displayed figures overpays — by 5c on the Aug 28 show
   ($1,072.58 against $1,072.53 collected). This app pays amounts that sum to
   the pool exactly, so a section subtotal can differ from the workbook by a
   cent or two. The app shows that difference rather than hiding it.
2. **Unallocated money is visible.** A pool with no recipients yet (nobody
   ticked as worked) is held and reported, never silently dropped.

## Square

One OAuth token covers **both** locations, so the location is a filter on every
request, not a separate connection. The client uses `/v2/labor/timecards/*`
(Square renamed Shift to Timecard in API version `2025-05-21`; Shifts is
deprecated) and pins the API version.

Sync pulls team members, timecards and tip payments for the selected location
and event date, using **that location's timezone** for the day boundary. Rows a
human has edited are flagged `overridden` and keep their values; the conflict is
reported instead of being resolved silently.

## Location scoping

Every operational read goes through a location-scoped helper, and every mutation
re-checks that the target row belongs to the active location. Opening another
location's event returns 404, as does exporting it.

## Layout

```
src/lib/tips.ts        the engine (pure, no I/O)
src/lib/tips.test.ts   golden tests against the verified figures
src/lib/money.ts       integer cents, largest-remainder allocation
src/lib/square/        live client + demo provider behind one interface
src/lib/mapping.ts     Square wage title -> sheet section
src/lib/xlsxExport.ts  workbook export
src/app/               UI and server actions
```

## Not built yet

- User accounts and per-venue permissions
- The Night Staff attendance sheet
- Cast identity matching against Square team members (cast may never clock in)
- ACC's rules are currently a copy of Spirit's and are **unconfirmed**
