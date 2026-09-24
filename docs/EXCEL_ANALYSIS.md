# Analysis of the sample workbooks

Source: `Spirit_Staff_Tips_2026-08-26.xlsx`, `-08-28.xlsx`, `-09-03.xlsx` on `main`.

## 1. The unit of work is a show night, not a pay period

Each workbook covers **one event**. The filename carries the date, and the
header carries the show:

| File | Date | Show | Attendance |
|---|---|---|---|
| 2026-08-26 | Aug 26, 2026 | Dwight's Wedding | 164 |
| 2026-08-28 | Aug 28, 2026 | Forever Country | 86 |
| 2026-09-03 | Sep 3, 2026 | Home Sweet Home-I-Cide | Not recorded |

This is the single biggest correction to the original plan, which assumed
biweekly pay periods. The domain object is an **Event** (date + show name +
attendance), and tips are pooled per event.

## 2. There is no money in these sheets

No tip totals, no hourly rates, no payout column, no currency formatting
anywhere in any of the three files. The workbook computes **tip hours only** —
the denominator of the split. Whatever multiplies those hours by a dollar pool
happens somewhere else (another sheet, Square payroll, or by hand).

This materially changes scope and is the first thing to settle. See open
questions.

## 3. Two sheets, two jobs

### Sheet 1 — `Tip Hours` (the calculation)
`Last Name | First Name | Job Title | Regular Hours | Included in Total | Notes`

Ends with a three-row reconciliation block:

```
Calculated included hours   =SUMIFS(D7:D23,E7:E23,"Yes")
Source reported total       90.1
Difference                  =D25-D26
```

All three files reconcile to **0.00**. This block is the trust mechanism of the
whole document and must survive into the app — pointed at Square instead of at
a paper form.

### Sheet 2 — `Night Staff` (the attendance cross-check)
`Role | Name | Checked on Source | Notes`, plus guest attendance and staff meals.
Roles: Server, Bar, Kitchen, Cast & Band, Host, 50/50 Host, Tech.

Its purpose is verification: every tipped person should appear on both sheets.

## 4. Today's workflow is transcription from a scanned paper form

The `Source` field names a PDF on both sheets — `Aug-26-2026 Tips(1).pdf, page 1`,
`staff_aug_26(1).pdf, page 1`. The Notes columns are unmistakably about reading
handwriting:

- `Crossed out on source; excluded from corrected total`
- `Handwritten first name appears as Mariia/Marisha`
- `Replaced a crossed-out entry on source`
- `3:15-10:40; 7.30 hours noted on form`

So the current process is: paper timesheet → scan to PDF → hand-transcribe into
Excel → reconcile against the total written on the form. **The app's core value
is deleting the transcription step**, not reformatting the output.

## 5. Eligibility is an explicit, reasoned toggle

`Included in Total` is Yes/No with a Notes justification. The only No in the
sample: Paul Philpot, Cleaner, 2.30h, crossed out on the source form. The
reconciliation formula counts only `"Yes"` rows, so exclusions are visible in
the sheet but out of the total — never deleted. The app must copy this exactly:
exclude, never delete, and always require a reason.

## 6. `Office` is a synthetic participant

```
A23='Office'   D23=6   E23='Yes'     (no first name, no job title)
```

Flat **6.00 hours on every night**, all three files. It is a house/admin share
that no timecard will ever produce. The app needs configurable synthetic
participants per location, with a fixed hour value.

## 7. Cast & Band and Tech are not tip-eligible

Cross-referencing the sheets, the people on `Night Staff` who never appear on
`Tip Hours` are, in every file, exactly the **Cast & Band** members and **Tech**
(Adam). Tipped roles are Server/Service, Bar/Bartender, Kitchen/Chef, Busser,
Host/Server Manager, 50/50, Team Member.

## 8. Job title is per-event, not per-person

Yana Pasechniuk is `Service` on Aug 26, then `50/50` on Aug 28 and Sep 3. Kate
Griffin holds `50/50` on Aug 26. The role belongs to **the shift**, not to the
person.

This maps cleanly onto Square: `Timecard.wage.title` is per-timecard. Store job
title on the timecard row; never on the team member.

## 9. Name matching is the hard integration problem

The two sheets identify people differently, and neither matches Square's format:

- `Tip Hours` uses `Last, First`; `Night Staff` uses first name only.
- Inconsistently, though — `Dan` vs `Dan Lasby`, `Kara` vs `Kara Noftle`,
  `Adam` vs `Adam Blackwood`, `Ron` vs `Ron Collins`, `Jackie` vs `Jackie Pynn`.
- Spelling variants for one person: `Marila` (Tip Hours) vs `Maria` (Night
  Staff); `Mariia`/`Marisha` flagged in a note.
- `Lundrigan, William` (Aug 26, Aug 28) and `Lundrigan, Ash` (Sep 3) — same
  surname, same Kitchen role, never both present. Likely one person under a
  changed or preferred name. **Needs confirmation — do not merge on a guess.**

Design consequence: Square's `team_member_id` becomes the identity key, with a
stored alias table mapping historical sheet spellings onto it. Fuzzy matching
may *propose* a link; a human confirms it once, and it persists.

## 10. Hours

Two decimal places, `0.00` format — consistent with Square decimal hours.
Observed range 2.30–8.00. Four rows sit at exactly 8.00 while no other row
exceeds 7.38, which suggests a per-shift cap at 8 hours. Unconfirmed.

## 11. Formatting to reproduce in the export

- Font Arial throughout; title 15pt bold; headers 10pt bold, centered.
- Date cells `mmm d, yyyy`; hours `0.00`.
- Freeze panes: `A7` on Tip Hours, `A8` on Night Staff.
- Column widths — Tip Hours: 18, 16, 20, 15, 18, 48. Night Staff: 19, 24, 20, 49.
- No merged cells, no fills, no borders. Deliberately plain.
- Reconciliation block written as a **live `SUMIFS` formula**, not a value, so
  the recipient can edit hours in Excel and watch the difference update.

## 12. What this means for the Square integration

| Sheet element | Square source |
|---|---|
| Date | Event date, in the location's timezone |
| Show | Manual entry (not in Square) |
| Last / First Name | `TeamMember.given_name` / `family_name` |
| Job Title | `Timecard.wage.title` |
| Regular Hours | `Timecard` start/end minus breaks, to 2dp |
| Included in Total | App rule set + manual override |
| Source reported total | Manual entry during paper-parallel period |
| Guest attendance | Manual entry (not in Square) |
| Night Staff roster | Timecards + manually added non-clocking staff |

Cast & Band and Tech likely never clock into Square at all, so the Night Staff
sheet needs manual rows alongside synced ones.

## 13. Questions these files raise

1. **Does the app need to calculate dollars, or only hours?** Nothing in these
   files does. If dollars, where does the pool total come from — Square card
   tips, or a figure someone enters?
2. What is `Office`'s 6.00 hours, and is it 6.00 at ACC too?
3. Is `Lundrigan, William` the same person as `Lundrigan, Ash`?
4. Is 8.00 a cap, or a coincidence?
5. Does ACC run the same two-sheet format, same roles, same exclusions?
6. Do Cast & Band / Tech clock into Square, or are they always manual?
7. Should `Source reported total` survive once Square is authoritative, or is it
   scaffolding for the paper-parallel period only?
8. One workbook per event, or one per month with a tab per show?
