import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * detectSleepCommitmentFromMessage
 *
 * EVENT-DRIVEN sleep writer. Fires once per qualifying chat turn when the
 * CHARACTER'S OWN REPLY contains a clear present-intent sleep/nap commitment.
 * Routes the canonical transition through enforceCharacterLocationPresence
 * (the sole canonical writer) — this function never writes canonical fields
 * directly.
 *
 * TRIGGER AUTHORITY = the character's own acknowledged commitment, NOT the
 * user's command. The user's message is never read here.
 *
 * Rules (per approved spec):
 *   - Immediate commitment phrases ("I'm going to bed", "good night",
 *     "I'm falling asleep", "I'm hitting the hay", "half gone") → sleep now.
 *   - Active getting-into-bed phrases ("getting into bed", "under the covers",
 *     "settling into bed") → sleep now.
 *   - Already-asleep phrases ("falls asleep", "fast asleep", "zzz") → sleep now
 *     (reinforces existing sleep if already sleeping — authority no-ops).
 *   - Nap phrases ("taking a nap", "rest for a bit", "power nap") → nap now.
 *   - Fatigue-only / plan-only / prep-only phrases ("I'm tired", "I should
 *     get some sleep", "getting ready for bed", "I'm in bed") do NOT trigger.
 *
 * PRECONDITIONS (checked server-side, authoritative):
 *   - Character is an active_created_character (not NPC / world-service / test).
 *   - Not incarcerated / house-arrest / hospitalized / passed_out.
 *   - Already at a valid sleep location (home). A character who says "I'm
 *     going to sleep" while at work/school/visiting is NOT transitioned — they
 *     are not in a position to sleep. The authority would reject anyway; this
 *     skips early and matches intent.
 *   - Not already sleeping/napping (if so, authority returns no_change —
 *     we skip the call to avoid wasted work).
 *   - No active work shift or school window at this moment.
 *
 * This is NOT polling. It runs on the chat-turn event, once per qualifying
 * turn, gated by a 3-minute per-character cooldown in the frontend governor.
 */

// ── COMMITMENT PHRASE PATTERNS ───────────────────────────────────────────────
// Order matters: NAP is checked first (so "nap" phrases never become sleep),
// then SLEEP (immediate), then GETTING_INTO_BED, then CONFIRMING_NOW, then
// ALREADY_ASLEEP. NOT_TRIGGER phrases are NOT matched here — they simply fall
// through to "no commitment detected" by not matching any pattern.

const NAP_PATTERNS = [
  /\bi'?m\s+taking\s+a\s+nap\b/i,
  /\bi'?m\s+going\s+to\s+take\s+a\s+nap\b/i,
  /\bi'?m\s+going\s+to\s+lie\s+down\s+for\s+a\s+nap\b/i,
  /\bi'?m\s+going\s+to\s+rest\s+for\s+a\s+bit\b/i,
  /\bi'?m\s+taking\s+a\s+quick\s+nap\b/i,
  /\bi'?m\s+taking\s+a\s+power\s+nap\b/i,
  /\bi'?m\s+going\s+to\s+sleep\s+for\s+an\s+hour\b/i,
  /\bwake\s+me\s+up\s+in\s+a\s+little\s+while\b/i,
  /\bgoing\s+to\s+take\s+a\s+nap\b/i,
  /\btaking\s+a\s+nap\b/i,
  /\blie\s+down\s+for\s+a\s+nap\b/i,
  /\brest\s+for\s+a\s+bit\b/i,
];

const SLEEP_START_PATTERNS = [
  /\bi'?m\s+going\s+to\s+sleep\b/i,
  /\bi'?m\s+going\s+to\s+bed\b/i,
  /\bi'?m\s+heading\s+to\s+bed\b/i,
  /\bi'?m\s+heading\s+to\s+sleep\b/i,
  /\bi'?m\s+off\s+to\s+bed\b/i,
  /\bi'?m\s+off\s+to\s+sleep\b/i,
  /\bi'?m\s+calling\s+it\s+a\s+night\b/i,
  /\bi'?m\s+turning\s+in\b/i,
  /\bi'?m\s+going\s+to\s+get\s+some\s+sleep\b/i,
  /\bi'?m\s+going\s+to\s+lie\s+down\s+and\s+sleep\b/i,
  /\bi'?m\s+going\s+to\s+get\s+some\s+rest\b/i,
  /\bi'?m\s+going\s+to\s+crash\b/i,
  /\bi'?m\s+hitting\s+the\s+hay\b/i,
  /\bi'?m\s+hitting\s+the\s+sack\b/i,
  /\bi'?m\s+going\s+to\s+catch\s+some\s+sleep\b/i,
  /\btime\s+for\s+bed\b/i,
  /\bbedtime\b/i,
  /\bgood\s*night\b/i,
  /\bnight\s*night\b/i,
  /\bnite\b/i,
  // Bare "night" as a short sign-off only — never inside compounds like
  // "tonight", "last night", "midnight", "night shift".
  // Matched only when the whole trimmed message is basically "night".
];

const GETTING_INTO_BED_PATTERNS = [
  /\bi'?m\s+getting\s+into\s+bed\b/i,
  /\bi'?m\s+climbing\s+into\s+bed\b/i,
  /\bi'?m\s+tucked\s+into\s+bed\b/i,
  /\bi'?m\s+tucked\s+in\b/i,
  /\bi'?m\s+under\s+the\s+covers\b/i,
  /\bi'?m\s+laying\s+down\s+for\s+the\s+night\b/i,
  /\bi'?m\s+lying\s+down\s+for\s+the\s+night\b/i,
  /\bi'?m\s+settling\s+into\s+bed\b/i,
  /\bi'?m\s+curling\s+up\s+in\s+bed\b/i,
  /\bi'?m\s+putting\s+(my|her|his)\s+phone\s+down\s+for\s+the\s+night\b/i,
  // Conversational variants observed in real dialogue:
  /\bi'?m\s+hitting\s+(this\s+|the\s+)?(mattress|bed|pillow|sheets|hay|sack)\b/i,
  /\b(half\s+gone|out\s+like\s+a\s+light)\b/i,
];

const CONFIRMING_SLEEP_NOW_PATTERNS = [
  /\bi'?ll\s+talk\s+to\s+you\s+tomorrow\b/i,
  /\bi'?ll\s+text\s+you\s+in\s+the\s+morning\b/i,
  /\bsee\s+you\s+in\s+the\s+morning\b/i,
  /\btalk\s+tomorrow\b/i,
  /\bgood\s*night,?\s+i'?m\s+going\s+to\s+sleep\b/i,
  /\bi'?m\s+falling\s+asleep\b/i,
  /\bi'?m\s+about\s+to\s+fall\s+asleep\b/i,
  /\bi'?m\s+closing\s+(my|her|his)\s+eyes\b/i,
  /\bi'?m\s+dozing\s+off\b/i,
  /\bi'?m\s+drifting\s+off\b/i,
  /\bi'?m\s+nodding\s+off\b/i,
];

const ALREADY_ASLEEP_PATTERNS = [
  /\bzzz/i,
  /\bfalls?\s+asleep\b/i,
  /\bsleeping\b/i,
  /\bfast\s+asleep\b/i,
  /\bsound\s+asleep\b/i,
  /\balready\s+asleep\b/i,
  /\bsnoring\b/i,
  /\bstill\s+asleep\b/i,
];

// Phrases that must NOT trigger sleep on their own. If a commitment phrase is
// ALSO present (e.g., "I'm exhausted and I'm going to bed"), the commitment
// pattern wins because we check commitment patterns first. This list is only
// used to reject messages that match NOTHING in the commitment categories —
// it is a safety net, not the primary gate (the primary gate is "no commitment
// pattern matched").
const FATIGUE_ONLY_PATTERNS = [
  /\bi'?m\s+tired\b/i,
  /\bi'?m\s+exhausted\b/i,
  /\bi'?m\s+sleepy\b/i,
  /\bi'?m\s+worn\s+out\b/i,
  /\bi\s+could\s+use\s+some\s+sleep\b/i,
  /\bi\s+need\s+some\s+rest\b/i,
  /\bi\s+should\s+probably\s+go\s+to\s+bed\b/i,
  /\bi\s+should\s+get\s+some\s+sleep\b/i,
  /\bmaybe\s+i'?ll\s+go\s+to\s+bed\s+soon\b/i,
  /\bi'?m\s+relaxing\b/i,
  /\bi'?m\s+lying\s+on\s+the\s+couch\b/i,
  /\bi'?m\s+watching\s+tv\s+in\s+bed\b/i,
  /\bi'?m\s+in\s+bed\b/i,
  /\bi'?m\s+in\s+(my|her|his)\s+bedroom\b/i,
  /\bi'?m\s+resting\b/i,
  /\bi'?m\s+taking\s+it\s+easy\b/i,
  /\bi'?m\s+closing\s+(my|her|his)\s+laptop\b/i,
  /\bi'?m\s+getting\s+ready\s+for\s+bed\b/i,
  /\bi\s+brushed\s+(my|her|his)\s+teeth\b/i,
  /\bi\s+changed\s+into\s+pajamas\b/i,
];

function classifyCommitment(text) {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;

  // Bare "night" as a short sign-off — only when the whole message is
  // essentially just "night" (optionally with punctuation). This prevents
  // matching "last night", "tonight", "midnight", etc.
  const isBareNightSignoff = /^(just\s+saying\s+)?night[!.]?\s*$/i.test(t);

  // NAP takes priority over sleep — a nap phrase must never become overnight sleep.
  for (const p of NAP_PATTERNS) if (p.test(t)) return { type: 'nap', phrase: 'nap_pattern' };

  for (const p of SLEEP_START_PATTERNS) if (p.test(t)) return { type: 'sleep', phrase: 'sleep_start' };
  if (isBareNightSignoff) return { type: 'sleep', phrase: 'bare_night_signoff' };

  for (const p of GETTING_INTO_BED_PATTERNS) if (p.test(t)) return { type: 'sleep', phrase: 'getting_into_bed' };

  for (const p of CONFIRMING_SLEEP_NOW_PATTERNS) if (p.test(t)) return { type: 'sleep', phrase: 'confirming_now' };

  for (const p of ALREADY_ASLEEP_PATTERNS) if (p.test(t)) return { type: 'sleep', phrase: 'already_asleep' };

  // No commitment matched. Explicitly confirm it was fatigue/prep-only so the
  // caller can log the distinction; otherwise it's just neutral dialogue.
  for (const p of FATIGUE_ONLY_PATTERNS) if (p.test(t)) return { type: 'none', phrase: 'fatigue_or_prep_only' };

  return { type: 'none', phrase: 'no_commitment' };
}

// ── VALID SLEEP LOCATION CHECK (aligned with enforceCharacterLocationPresence) ──
const VALID_SLEEP_CATEGORIES = new Set([
  'home', 'hotel', 'shelter', 'generic',
  'jail', 'prison', 'detention_center', 'correctional_facility',
  'juvenile_detention', 'halfway_house', 'holding_cell',
]);

function isAtValidSleepLocation(character, locationMap) {
  // Incarceration / house arrest are handled by the authority as hard locks;
  // we never trigger chat-sleep for those.
  if (character.is_jailed === true || character.house_arrest_active === true) return false;

  const currentLocId = character.resolved_current_location_id;
  const currentLoc = currentLocId ? locationMap[currentLocId] : null;
  const currentCat = currentLoc ? (currentLoc.category || '').toLowerCase() : '';

  // Explicit home match
  if (currentLocId && (
    currentLocId === character.current_home_location_id ||
    currentLocId === character.temporary_housing_location_id ||
    (character.resolved_location_type || '').toLowerCase() === 'home'
  )) return true;

  // Valid sleep-category location (hotel, shelter, etc.)
  if (currentLoc && VALID_SLEEP_CATEGORIES.has(currentCat)) return true;

  return false;
}

function isCharacterOnWorkScheduleNow(character, etTime) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) return false;
  const dayOfWeek = etTime.getDay();
  if (!character.work_days.includes(dayOfWeek)) return false;
  const now = etTime.getTime();
  const [wsh, wsm] = character.work_start_time.split(':').map(Number);
  const [weh, wem] = character.work_end_time.split(':').map(Number);
  const workStartMs = new Date(etTime).setHours(wsh, wsm, 0, 0);
  const workEndMs = new Date(etTime).setHours(weh, wem, 0, 0);
  return now >= workStartMs && now < workEndMs;
}

