import { NextRequest } from 'next/server';
import { loadEvent, toEngineInput } from '@/lib/service';
import { calculate } from '@/lib/tips';
import { buildWorkbook } from '@/lib/xlsxExport';
import { getLocation, getShowTypeForLocation } from '@/lib/config';
import { currentUser, canSeeLocation } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const locationId = req.nextUrl.searchParams.get('location') ?? '';
  const user = await currentUser();
  if (!user) return new Response('Sign in required', { status: 401 });

  const loc = getLocation(locationId);
  if (!loc || !canSeeLocation(user, loc.id)) {
    return new Response('Not found', { status: 404 });
  }

  const loaded = await loadEvent(id, loc.id);
  if (!loaded) return new Response('Not found for this location', { status: 404 });

  const show = getShowTypeForLocation(
    loaded.event.show_type_id, loaded.event.location_id);
  const r = calculate(toEngineInput(loaded.event, loaded.cast, loaded.staff, loaded.extras));
  const buf = await buildWorkbook(r, {
    locationName: loc.name,
    showType: loaded.event.show_type,
    showName: loaded.event.show_name,
    eventDate: loaded.event.event_date,
    guestAttendance: loaded.event.guest_attendance,
    contractService: loaded.event.contract_service,
    hasCast: show.hasCast,
    sections: show.sections,
    formula: show.formula,
    screechOnly: show.screechOnly,
    sageRef: loaded.event.sage_ref,
  });

  const safe = (loaded.event.show_name || 'show').replace(/[^a-z0-9]+/gi, '_');
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        `attachment; filename="${loc.id}_${safe}_${loaded.event.event_date}.xlsx"`,
    },
  });
}
