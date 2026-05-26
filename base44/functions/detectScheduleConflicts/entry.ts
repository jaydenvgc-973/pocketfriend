import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Detects schedule conflicts across all character location commitments.
 * 
 * Checks overlaps between:
 * - School enrollment schedules
 * - Work schedules
 * - Religious membership attendance
 * - Any other location-based scheduled commitments
 * 
 * Returns conflicts with details: location, schedule type, overlap times
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { character_id, ignore_location_id } = await req.json();
    if (!character_id) {
      return Response.json({ error: 'character_id required' }, { status: 400 });
    }

    // Fetch character with all schedule data
    const character = await base44.entities.Character.filter({ id: character_id }).then(r => r[0]);
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Collect all location-based schedules
    const schedules = [];

    // School enrollments
    if (character.education_enrollments) {
      character.education_enrollments.forEach((enrollment, idx) => {
        if (enrollment.schedule && (enrollment.status !== 'completed' && enrollment.status !== 'graduated' && enrollment.status !== 'dropped')) {
          schedules.push({
            type: 'school',
            location_id: enrollment.in_person_location_id || character.education_location_id,
            location_name: enrollment.in_person_location_name || character.education_location_name || enrollment.institution,
            schedule: enrollment.schedule,
            label: `${enrollment.course_name || enrollment.program_name || 'School'} (${enrollment.institution || 'Unknown'})`,
            source_index: idx,
            source_array: 'education_enrollments',
          });
        }
      });
    }

    // Work schedules
    if (character.occupation_location_id) {
      const workLoc = await base44.entities.LocationReference.filter({ id: character.occupation_location_id }).then(r => r[0]);
      if (workLoc?.worker_shifts?.[character.id]) {
        const shift = workLoc.worker_shifts[character.id];
        schedules.push({
          type: 'work',
          location_id: character.occupation_location_id,
          location_name: character.occupation_location_name,
          schedule: {
            start_time: shift.start,
            end_time: shift.end,
            days: shift.days || [0, 1, 2, 3, 4, 5, 6],
          },
          label: `Work at ${workLoc.name}`,
        });
      }
    }

    // Additional work locations
    if (character.additional_occupation_locations) {
      for (const occLoc of character.additional_occupation_locations) {
        const loc = await base44.entities.LocationReference.filter({ id: occLoc.location_id }).then(r => r[0]);
        if (loc?.worker_shifts?.[character.id]) {
          const shift = loc.worker_shifts[character.id];
          schedules.push({
            type: 'work',
            location_id: occLoc.location_id,
            location_name: occLoc.location_name || loc.name,
            schedule: {
              start_time: shift.start,
              end_time: shift.end,
              days: shift.days || [0, 1, 2, 3, 4, 5, 6],
            },
            label: `Work at ${loc.name}`,
          });
        }
      }
    }

    // Religious memberships (if they have scheduled attendance)
    if (character.religious_location_id) {
      const relLoc = await base44.entities.LocationReference.filter({ id: character.religious_location_id }).then(r => r[0]);
      if (relLoc?.operating_hours) {
        // Use operating hours as membership "schedule"
        schedules.push({
          type: 'membership',
          location_id: character.religious_location_id,
          location_name: character.religious_location_name || relLoc.name,
          schedule: {
            operating_hours: relLoc.operating_hours,
          },
          label: `Religious member at ${relLoc.name}`,
        });
      }
    }

    // Find conflicts
    const conflicts = [];
    for (let i = 0; i < schedules.length; i++) {
      for (let j = i + 1; j < schedules.length; j++) {
        const s1 = schedules[i];
        const s2 = schedules[j];

        // Skip if either is from the location we're ignoring
        if (ignore_location_id && (s1.location_id === ignore_location_id || s2.location_id === ignore_location_id)) {
          continue;
        }

        // Check time overlap
        const overlap = checkTimeOverlap(s1.schedule, s2.schedule);
        if (overlap) {
          conflicts.push({
            schedule1: { type: s1.type, label: s1.label, location_id: s1.location_id },
            schedule2: { type: s2.type, label: s2.label, location_id: s2.location_id },
            overlap: overlap,
          });
        }
      }
    }

    return Response.json({ 
      character_id,
      total_schedules: schedules.length,
      conflicts,
      all_schedules: schedules,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Helper: Check if two schedules overlap in time.
 * Returns overlap info or null.
 */
function checkTimeOverlap(sched1, sched2) {
  if (!sched1 || !sched2) return null;

  const days1 = sched1.days || [0, 1, 2, 3, 4, 5, 6];
  const days2 = sched2.days || [0, 1, 2, 3, 4, 5, 6];

  // Check day overlap
  const commonDays = days1.filter(d => days2.includes(d));
  if (commonDays.length === 0) return null;

  // Check time overlap
  const start1 = timeToMinutes(sched1.start_time);
  const end1 = timeToMinutes(sched1.end_time);
  const start2 = timeToMinutes(sched2.start_time);
  const end2 = timeToMinutes(sched2.end_time);

  if (start1 === null || end1 === null || start2 === null || end2 === null) {
    return null; // Can't determine overlap without valid times
  }

  // Check if times overlap
  if (end1 > start2 && end2 > start1) {
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
      days: commonDays.map(d => dayLabels[d]).join(', '),
      time_range: `${minutesToTime(Math.max(start1, start2))}-${minutesToTime(Math.min(end1, end2))}`,
    };
  }

  return null;
}

function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${displayH}:${String(m).padStart(2, '0')}${period}`;
}