/**
 * restoreCharactersPostSleepClear
 *
 * Runs AFTER sleep is cleared. For every character with resolved_presence_status = 'home'
 * that should actually be at work or school right now, this corrects their DB state.
 *
 * USER-SCOPED: Uses base44.entities (RLS applies via session). Reads owner_email characters only.
 *
 * Logic:
 * 1. Fetch all characters for this user
 * 2. For each character currently showing 'home' (possibly incorrectly):
 *    - Check if they should be at work (work_days, work_start_time, work_end_time, location shift)
 *    - Check if they should be at school (enrolled, weekday, 8–15h)
 *    - Check confinement (jail, house arrest)
 *    - Correct if mismatch found
 * 3. Never changes characters already at correct states (at_work, at_school, visiting, etc.)
 * 4. Returns per-character before/after proof
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toMin(t) {
  if (!t) return null;
  const parts = t.split(':').map(Number);
  return parts[0] * 60 + (parts[1] || 0);
}

function isOnWorkScheduleNow(char, nowET, locationMap) {
  if (!char.work_start_time || !char.work_end_time || !Array.isArray(char.work_days)) return { onShift: false, workLocId: null };
  const dayOfWeek = nowET.getDay();
  if (!char.work_days.includes(dayOfWeek)) return { onShift: false, workLocId: null };

  // CALLOUT GUARD
  const todayET = nowET.toISOString().slice(0, 10);
  if (char.work_exception_status === 'called_out' && char.work_exception_date === todayET) return { onShift: false, workLocId: null };

  const nowMin = nowET.getHours() * 60 + nowET.getMinutes();

  // Collect all work location IDs
  const allWorkLocIds = [];
  if (char.occupation_location_id) allWorkLocIds.push(char.occupation_location_id);
  if (char.current_work_location_id && !allWorkLocIds.includes(char.current_work_location_id)) allWorkLocIds.push(char.current_work_location_id);
  if (Array.isArray(char.additional_occupation_locations)) {
    for (const entry of char.additional_occupation_locations) {
      if (entry.location_id && !allWorkLocIds.includes(entry.location_id)) allWorkLocIds.push(entry.location_id);
    }
  }

  // Check each work location for an active shift
  for (const locId of allWorkLocIds) {
    const loc = locationMap[locId];
    if (!loc) continue;
    const locationShift = loc.worker_shifts?.[char.id];
    if (locationShift) {
      if (!locationShift.start || !locationShift.end) continue;
      const checkDay = Array.isArray(locationShift.days) && locationShift.days.length > 0
        ? locationShift.days.includes(dayOfWeek)
        : true;
      if (!checkDay) continue;
      const startMin = toMin(locationShift.start);
      const endMin = toMin(locationShift.end);
      const active = endMin < startMin ? (nowMin >= startMin || nowMin < endMin) : (nowMin >= startMin && nowMin < endMin);
      if (active) return { onShift: true, workLocId: locId };
      // Shift defined but not active for this location — skip character-level fallback for this loc
      continue;
    }
    // No location-specific shift — fall back to character-level schedule
    const startMin = toMin(char.work_start_time);
    const endMin = toMin(char.work_end_time);
    if (startMin === null || endMin === null) continue;
    const active = endMin < startMin ? (nowMin >= startMin || nowMin < endMin) : (nowMin >= startMin && nowMin < endMin);
    if (active) return { onShift: true, workLocId: locId };
  }

  return { onShift: false, workLocId: null };
}

function isAtSchoolNow(char, nowET) {
  if (char.student_status !== 'enrolled' || !char.education_location_id) return false;
  const dayOfWeek = nowET.getDay();
  if (![1, 2, 3, 4, 5].includes(dayOfWeek)) return false;
  const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
  return nowMin >= 8 * 60 && nowMin < 15 * 60;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run === true;

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowIso = nowET.toISOString();

    console.log(`[restoreCharactersPostSleepClear] START owner=${user.email} ET=${nowET.toLocaleTimeString('en-US')} dry_run=${dry_run}`);

    // Load all characters for this user (RLS-scoped)
    const allChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      null, 500
    );

    // Load all locations for this user (RLS-scoped via owner_email)
    const allLocations = await base44.entities.LocationReference.filter(
      { owner_email: user.email }, null, 300
    ).catch(() => []);
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    const active = allChars.filter(c =>
      c.status !== 'deleted' && c.status !== 'soft_deleted' &&
      c.status !== 'moved_away' && c.status !== 'merged'
    );

    const results = [];
    let corrected = 0;
    let alreadyCorrect = 0;
    let skipped = 0;

    for (const char of active) {
      const currentStatus = char.resolved_presence_status;
      const currentLocId = char.resolved_current_location_id;
      const charName = char.name || char.display_name || char.id;

      const entry = {
        id: char.id,
        name: charName,
        character_type: char.character_type,
        before_status: currentStatus,
        before_location_id: currentLocId,
        before_location_name: char.resolved_current_location_name,
        before_source: char.resolved_source_reason,
        after_status: null,
        after_location_id: null,
        after_source: null,
        action: 'none',
      };

      // Only act on characters showing home (possibly incorrect after sleep clear)
      // Also act on any character whose resolved_source_reason was 'sleep_cleared_home_fallback'
      const needsRecheck = currentStatus === 'home' || char.resolved_source_reason === 'sleep_cleared_home_fallback';

      if (!needsRecheck) {
        entry.action = 'skipped_not_home';
        alreadyCorrect++;
        results.push(entry);
        continue;
      }

      // Hard protections — never override confinement
      if (char.is_jailed) {
        entry.action = 'skipped_incarcerated';
        skipped++;
        results.push(entry);
        continue;
      }

      if (char.house_arrest_active) {
        entry.action = 'skipped_house_arrest';
        skipped++;
        results.push(entry);
        continue;
      }

      // Check work schedule
      const workCheck = isOnWorkScheduleNow(char, nowET, locationMap);
      if (workCheck.onShift && workCheck.workLocId) {
        const workLoc = locationMap[workCheck.workLocId];
        const update = {
          resolved_presence_status: 'at_work',
          resolved_current_location_id: workCheck.workLocId,
          resolved_current_location_name: workLoc?.name || 'Work',
          resolved_location_type: 'work',
          resolved_source_reason: 'work_schedule',
          resolved_last_updated_at: nowIso,
        };

        if (!dry_run) {
          await base44.entities.Character.update(char.id, update);
          console.log(`[restoreCharactersPostSleepClear] ✓ ${charName}: home → at_work @ ${workLoc?.name || workCheck.workLocId}`);
        }

        entry.after_status = 'at_work';
        entry.after_location_id = workCheck.workLocId;
        entry.after_location_name = workLoc?.name;
        entry.after_source = 'work_schedule';
        entry.action = 'corrected_to_work';
        corrected++;
        results.push(entry);
        continue;
      }

      // Check school schedule
      if (isAtSchoolNow(char, nowET)) {
        const schoolLoc = locationMap[char.education_location_id];
        const update = {
          resolved_presence_status: 'at_school',
          resolved_current_location_id: char.education_location_id,
          resolved_current_location_name: schoolLoc?.name || 'School',
          resolved_location_type: 'school',
          resolved_source_reason: 'school_schedule',
          resolved_last_updated_at: nowIso,
        };

        if (!dry_run) {
          await base44.entities.Character.update(char.id, update);
          console.log(`[restoreCharactersPostSleepClear] ✓ ${charName}: home → at_school @ ${schoolLoc?.name}`);
        }

        entry.after_status = 'at_school';
        entry.after_location_id = char.education_location_id;
        entry.after_location_name = schoolLoc?.name;
        entry.after_source = 'school_schedule';
        entry.action = 'corrected_to_school';
        corrected++;
        results.push(entry);
        continue;
      }

      // Home is correct — just clear the fallback reason to home
      if (char.resolved_source_reason === 'sleep_cleared_home_fallback') {
        const homeId = char.current_home_location_id || char.home_location_id;
        const homeLoc = homeId ? locationMap[homeId] : null;
        const update = {
          resolved_presence_status: 'home',
          resolved_current_location_id: homeId || currentLocId,
          resolved_current_location_name: homeLoc?.name || char.resolved_current_location_name,
          resolved_location_type: 'home',
          resolved_source_reason: 'home_fallback',
          resolved_last_updated_at: nowIso,
        };

        if (!dry_run) {
          await base44.entities.Character.update(char.id, update);
        }

        entry.after_status = 'home';
        entry.after_location_id = homeId || currentLocId;
        entry.after_source = 'home_fallback';
        entry.action = 'confirmed_home';
        alreadyCorrect++;
      } else {
        entry.action = 'already_home_correct';
        alreadyCorrect++;
      }

      results.push(entry);
    }

    const atWork = results.filter(r => r.action === 'corrected_to_work');
    const atSchool = results.filter(r => r.action === 'corrected_to_school');

    console.log(`[restoreCharactersPostSleepClear] DONE: corrected=${corrected} already_correct=${alreadyCorrect} skipped=${skipped}`);

    return Response.json({
      success: true,
      dry_run,
      et_time: nowET.toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
      total_checked: active.length,
      corrected,
      already_correct: alreadyCorrect,
      skipped,
      corrected_to_work: atWork.map(r => ({ name: r.name, location: r.after_location_name, was: r.before_status })),
      corrected_to_school: atSchool.map(r => ({ name: r.name, location: r.after_location_name, was: r.before_status })),
      full_results: results,
    });

  } catch (error) {
    console.error('[restoreCharactersPostSleepClear] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});