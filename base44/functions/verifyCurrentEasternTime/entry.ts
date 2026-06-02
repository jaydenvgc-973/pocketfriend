/**
 * verifyCurrentEasternTime
 * 
 * Returns verified current Eastern time alongside UTC.
 * Used to confirm the system is computing ET correctly before any shift/presence logic.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  await base44.auth.me().catch(() => null);

  const utcNow = new Date();

  // Correct method: toLocaleString with America/New_York timezone
  const etString = utcNow.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const etDate = new Date(etString);

  const etHour = etDate.getHours();
  const etMinute = etDate.getMinutes();
  const etDayOfWeek = etDate.getDay(); // 0=Sun, 6=Sat
  const etTotalMinutes = etHour * 60 + etMinute;

  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  // Ethan's schedule: work_start_time="17:00", work_end_time="01:00", work_days=[0,1,2,5,6]
  const workStart = '17:00';
  const workEnd = '01:00';
  const workDays = [0, 1, 2, 5, 6]; // Sun, Mon, Tue, Fri, Sat

  const [sh, sm] = workStart.split(':').map(Number);
  const [eh, em] = workEnd.split(':').map(Number);
  const startMins = sh * 60 + sm; // 1020
  let endMins = eh * 60 + em;     // 60

  // Cross-midnight shift: endMins < startMins means shift crosses midnight
  // For a 17:00 → 01:00 shift: character is on shift if time >= 17:00 OR time < 01:00
  const isCrossMidnight = endMins < startMins;

  let isOnShift = false;
  if (workDays.includes(etDayOfWeek)) {
    if (isCrossMidnight) {
      // On shift if: time >= startMins (after 17:00 today) OR time < endMins (before 01:00 today)
      isOnShift = etTotalMinutes >= startMins || etTotalMinutes < endMins;
    } else {
      isOnShift = etTotalMinutes >= startMins && etTotalMinutes < endMins;
    }
  } else if (isCrossMidnight) {
    // Could still be on shift from YESTERDAY's shift (after midnight, before 01:00)
    // Yesterday = day before etDayOfWeek
    const yesterday = (etDayOfWeek + 6) % 7;
    if (workDays.includes(yesterday) && etTotalMinutes < endMins) {
      isOnShift = true;
    }
  }

  return Response.json({
    utc: {
      iso: utcNow.toISOString(),
      hour: utcNow.getUTCHours(),
      minute: utcNow.getUTCMinutes(),
      day_of_week: utcNow.getUTCDay(),
      display: `${utcNow.getUTCHours().toString().padStart(2,'0')}:${utcNow.getUTCMinutes().toString().padStart(2,'0')} UTC`,
    },
    eastern: {
      display: etString,
      hour: etHour,
      minute: etMinute,
      day_of_week: etDayOfWeek,
      day_name: dayNames[etDayOfWeek],
      time_display: `${etHour.toString().padStart(2,'0')}:${etMinute.toString().padStart(2,'0')} ET`,
      total_minutes: etTotalMinutes,
    },
    offset_hours: (utcNow.getUTCHours() - etHour + 24) % 24,
    ethan_shift: {
      work_start: workStart,
      work_end: workEnd,
      work_days: workDays.map(d => dayNames[d]),
      is_work_day_et: workDays.includes(etDayOfWeek),
      is_cross_midnight_shift: isCrossMidnight,
      is_on_shift_et: isOnShift,
      verdict: isOnShift
        ? `✅ ON SHIFT — location authority = Anderson's Bar`
        : `❌ OFF SHIFT — location authority = Home`,
    },
  });
});