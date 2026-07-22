/**
 * validatePresenceStayLock — SHARED LOCAL VALIDATOR (NOT a backend function)
 *
 * Imported directly by autonomousCharacterMovement and any other system
 * that needs to evaluate whether a presence_stay_lock is still valid.
 *
 * Returns: {
 *   shouldRespectLock: boolean,
 *   shouldReleaseLock: boolean,
 *   releaseReason: string,
 *   authority: string | null,
 *   lockReason: string | null,
 *   proof: string
 * }
 */

/**
 * LOCK RELEASE HELPER — shared release payload builder.
 * Returns the update payload to clear all lock fields.
 */
export function buildLockReleasePayload() {
  return {
    presence_stay_lock: false,
    presence_stay_lock_location_id: null,
    presence_stay_lock_set_at: null,
    presence_stay_lock_reason: null,
    presence_stay_lock_authority: null,
    presence_stay_lock_expires_at: null,
    presence_stay_lock_release_condition: null,
    presence_stay_lock_created_by: null,
  };
}

/**
 * Determine if a lock is a legacy lock (missing metadata fields).
 */
function isLegacyLock(character) {
  return (
    character.presence_stay_lock === true &&
    !character.presence_stay_lock_reason &&
    !character.presence_stay_lock_authority &&
    !character.presence_stay_lock_expires_at &&
    !character.presence_stay_lock_release_condition
  );
}

/**
 * Validate a presence_stay_lock on a character.
 */