function isCharacterInSchoolWindowNow(character, etTime) {
  if (character.student_status !== 'enrolled' || !character.education_location_id) return false;
  const dayOfWeek = etTime.getDay();
  if (![1, 2, 3, 4, 5].includes(dayOfWeek)) return false;
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  let sStart = null, sEnd = null;
  if (Array.isArray(character.education_enrollments) && character.education_enrollments.length > 0) {
    const active = character.education_enrollments.find(e => e.status === 'active' && e.start_time && e.end_time);
    if (active) { sStart = toMin(active.start_time); sEnd = toMin(active.end_time); }
  }
  if (sStart === null || sEnd === null) return false;
  const nowMin = etTime.getHours() * 60 + etTime.getMinutes();
  return nowMin >= sStart && nowMin < sEnd;
}

// ── WORLD-SERVICE / TEST EXCLUSION ───────────────────────────────────────────
function isWorldServiceOrTest(c) {
  if (!c) return false;
  if (c.character_type === 'npc_world_service') return true;
  if (c.is_world_service === true) return true;
  if (c.diagnostic_only === true) return true;
  if (c.is_test_character === true) return true;
  const names = [c.name, c.display_name, c.primary_name].filter(Boolean).map(n => n.toLowerCase());
  return names.some(n => n.includes('vick servicio'));
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    let payload = {};
    try { payload = await req.json(); } catch (_) { /* no body */ }
    const { characterId, characterReply, conversationId, ownerEmail } = payload;

    if (!user && !ownerEmail) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const effectiveOwnerEmail = ownerEmail || user?.email;

    if (!characterId || !characterReply) {
      return Response.json({ error: 'characterId and characterReply required' }, { status: 400 });
    }

    // ── CLASSIFY THE CHARACTER'S OWN REPLY ────────────────────────────────
    const commitment = classifyCommitment(characterReply);
    if (!commitment || commitment.type === 'none') {
      return Response.json({
        detected: false,
        character_id: characterId,
        reason: commitment?.phrase || 'no_commitment',
      });
    }

    // ── LOAD CHARACTER ─────────────────────────────────────────────────────
    let characters = [];
    if (user) {
      characters = await base44.entities.Character.filter({ id: characterId, owner_email: effectiveOwnerEmail });
    }
    if (!characters || characters.length === 0) {
      characters = await base44.asServiceRole.entities.Character.filter({ id: characterId, owner_email: effectiveOwnerEmail });
    }
    if (!characters || characters.length === 0) {
      return Response.json({ error: 'Character not found or ownership mismatch', character_id: characterId }, { status: 404 });
    }
    const character = characters[0];

    // ── EXCLUSIONS ─────────────────────────────────────────────────────────
    if (isWorldServiceOrTest(character)) {
      return Response.json({ detected: true, committed: false, reason: 'world_service_or_test_excluded', character_id: characterId });
    }
    if (character.character_type && character.character_type !== 'active_created_character') {
      return Response.json({ detected: true, committed: false, reason: 'not_active_created_character', character_id: characterId });
    }

    const currentStatus = character.resolved_presence_status || '';
    const alreadyResting = ['sleeping', 'napping', 'passed_out', 'hospitalized'].includes(currentStatus);
    if (alreadyResting) {
      return Response.json({
        detected: true,
        committed: false,
        reason: 'already_in_rest_state',
        character_id: characterId,
        current_status: currentStatus,
      });
    }
    if (character.is_jailed === true || character.house_arrest_active === true) {
      return Response.json({ detected: true, committed: false, reason: 'confinement_block', character_id: characterId });
    }

    // ── LOAD LOCATIONS (for sleep-location validation) ─────────────────────
    let locations = [];
    try {
      locations = await base44.asServiceRole.entities.LocationReference.filter({ owner_email: effectiveOwnerEmail });
    } catch (_) { /* proceed with empty map */ }
    const locationMap = {};
    for (const loc of locations) locationMap[loc.id] = loc;

    // ── PRECONDITION: AT A VALID SLEEP LOCATION ────────────────────────────
    if (!isAtValidSleepLocation(character, locationMap)) {
      return Response.json({
        detected: true,
        committed: false,
        reason: 'not_at_valid_sleep_location',
        character_id: characterId,
        current_location_id: character.resolved_current_location_id || null,
      });
    }

    // ── PRECONDITION: NO ACTIVE OBLIGATION AT THIS MOMENT (Eastern Time) ───
    const etTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    if (isCharacterOnWorkScheduleNow(character, etTime)) {
      return Response.json({ detected: true, committed: false, reason: 'active_work_shift', character_id: characterId });
    }
    if (isCharacterInSchoolWindowNow(character, etTime)) {
      return Response.json({ detected: true, committed: false, reason: 'active_school_window', character_id: characterId });
    }

    // ── COMMIT THROUGH THE SOLE CANONICAL WRITER ───────────────────────────
    const requestedStatus = commitment.type === 'nap' ? 'napping' : 'sleeping';
    const requestedReason = commitment.type === 'nap'
      ? `character_nap_commitment:${commitment.phrase}`
      : `character_sleep_commitment:${commitment.phrase}`;

    let authResult = null;
    try {
      const invokeRes = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
        character_id: characterId,
        owner_email: effectiveOwnerEmail,
        requested_presence_status: requestedStatus,
        requested_source_reason: requestedReason,
        requested_authority: 'detectSleepCommitmentFromMessage',
        requested_timestamp: new Date().toISOString(),
      });
      authResult = invokeRes?.data || invokeRes;
    } catch (invokeErr) {
      console.error('[detectSleepCommitmentFromMessage] authority invoke failed:', invokeErr?.message);
      return Response.json({ detected: true, committed: false, reason: 'authority_invoke_failed', error: invokeErr?.message, character_id: characterId }, { status: 500 });
    }

    const disposition = authResult?.disposition;
    const committed = disposition === 'accepted' || disposition === 'redirected' || disposition === 'modified';
    const committedPresence = authResult?.committed_result?.resolved_presence_status || null;

    // The authority may redirect a sleep request (e.g., sleep-at-work → move
    // home first) and set must_resubmit_sleep. For chat-triggered commitments
    // we already required the character to be at a valid sleep location, so a
    // redirect should not normally occur. If it does, we do NOT auto-resubmit
    // — the character was not at home, and the commitment will be honored on a
    // subsequent turn once they are home. This keeps the trigger single-shot.
    if (authResult?.must_resubmit_sleep === true) {
      console.log(`[detectSleepCommitmentFromMessage] authority redirected (must_resubmit_sleep) for ${character.name} — not auto-resubmitting; character not yet at the committed sleep location.`);
    }

    console.log(`[detectSleepCommitmentFromMessage] char="${character.name}" reply_commitment=${commitment.type}/${commitment.phrase} → requested=${requestedStatus} disposition=${disposition} committed=${committed} committedPresence=${committedPresence}`);

    return Response.json({
      detected: true,
      committed,
      reason: committed ? 'committed' : (disposition || 'not_committed'),
      character_id: characterId,
      presence_status: committedPresence,
      requested_status: requestedStatus,
      commitment_type: commitment.type,
      commitment_phrase: commitment.phrase,
      authority_disposition: disposition,
      authority_reason: authResult?.reason || null,
    });
  } catch (error) {
    console.error('[detectSleepCommitmentFromMessage] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});