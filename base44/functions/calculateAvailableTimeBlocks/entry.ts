import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Calculates available time blocks for a character based on existing schedules.
 * 
 * Returns available hours for each day of the week, considering:
 * - Existing work schedules
 * - Existing school enrollments
 * - Religious memberships
 * - All other location-based commitments
 * 
 * Useful for: "What times is this character free on Monday?"
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { character_id } = await req.json();
    if (!character_id) {
      return Response.json({ error: 'character_id required' }, { status: 400 });
    }

    const character = await base44.entities.Character.filter({ id: character_id }).then(r => r[0]);
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Get all schedules for this character
    const scheduleCheck = await base44.functions.invoke('detectScheduleConflicts', {
      character_id,
    }).then(r => r.all_schedules || []);

    // Initialize availability: all days 0:00-24:00 are available
    const dayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const availability = {};
    for (let i = 0; i < 7; i++) {
      availability[i] = [{ start: 0, end: 1440, label: 'Available' }]; // 24 hours in minutes
    }

    // Block out busy times
    scheduleCheck.forEach(sched => {
      if (!sched.schedule) return;

      const days = sched.schedule.days || [0, 1, 2, 3, 4, 5, 6];
      const startMin = timeToMinutes(sched.schedule.start_time);
      const endMin = timeToMinutes(sched.schedule.end_time);

      if (startMin === null || endMin === null) return;

      days.forEach(dayIdx => {
        availability[dayIdx] = subtractTimeBlock(availability[dayIdx], startMin, endMin, sched.label);
      });
    });

    // Format output
    const result = {};
    for (let i = 0; i < 7; i++) {
      result[dayLabels[i]] = {
        day_number: i,
        blocks: availability[i].map(block => ({
          start: minutesToTime(block.start),
          end: minutesToTime(block.end),
          duration_hours: ((block.end - block.start) / 60).toFixed(1),
          is_free: block.label === 'Available',
          blocked_by: block.label !== 'Available' ? block.label : null,
        })),
        is_completely_free: availability[i].length === 1 && availability[i][0].label === 'Available',
      };
    }

    return Response.json({
      character_id,
      availability: result,
      summary: Object.entries(result).map(([day, info]) => ({
        day,
        completely_free: info.is_completely_free,
        free_blocks: info.blocks.filter(b => b.is_free).length,
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Helper: Subtract a busy time block from available blocks
 */
function subtractTimeBlock(blocks, busyStart, busyEnd, label) {
  const result = [];

  blocks.forEach(block => {
    // No overlap
    if (busyEnd <= block.start || busyStart >= block.end) {
      result.push(block);
      return;
    }

    // Partial or complete overlap
    if (busyStart > block.start) {
      result.push({ start: block.start, end: busyStart, label: 'Available' });
    }

    result.push({ start: busyStart, end: Math.min(busyEnd, block.end), label });

    if (busyEnd < block.end) {
      result.push({ start: busyEnd, end: block.end, label: 'Available' });
    }
  });

  return result;
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