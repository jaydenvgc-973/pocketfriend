/**
 * auditMaceShifts
 * Check both of Mace's job locations to see which one he's actually on shift at
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toMin(t) {
  if (!t) return null;
  const parts = t.split(':').map(Number);
  return parts[0] * 60 + (parts[1] || 0);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
    const dayOfWeek = nowET.getDay();

    // Get Mace
    const maceList = await base44.entities.Character.filter(
      { owner_email: user.email, name: 'Mace' }, null, 10
    );
    const mace = maceList[0];
    if (!mace) return Response.json({ error: 'Mace not found' }, { status: 404 });

    // Get locations
    const allLocations = await base44.entities.LocationReference.filter(
      { owner_email: user.email }, null, 300
    ).catch(() => []);
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    console.log(`[auditMaceShifts] Checking Mace (${mace.id})`);
    console.log(`[auditMaceShifts] Current status: ${mace.resolved_presence_status}`);
    console.log(`[auditMaceShifts] Current location: ${mace.resolved_current_location_name} (${mace.resolved_current_location_id})`);

    const workLocIds = [];
    if (mace.occupation_location_id) workLocIds.push(mace.occupation_location_id);
    if (mace.current_work_location_id && !workLocIds.includes(mace.current_work_location_id)) 
      workLocIds.push(mace.current_work_location_id);
    if (Array.isArray(mace.additional_occupation_locations)) {
      for (const entry of mace.additional_occupation_locations) {
        if (entry.location_id && !workLocIds.includes(entry.location_id)) 
          workLocIds.push(entry.location_id);
      }
    }

    const shiftInfo = [];
    for (const locId of workLocIds) {
      const loc = locationMap[locId];
      const locShift = loc?.worker_shifts?.[mace.id];
      const isOnShift = locShift ? 
        (locShift.start && locShift.end) : false;

      let shiftDetail = `NOT ON SHIFT`;
      if (locShift?.start && locShift?.end) {
        const checkDay = !locShift.days || locShift.days.includes(dayOfWeek);
        if (checkDay) {
          const startMin = toMin(locShift.start);
          const endMin = toMin(locShift.end);
          const active = endMin < startMin ? (nowMin >= startMin || nowMin < endMin) : (nowMin >= startMin && nowMin < endMin);
          shiftDetail = `${locShift.start}-${locShift.end} (${active ? 'ACTIVE NOW' : 'NOT ACTIVE'})`;
        } else {
          shiftDetail = `${locShift.start}-${locShift.end} (NOT TODAY)`;
        }
      } else if (!locShift) {
        shiftDetail = `NO EXPLICIT SHIFT DEFINED`;
      }

      shiftInfo.push({
        location_id: locId,
        location_name: loc?.name,
        shift_defined: !!locShift,
        shift_start: locShift?.start,
        shift_end: locShift?.end,
        shift_days: locShift?.days,
        shift_detail: shiftDetail,
      });
    }

    return Response.json({
      success: true,
      mace_id: mace.id,
      mace_name: mace.name,
      et_time: nowET.toLocaleTimeString('en-US'),
      day_of_week: dayOfWeek,
      current_presence_status: mace.resolved_presence_status,
      current_location: mace.resolved_current_location_name,
      character_work_schedule: {
        work_start_time: mace.work_start_time,
        work_end_time: mace.work_end_time,
        work_days: mace.work_days,
      },
      all_jobs: workLocIds,
      shifts_by_location: shiftInfo,
    });

  } catch (error) {
    console.error('[auditMaceShifts] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});