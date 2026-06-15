import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { character, context } = await req.json();

    if (!character || !character.presence_stay_lock) {
      return Response.json({ shouldRespectLock: false, shouldReleaseLock: false, reason: 'no_lock_active' });
    }

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    // 1. Check for expiration
    if (character.presence_stay_lock_expires_at) {
      if (nowET > new Date(character.presence_stay_lock_expires_at)) {
        return Response.json({
          shouldRespectLock: false,
          shouldReleaseLock: true,
          releaseReason: 'expired',
          authority: character.presence_stay_lock_authority,
          proof: `Lock expired at ${character.presence_stay_lock_expires_at}`
        });
      }
    }

    // 2. Check for higher-priority overrides (emergencies)
    const energyUrgency = urgencyLevel(character.energy_value ?? 75);
    const healthUrgency = urgencyLevel(character.health_value ?? 80);
    if (energyUrgency >= 4 || healthUrgency >= 3) {
        return Response.json({
            shouldRespectLock: false,
            shouldReleaseLock: true,
            releaseReason: 'emergency_need_override',
            authority: 'needs_system',
            proof: `Energy: ${character.energy_value}, Health: ${character.health_value}`
        });
    }

    // 3. Check against obligation completion
    const lockReason = character.presence_stay_lock_reason;
    let obligationCompleted = false;
    let obligationProof = '';

    if (lockReason === 'sleep_state') {
        const sleepStartedAt = character.last_sleep_start ? new Date(character.last_sleep_start) : null;
        const sleepDurationHours = sleepStartedAt ? (nowET.getTime() - sleepStartedAt.getTime()) / 3600000 : 0;
        const energyNow = character.energy_value ?? 0;
        const hasWokenUp = energyNow >= 70 && sleepDurationHours >= 4;

        if(hasWokenUp) {
            obligationCompleted = true;
            obligationProof = `Woke up naturally. Energy: ${energyNow}, Slept: ${sleepDurationHours.toFixed(1)}hrs`;
        }
    }

    if (lockReason === 'work_shift') {
        const onShift = (() => {
            if (!character.work_days || !character.work_start_time || !character.work_end_time) return false;
            const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
            const dowNow = nowET.getDay();
            if (!character.work_days.includes(dowNow)) return false;
            const start = toMin(character.work_start_time);
            const end = toMin(character.work_end_time);
            if (start === null || end === null) return false;
            return end < start ? (nowMin >= start || nowMin < end) : (nowMin >= start && nowMin < end);
        })();
        if(!onShift){
            obligationCompleted = true;
            obligationProof = 'Work shift has ended.';
        }
    }
    
    if (lockReason === 'school_schedule') {
      const isSchoolHours = nowET.getHours() >= 8 && nowET.getHours() < 15 && nowET.getDay() >= 1 && nowET.getDay() <= 5;
      if(!isSchoolHours){
          obligationCompleted = true;
          obligationProof = 'School hours have ended.';
      }
    }

    if (obligationCompleted) {
        return Response.json({
            shouldRespectLock: false,
            shouldReleaseLock: true,
            releaseReason: `obligation_completed: ${lockReason}`,
            authority: character.presence_stay_lock_authority,
            proof: obligationProof
        });
    }

    // 4. If no release condition is met, respect the lock
    return Response.json({
      shouldRespectLock: true,
      shouldReleaseLock: false,
      reason: 'valid_active_lock',
      authority: character.presence_stay_lock_authority,
      proof: `Lock reason '${lockReason}' is still active.`
    });

  } catch (error) {
    return Response.json({ error: error.message, status: 'ERROR_CANNOT_VALIDATE' }, { status: 500 });
  }
});

function urgencyLevel(value) {
    if (value < 10) return 4;
    if (value < 25) return 3;
    if (value < 50) return 2;
    if (value < 70) return 1;
    return 0;
}