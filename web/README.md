# Spirit Tips

Web app for distributing show-night tips at **Spirit Theater** and the
**ACC Arts and Culture Center**, with timecards pulled from Square.

The calculation it implements is documented in [`../docs/TIP_LOGIC.md`](../docs/TIP_LOGIC.md).

## Quick start

```bash
npm install
cp .env.example .env.local   # then set DATABASE_URL to your Postgres database
npm run migrate              # creates the schema
npm run seed                 # loads the verified Forever Country show (28 Aug 2026)

ADMIN_EMAIL='you@example.com' ADMIN_PASSWORD='a long passphrase' \
  npm run create-admin       # nobody can sign in until this runs

npm run dev                  # http://localhost:3000
```

Data lives in **Postgres**. For deployment, see [DEPLOY.md](./DEPLOY.md).

No Square credentials are needed: with `SQUARE_ACCESS_TOKEN` unset the app uses a
built-in demo provider, and the header shows **Demo data**. Copy `.env.example`
to `.env.local` and fill it in to hit the real account.

```bash
npm test         # 36 tests: the tip engine, plus hashing and authorisation
npm run build
```

### Screenshots

With the app running, capture the UI to `screenshots/` (gitignored):

```bash
npm run screenshots
```

Covers the shows list, the event sheet, the cast and staff tables, per-person
payouts, the empty second location, dark mode and a 390px phone viewport.
Override `BASE_URL`, `SHOTS_DIR`, or `CHROMIUM_PATH` if Playwright cannot find a
browser. Panel shots are clipped to the panel, with the sticky header pinned
down so it does not render across the capture.

## How it calculates

Three show types, three different formulas — see `src/lib/config.ts`:

| Show type | Cast share | Staff denominator | Sections |
|---|---|---|---|
| Public Show | 50% | Bar & Service + 50/50 + Kitchen + Office | all five |
| Private at Gower | none (100% staff) | Bar & Service + 50/50 + Kitchen + Office | all five |
| Private at ACC | none (100% staff) | Bar & Service + Kitchen | Bar, Service, Kitchen |

Cast are paid **per head** (weighted by ratio, only those who worked); staff are
paid **per hour** at one rate across every section. Private shows have no cast
block and carry a "service requested as per contract" field instead. The ACC bar
has its own roster.

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
src/lib/auth.ts        passwords, sessions, roles, venue authorisation
src/lib/auth.test.ts   hashing and authorisation tests
src/app/login/         sign in
src/app/admin/         people and access
src/app/               UI and server actions
```

## Accounts

Email and password, stored in Postgres — no third-party identity provider.
Sessions are random tokens in an httpOnly cookie; the database keeps only their
SHA-256. Passwords are salted scrypt hashes.

Two roles: **admin** (everything, plus the People page) and **manager** (shows
only). Each person is granted a set of venues; an empty set means all of them. A
manager scoped to Spirit cannot see, export or edit an ACC show — the gate is
`requireLocation()`, applied in every page, API route and server action.

There is no self-service sign-up and no reset email: an admin sets passwords on
the People page.

## Not built yet

- The Night Staff attendance sheet
- Cast identity matching against Square team members (cast may never clock in)
- ACC's rules are currently a copy of Spirit's and are **unconfirmed**
