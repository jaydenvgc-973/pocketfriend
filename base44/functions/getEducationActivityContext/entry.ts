/**
 * EDUCATION ACTIVITY CONTEXT ENGINE
 *
 * Given a character + current time, determines:
 *   - What their current education-related activity should be
 *   - Whether they are in a scheduled study block (high priority)
 *   - Whether they can do on-demand coursework (flexible)
 *   - What to tell the chat/narrative system about their current focus
 *
 * ACTIVITY vs LOCATION:
 *   Location = where they physically are (unaffected unless course is in_person)
 *   Activity = what they are doing RIGHT NOW
 *
 * Returns a context object for use in chat response generation and narrative.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Days: 0=Sun, 1=Mon, ..., 6=Sat
function getCurrentDayAndTime(tzOffsetHours = -5) {
  const now = new Date();
  // Apply timezone offset
  const local = new Date(now.getTime() + tzOffsetHours * 3600000);
  const day = local.getUTCDay();
  const hours = local.getUTCHours();
  const minutes = local.getUTCMinutes();
  const timeStr = `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
  return { day, timeStr, hours, minutes };
}

function isTimeInRange(currentTime, startTime, endTime) {
  if (!startTime || !endTime) return false;
  return currentTime >= startTime && currentTime <= endTime;
}

function getStudyActivityLabel(item) {
  if (item.enrollment_type === 'certification') {
    const labels = ['working on certification modules', 'completing certification coursework', 'studying for certification exam', 'reviewing certification material'];
    return labels[Math.floor(Math.random() * labels.length)];
  }
  if (item.enrollment_type === 'full_school') {
    const labels = ['in class', 'doing coursework', 'working on assignments', 'studying for exams', 'completing projects'];
    return labels[Math.floor(Math.random() * labels.length)];
  }
  const labels = ['working on online course', 'completing course modules', 'watching course lessons', 'doing course exercises', 'reviewing course material'];
  return labels[Math.floor(Math.random() * labels.length)];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { character_id, tz_offset_hours = -5 } = await req.json();
    if (!character_id) return Response.json({ error: 'character_id required' }, { status: 400 });

    const chars = await base44.entities.Character.filter({ id: character_id });
    if (!chars[0]) return Response.json({ error: 'Character not found' }, { status: 404 });
    const character = chars[0];

    const { day, timeStr, hours } = getCurrentDayAndTime(tz_offset_hours);
    const now = new Date();

    // Get all currently-enrolled education items using status-first logic
    const activeItems = (character.completed_education || []).filter(item => {
      // Manually resolved statuses that are NOT active
      if (['completed', 'dropped', 'paused'].includes(item.status)) return false;
      // Manually enrolled
      if (item.status === 'enrolled') return true;
      // Planned = not started yet
      if (item.status === 'planned') return false;
      // Legacy 'active' or unset: use date inference
      const start = item.start_date ? new Date(item.start_date) : null;
      const end = item.completion_date ? new Date(item.completion_date) : null;
      if (start && start > now) return false; // not started
      if (end && end < now) return false;     // already ended
      return true;
    });

    if (!activeItems.length) {
      return Response.json({
        has_education: false,
        is_in_study_block: false,
        has_flexible_coursework: false,
        activity_label: null,
        courses: [],
        context_for_chat: 'No active education or coursework.',
      });
    }

    // ── SCHEDULED BLOCK CHECK ──────────────────────────────────────
    // Find any item that is remote_scheduled or in_person AND has a schedule
    // that covers the current day + time
    let scheduledActiveItem = null;

    for (const item of activeItems) {
      if (item.mode === 'on_demand') continue;
      if (!item.schedule) continue;

      const { days, start_time, end_time } = item.schedule;
      if (!days || !start_time || !end_time) continue;

      if (days.includes(day) && isTimeInRange(timeStr, start_time, end_time)) {
        scheduledActiveItem = item;
        break;
      }
    }

    // ── ON-DEMAND ITEMS ────────────────────────────────────────────
    const onDemandItems = activeItems.filter(i => i.mode === 'on_demand');
    const hasFlexibleCoursework = onDemandItems.length > 0;

    // ── PERSONALITY / INTUITION MODIFIERS ─────────────────────────
    const isDriven = (character.personality_traits || []).some(t =>
      ['driven', 'ambitious', 'hardworking', 'focused', 'disciplined'].includes(t.toLowerCase())
    );
    const isDistracted = (character.personality_traits || []).some(t =>
      ['easily distracted', 'lazy', 'laid-back', 'impulsive'].includes(t.toLowerCase())
    );
    const isBurnedOut = character.emotional_state === 'burnt out' || character.emotional_state === 'overwhelmed';
    const isLowOnMoney = character.financial_need_value < 30;

    // Intuition: on-demand likelihood based on personality + state
    let onDemandLikelihood = 0.4; // base 40% chance during free time
    if (isDriven) onDemandLikelihood += 0.25;
    if (isDistracted) onDemandLikelihood -= 0.2;
    if (isBurnedOut) onDemandLikelihood -= 0.3;
    if (isLowOnMoney) onDemandLikelihood -= 0.1; // stressed about money, less focus
    // Evening (6pm-10pm) is prime study time
    if (hours >= 18 && hours <= 22) onDemandLikelihood += 0.15;
    // Late night / early morning = low study
    if (hours < 7 || hours >= 23) onDemandLikelihood -= 0.4;
    onDemandLikelihood = Math.max(0, Math.min(1, onDemandLikelihood));

    const isActivelyStudyingOnDemand = hasFlexibleCoursework && Math.random() < onDemandLikelihood;

    // ── BUILD RESPONSE ─────────────────────────────────────────────
    const isInStudyBlock = !!scheduledActiveItem;
    const primaryItem = scheduledActiveItem || (isActivelyStudyingOnDemand ? onDemandItems[0] : null);

    let activityLabel = null;
    let contextForChat = '';
    let requiresLocation = false;
    let locationId = null;

    if (isInStudyBlock && scheduledActiveItem) {
      activityLabel = getStudyActivityLabel(scheduledActiveItem);
      requiresLocation = scheduledActiveItem.mode === 'in_person';
      locationId = requiresLocation ? scheduledActiveItem.location_id : null;
      contextForChat = `${character.name} is currently in a scheduled ${scheduledActiveItem.mode === 'remote_scheduled' ? 'remote' : 'in-person'} class block for "${scheduledActiveItem.course_name}". They are busy with ${activityLabel}. Their availability is limited. They should be school-focused and may mention studying, assignments, or course material.`;
    } else if (isActivelyStudyingOnDemand && onDemandItems[0]) {
      const item = onDemandItems[0];
      activityLabel = getStudyActivityLabel(item);
      contextForChat = `${character.name} is currently doing some flexible coursework (${item.course_name}) on their own time. This is casual/background-compatible — they are not fully unavailable, but may mention they are working through some lessons or modules. Location does not matter for this.`;
    } else if (hasFlexibleCoursework) {
      contextForChat = `${character.name} has active on-demand coursework (${onDemandItems.map(i => i.course_name).join(', ')}) they could mention if it comes up naturally. They are NOT currently studying — it's just part of their life context.`;
    }

    // Summary of all active items for the chat system
    const courseSummary = activeItems.map(item => ({
      course_name: item.course_name,
      enrollment_type: item.enrollment_type || 'course',
      mode: item.mode || 'on_demand',
      status: item.status,
      progress: item.progress || 0,
      has_schedule: !!(item.schedule?.days?.length),
      schedule: item.schedule || null,
      is_in_person: item.mode === 'in_person',
      required_location_id: item.mode === 'in_person' ? item.location_id : null,
    }));

    return Response.json({
      has_education: true,
      is_in_study_block: isInStudyBlock,
      scheduled_item: scheduledActiveItem ? {
        course_name: scheduledActiveItem.course_name,
        mode: scheduledActiveItem.mode,
        enrollment_type: scheduledActiveItem.enrollment_type,
      } : null,
      has_flexible_coursework: hasFlexibleCoursework,
      is_actively_studying_on_demand: isActivelyStudyingOnDemand,
      activity_label: activityLabel,
      requires_location_travel: requiresLocation,
      required_location_id: locationId,
      context_for_chat: contextForChat,
      intuition: {
        is_driven: isDriven,
        is_distracted: isDistracted,
        is_burned_out: isBurnedOut,
        is_low_on_money: isLowOnMoney,
        on_demand_likelihood: Math.round(onDemandLikelihood * 100),
      },
      courses: courseSummary,
      current_day: day,
      current_time: timeStr,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});