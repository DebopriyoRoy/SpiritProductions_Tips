import ExcelJS from 'exceljs';
import { NextRequest } from 'next/server';
import { nightsBetween, payoutRosterFor } from '@/lib/service';
import { addNightSheet, sheetNameForDate } from '@/lib/xlsxExport';
import { addPayoutSheet } from '@/lib/payoutSheet';
import { currentUser, visibleLocations } from '@/lib/auth';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The fortnight workbook: a sheet for every night between two dates, Spirit's
 * then ACC's, then a "TOTAL PAYOUT" sheet for each venue.
 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return new Response('Sign in required', { status: 401 });

  const sp = req.nextUrl.searchParams;
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  if (!ISO.test(from) || !ISO.test(to) || from > to) {
    return new Response('Pick a start date on or before the end date.', { status: 400 });
  }
  const scope = sp.get('scope') ?? 'all';
  const venues = visibleLocations(user)
    .filter((l) => scope === 'all' || l.id === scope);
  if (!venues.length) return new Response('Not found', { status: 404 });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Spirit Tips';
  const totals: { name: string; nights: Awaited<ReturnType<typeof nightsBetween>>;
                  locationId: string }[] = [];
  for (const loc of venues) {
    const nights = await nightsBetween(loc.id, from, to);
    for (const n of nights) addNightSheet(wb, n.result, n.meta);
    if (nights.length) {
      totals.push({ name: `TOTAL PAYOUT ${loc.id.toUpperCase()}`, nights, locationId: loc.id });
    }
  }
  if (!totals.length) {
    return new Response(
      `No calculated tips between ${from} and ${to} for the chosen venues.`,
      { status: 404 });
  }
  for (const t of totals) {
    addPayoutSheet(wb, t.name,
      t.nights.map((n) => ({
        // Dated as Spirit's tabs are, for both venues; a second show keeps its "(2)".
        label: sheetNameForDate(n.meta.eventDate)
          + (n.meta.sheetName!.match(/ \(\d+\)$/)?.[0] ?? ''),
        result: n.result,
      })),
      payoutRosterFor(t.locationId));
  }

  // Named as the office names it: Tips_09-08to09-19_.xlsx
  const md = (d: string) => d.slice(5);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        `attachment; filename="Tips_${md(from)}to${md(to)}_.xlsx"`,
    },
  });
}
