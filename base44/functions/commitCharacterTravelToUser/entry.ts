/**
 * commitCharacterTravelToUser — TRANSIT BEHAVIOR REMOVED, PROMISE DETECTION PRESERVED
 *
 * Previously: detected travel promise in chat, then calculated travel time,
 * wrote 'traveling' presence state, created a delayed ScheduledEvent for ETA arrival.
 * That transit behavior is forbidden.
 *
 * Now: detects the travel promise (same regex patterns preserved), then schedules
 * a one-time instant teleport via the pending relocation fields — the same
 * mechanism used by confirmMovementCommitment. processScheduledRelocations
 * executes the teleport instantly at the scheduled time.
 *
 * No travel time calculation. No 'traveling' presence state. No ETA.
 * No in-transit state. No progress. Just: promise detected → schedule teleport →
 * character appears at destination at the promised time.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TRAVEL_PROMISE_PATTERNS = [
  /\b(i'm|i am)\s+(on\s+my\s+way|coming|heading\s+(over|there|to\s+you)|coming\s+(over|now|right\s+now|through))\b/i,
  /\b(i'll|i\s+will)\s+(be\s+(there|over|on\s+my\s+way)|come\s+over|come\s+by|head\s+over|stop\s+by)\b/i,
  /\b(i'm|i am)\s+(getting\s+in\s+the\s+car|grabbing\s+my\s+keys|leaving\s+now|headed\s+your\s+way|on\s+my\s+way\s+to\s+you)\b/i,
  /\bmeet\s+(you|me)\s+there\b/i,
  /\b(be\s+there|coming\s+to\s+you|on\s+my\s+way\s+to\s+you)\b/i,
  /\b(i'm|i am)\s+(?:already\s+)?(?:in\s+the\s+car|driving\s+over|walking\s+over|heading\s+your\s+way)\b/i,
  /\bgive\s+me\s+\d+\s+(?:min(?:ute)?s?|hours?)\b.*\b(?:there|over|heading|coming)\b/i,
];

function detectTravelPromise(text) {
  if (!text) return false;
  return TRAVEL_PROMISE_PATTERNS.some(p => p.test(text));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, characterResponse, conversationId } = await req.json();
    if (!characterId || !characterResponse) {
      return Response.json({ error: 'characterId and characterResponse required' }, { status: 400 });
    }

    // ── STEP 1: Detect travel promise (PRESERVED) ──────────────────────────
    if (!detectTravelPromise(characterResponse)) {
      return Response.json({ success: true, committed: false, reason: 'no_travel_promise_detected' });
    }

    console.log(`[commitCharacterTravelToUser] Travel promise detected for char=${characterId}`);

    // ── STEP 2: Load character + user settings ──────────────────────────────
    const [charArr, settingsArr] = await Promise.all([
      base44.entities.Character.filter({ id: characterId }, null, 1),
      base44.entities.UserSettings.filter({ owner_email: user.email }, null, 1),
    ]);

    const character = charArr?.[0];
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    const userSettings = settingsArr?.[0] || {};

    // ── STEP 3: Resolve destination = user's current location ───────────────
    let destLocationId = userSettings.user_current_location_id || null;
    let destLocationName = userSettings.user_current_location_name || null;

    if (!destLocationId || !destLocationName) {
      return Response.json({
        success: false,
        error: 'Cannot resolve travel destination',
        reason: 'user_location_unknown',
        recoveryAction: 'character_asks_location',
      }, { status: 400 });
    }

    // ── STEP 4: Guard — don't re-commit if already pending to same dest ─────
    if (
      character.next_location_id === destLocationId &&
      character.pending_scheduled_relocation_at
    ) {
      return Response.json({ success: true, committed: false, reason: 'already_pending_teleport_to_destination' });
    }

    // ── STEP 5: Schedule one-time instant teleport ──────────────────────────
    // The teleport fires at the promised time via processScheduledRelocations.
    // No transit state, no ETA calculation, no 'traveling' presence.
    // Default teleport time: 10 minutes from now (the character said "on my way"
    // — they arrive shortly, but there is no distance/ETA calculation).
    const now = new Date();
    const teleportTime = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

    await base44.entities.Character.update(characterId, {
      // Pending relocation fields — read by processScheduledRelocations
      next_location_id: destLocationId,
      next_location_name: destLocationName,
      pending_scheduled_relocation_at: teleportTime,
      pending_relocation_from: character.resolved_current_location_id,
      pending_relocation_from_name: character.resolved_current_location_name,
      pending_relocation_source: 'chat_travel_promise',
      pending_relocation_message_id: null,
      pending_relocation_confirmed_at: now.toISOString(),
      resolved_last_updated_at: now.toISOString(),
      // NO travel_status, NO traveling_to_*, NO 'traveling' presence.
      // The character stays at their current location until the teleport fires.
    });

    // ── STEP 6: Create CharacterCommitment for tracking ─────────────────────
    try {
      await base44.asServiceRole.entities.CharacterCommitment.create({
        character_id: characterId,
        character_name: character.name,
        owner_email: user.email,
        commitment_type: 'arrival',
        destination_location_id: destLocationId,
        destination_location_name: destLocationName,
        commitment_source: 'chat_travel_promise',
        source_conversation_id: conversationId || null,
        commitment_text: `${character.name} promised to come to ${destLocationName}`,
        expected_arrival_time: teleportTime,
        status: 'active',
        created_at: now.toISOString(),
      });
    } catch (commitErr) {
      console.warn(`[commitCharacterTravelToUser] CharacterCommitment create failed (non-fatal): ${commitErr.message}`);
    }

    console.log(`[commitCharacterTravelToUser] ✓ "${character.name}" promise → teleport scheduled to "${destLocationName}" at ${teleportTime}`);

    return Response.json({
      success: true,
      committed: true,
      characterName: character.name,
      destination: destLocationName,
      teleportTime,
      instant_teleport_scheduled: true,
    });

  } catch (error) {
    console.error('[commitCharacterTravelToUser]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});