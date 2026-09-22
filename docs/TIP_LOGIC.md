# How the Spirit tipping system works

Reverse-engineered from `TIPS_MODEL_FILE.xlsx` and verified against a full set
of supplied figures for Forever Country (Aug 28, 2026, $1,072.53). Every
amount and subtotal reproduces exactly.

## The rule, in one sentence

**On a public show, total tips are split 50/50 between Cast & Musicians and
Staff. Cast are paid per head. Staff are paid per hour.**

## Three show types, three different formulas

The workbook has a sheet per show type, and they are not cosmetic variants —
the pool, the denominator and the participating sections all differ.

| | Cast share | Staff denominator | Sections |
|---|---|---|---|
| **Public Show** | 50% | Bar & Service + 50/50 + Kitchen + 6 office hours | Bar, Service, 50/50, Kitchen, Office |
| **Private at Gower** (off-site) | **none — 100% to staff** | Bar & Service + 50/50 + Kitchen + 6 office hours | Bar, Service, 50/50, Kitchen, Office |
| **Private at ACC** | **none — 100% to staff** | **Bar & Service + Kitchen only** | Bar, Service, Kitchen |

As written on the sheets:

- Public — *"Cast and Musicians = 50% of the total Tips collected / Total Of
  Ratio of Cast who worked that Night"* and *"Service, Kitchen, Bar and Office
  = 50% of total tips collected / …"*
- Gower — *"Service, Kitchen, Bar and Office = Total tips collected / …"*
- ACC — *"Total Tips Collected = total tips collected / Total Hours of (Bar &
  Service Total Tipping Hours + Kitchen Total Tipping Hours)"*

Neither private sheet has a Cast & Musicians block at all. Both carry a
**"SERVICE REQUESTED AS PER CONTRACT"** field the public sheet does not.

On the same $1,072.53 and the same hours, the rate therefore differs sharply:

| Show type | Hours | Rate per hour |
|---|---|---|
| Public | 69.56 | 7.709388 |
| Private at Gower | 69.56 | 15.418775 |
| Private at ACC | 59.59 | 17.998490 |

**The ACC bar has its own roster** on its sheet — Al-Deir Butros, Al-Lahout
Svitlana, Bobbit Neil, Halley Patrice, Harris John, King Randy, Pynn Montana —
not the Spirit bartender list.

## 1. Forming the pool

```
Gratuity for the show
+ Cash tips collected at the bar
+ Total Square tips collected
= TOTAL TIPS COLLECTED
```

## 2. Splitting it

```
Cast & Musicians pool = Total x 50%
Staff pool            = Total x 50%
```

The two halves are then divided on completely different units. This is the
heart of the system: **one event, two pay models.**

## 3. Cast & Musicians — paid per head

```
Cast rate = Cast pool / SUM(RATIO of everyone who WORKED tonight)
Each cast member = RATIO x WORKED x Cast rate
```

- `RATIO` is currently **1 for every cast member** — so in practice the pool
  divides equally among those who worked.
- `RATIO` is nonetheless a real lever: set someone to 0.5 or 2 and they take a
  proportionally smaller or larger share. It is the system's built-in
  weighting mechanism, presently unused.
- `WORKED` is binary — 1 or 0. **Hours are irrelevant on this side.** A cast
  member who plays a 20-minute set earns the same as one who is there all night.
- **Technical is counted with Cast**, not with Staff, despite sitting under its
  own heading.

Aug 28: 9 worked (8 cast + 1 technical) → $536.265 / 9 = **$59.59 each**.

## 4. Staff — paid per hour

```
Staff hours = Bar & Service + 50/50 + Kitchen + Office
Staff rate  = Staff pool / Staff hours
Each person = their hours x Staff rate
```

Aug 28: $536.265 / 69.56 h = **$7.709388/hour**.

| Section | Hours | Amount |
|---|---|---|
| Bar & Service | 36.72 | $283.09 |
| 50/50 | 3.97 | $30.61 |
| Kitchen | 22.87 | $176.31 |
| Office | 6.00 | $46.26 |
| **Staff total** | **69.56** | **$536.26** |

Note: **"50/50" is a job, not a split** — the 50/50 raffle host. Easy to
misread as a ratio. It is simply a fourth tipped section.

## 5. Office is a fixed allocation, not worked time

Office/reservations receives a **flat 6.00 hours every show**, split 1.50 each
across four office staff. No timecard produces these hours — it is a standing
administrative share, and it dilutes everyone else's rate by design.

## 6. Rounding — the detail that actually matters

**The rate is never rounded.** Each person's amount is computed from the full
unrounded rate and rounded only for display; section totals then sum the
*unrounded* cells.

Round the rate to $7.71 first and Bar & Service comes to $283.11 instead of the
correct **$283.09**. Two cents, but it is the difference between a sheet that
reconciles and one that does not.

## 7. Reconciliation

```
Cast total + Staff total = Total tips collected, exactly
$536.26   + $536.26     = $1,072.53
```

This is the system's self-check and it must always hold to the penny.

## 8. Behaviours worth preserving

- **The full roster stays on the sheet**, with 0.00 for anyone who did not work.
  Nobody is deleted. The sheet doubles as the staff list.
- **A person can be paid from more than one section in a single night**, and
  their sections are listed separately rather than combined:

  | Person | Sections | Total |
  |---|---|---|
  | Pasechniuk Yana | 50/50 3.97 h ($30.61) + Office 1.50 h ($11.56) | **$42.17** |
  | Khrystyna Zavadetska | Server 3.55 h ($27.37) + Office 1.50 h ($11.56) | **$38.93** |

  Any payout report must **aggregate per person across sections**, or it will
  underpay people who worked two roles.
- **Exclusions are shown, not deleted.** In the older per-night workbooks a
  crossed-out person stays visible with `Included in Total = No` and a written
  reason.
- **Job title belongs to the shift, not the person.** Yana is Service on one
  night and 50/50 on the next.

## 9. What this means for the application

1. Two distinct calculation paths per event — per-head and per-hour — driven off
   one pool. Not a single pro-rata formula.
2. The 50% split, the Office 6.00 hours, and the cast RATIO must all be
   **configurable per location**, since ACC may differ.
3. Cast attendance is a **yes/no** captured per event; staff need **hours**,
   which is what Square's timecards provide. Cast may never clock in at all.
4. Money must be handled in integer cents with a largest-remainder distribution,
   and the reconciliation in §7 asserted in code on every calculation.
5. The workbook layout is per show night, with three variants: Public Show,
   Private Show at Gower (off-site), Private Show at ACC.

## 10. Still unconfirmed

1. **The `15.89`** on the orange banner row of the filled Public Show sheet. It
   is neither the cast rate ($59.59) nor the staff rate ($7.709388). Unexplained.
2. **The Gower sheet lists no Office people, yet its formula still adds 6
   office hours.** The app seeds the public Office roster there so the hours
   have somewhere to land — confirm who should receive them, or whether Gower
   should have no office share at all.
3. Whether a *public* show at ACC uses Spirit's public rules (the app currently
   assumes it does) — only the ACC **private** sheet is documented.
4. Whether `Lundrigan William` and `Lundrigan Ash` are the same person.
5. Whether 8.00 hours is a per-shift cap.