export default function validatePresenceStayLock(character, context) {
  const ctx = context || {};
  const nowET = ctx.nowET || new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
  );

  if (!character || character.presence_stay_lock !== true) {
    return {
      shouldRespectLock: false,
      shouldReleaseLock: false,
      reason: 'no_lock_active',
      authority: null,
      lockReason: null,
      proof: 'Lock not active',
    };
  }

  const lockReason = character.presence_stay_lock_reason || null;
  const lockAuthority = character.presence_stay_lock_authority || null;
  const lockExpiresAt = character.presence_stay_lock_expires_at || null;

  // ── LEGACY LOCK HANDLING ───────────────────────────────────────────────
  if (isLegacyLock(character)) {
    const lockSetAt = character.presence_stay_lock_set_at
      ? new Date(character.presence_stay_lock_set_at).getTime()
      : null;
    const lockLocationId = character.presence_stay_lock_location_id || null;
    const currentLocationId = character.resolved_current_location_id || null;

    if (!lockSetAt) {
      return {
        shouldRespectLock: false,
        shouldReleaseLock: true,
        releaseReason: 'orphaned_legacy_lock_no_timestamp',
        authority: lockAuthority,
        lockReason: lockReason,
        proof: 'Legacy lock missing presence_stay_lock_set_at',
      };
    }

    if (lockLocationId && currentLocationId && lockLocationId !== currentLocationId) {
      return {
        shouldRespectLock: false,
        shouldReleaseLock: true,
        releaseReason: 'legacy_lock_location_mismatch',
        authority: lockAuthority,
        lockReason: lockReason,
        proof: `Locked at ${lockLocationId}, now at ${currentLocationId}`,
      };
    }

    const STALE_MS = 12 * 60 * 60 * 1000;
    if (nowET.getTime() - lockSetAt > STALE_MS) {
      return {
        shouldRespectLock: false,
        shouldReleaseLock: true,
        releaseReason: 'stale_legacy_lock',
        authority: lockAuthority,
        lockReason: lockReason,
        proof: `Legacy lock older than 12-hour grace period`,
      };
    }

    // Respect legacy lock temporarily — fall through to emergency check below
  }

  // ── EXPIRATION CHECK ────────────────────────────────────────────────────
  if (lockExpiresAt) {
    const expiresAt = new Date(lockExpiresAt);
    if (nowET > expiresAt) {
      return {
        shouldRespectLock: false,
        shouldReleaseLock: true,
        releaseReason: 'expired',
        authority: lockAuthority,
        lockReason: lockReason,
        proof: `Lock expired at ${lockExpiresAt}`,
      };
    }
  }

  // ── EMERGENCY NEEDS OVERRIDE — PRESERVE SLEEP LOCK ─────────────────────
  // When the lock reason is 'sleep_state' or 'nap_state', the character is in
  // the authoritative recovery state that directly addresses low energy/health.
  // Releasing the lock cancels the recovery and leaves the character awake while
  // needs continue deteriorating (the failed Andre pathway). Sleep IS the
  // treatment for low energy/health; it must not be canceled because the
  // condition it is treating has become severe. Only a valid wake condition or a
  // fully committed higher-priority transition (e.g. hospitalization) may
  // release the lock. Low mental health or any other critical need likewise
  // must not release a legitimate sleep lock — sleep deprivation is the active
  // root cause and sleep is the recovery response.
  const energyVal = character.energy_value ?? 75;
  const healthVal = character.health_value ?? 80;
  const mentalVal = character.mental_value ?? 70;
  if (energyVal < 10 || healthVal < 25 || mentalVal < 25) {
    if (lockReason === 'sleep_state' || lockReason === 'nap_state') {
      return {
        shouldRespectLock: true,
        shouldReleaseLock: false,
        reason: 'valid_active_lock',
        authority: lockAuthority,
        lockReason: lockReason,
        proof: `Sleep/nap lock preserved — low energy/health/mental is the active root cause and sleep is the recovery response (Energy: ${energyVal}, Health: ${healthVal}, Mental: ${mentalVal})`,
      };
    }
    return {
      shouldRespectLock: false,
      shouldReleaseLock: true,
      releaseReason: 'emergency_need_override',
      authority: 'needs_system',
      lockReason: lockReason,
      proof: `Energy: ${energyVal}, Health: ${healthVal}, Mental: ${mentalVal}`,
    };
  }

  // ── OBSERVE AUTHORITATIVE STATE ─────────────────────────────────────────
  // Do NOT duplicate sleep/work/school logic.
  // Observe what authoritative systems have already written to the character.
  const status = character.resolved_presence_status || '';
  const sourceReason = character.resolved_source_reason || '';

  if (lockReason === 'sleep_state') {
    const isStillSleeping = status === 'sleeping' || status === 'napping';
    if (!isStillSleeping) {
      return {
        shouldRespectLock: false,
        shouldReleaseLock: true,
        releaseReason: 'sleep_obligation_completed',
        authority: lockAuthority,
        lockReason: lockReason,
        proof: `No longer sleeping (status=${status})`,
      };
    }
  }

  if (lockReason === 'nap_state') {
    if (status !== 'napping') {
      return {
        shouldRespectLock: false,
        shouldReleaseLock: true,
        releaseReason: 'nap_obligation_completed',
        authority: lockAuthority,
        lockReason: lockReason,
        proof: `No longer napping (status=${status})`,
      };
    }
  }

  if (lockReason === 'pass_out_recovery') {
    if (status !== 'passed_out') {
      return {
        shouldRespectLock: false,
        shouldReleaseLock: true,
        releaseReason: 'pass_out_recovery_completed',
        authority: lockAuthority,
        lockReason: lockReason,
        proof: `No longer passed out (status=${status})`,
      };
    }
  }

  if (lockReason === 'work_shift') {
    const isStillAtWork = status === 'at_work' || sourceReason === 'work_schedule';
    if (!isStillAtWork) {
      return {
        shouldRespectLock: false,
        shouldReleaseLock: true,
        releaseReason: 'work_shift_completed',
        authority: lockAuthority,
        lockReason: lockReason,
        proof: `No longer at work (status=${status})`,
      };
    }
  }

  if (lockReason === 'school_schedule') {
    const isStillAtSchool = status === 'at_school' || sourceReason === 'school_schedule';
    if (!isStillAtSchool) {
      return {
        shouldRespectLock: false,
        shouldReleaseLock: true,
        releaseReason: 'school_schedule_completed',
        authority: lockAuthority,
        lockReason: lockReason,
        proof: `No longer at school (status=${status})`,
      };
    }
  }

  // ── RELEASE CONDITION CHECK ─────────────────────────────────────────────
  const releaseCondition = character.presence_stay_lock_release_condition || null;
  if (releaseCondition === 'scene_end' && lockReason === 'user_scene_stay') {
    if (character.resolved_current_location_id !== character.presence_stay_lock_location_id) {
      return {
        shouldRespectLock: false,
        shouldReleaseLock: true,
        releaseReason: 'scene_ended_user_left',
        authority: lockAuthority,
        lockReason: lockReason,
        proof: 'User left scene location — STAY no longer applies',
      };
    }
  }

  // ── VALID — RESPECT THE LOCK ────────────────────────────────────────────
  const isLegacy = isLegacyLock(character);
  return {
    shouldRespectLock: true,
    shouldReleaseLock: false,
    reason: isLegacy ? 'valid_legacy_lock' : 'valid_active_lock',
    authority: lockAuthority,
    lockReason: lockReason,
    proof: isLegacy
      ? 'Legacy lock respected — location matches, not stale, no emergency'
      : `Lock reason '${lockReason}' still active (authority: ${lockAuthority})`,
  };
}