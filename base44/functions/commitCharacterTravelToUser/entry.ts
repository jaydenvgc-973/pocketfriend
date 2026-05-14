import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * commitCharacterTravelToUser
 *
 * Detects when a character has made a travel PROMISE to the user in chat
 * ("I'm on my way", "I'll be there", "I'm coming now", etc.) and immediately
 * commits a real, durable travel state pointing to the user's current location.
 *
 * This is SEPARATE from autonomous_travel_enabled — that setting governs
 * scheduled/background roaming. This function handles CONVERSATION-TRIGGERED
 * travel commitments that are user-facing promises, not background behavior.
 *
 * RULES:
 *   - Only fires when the character's response contains a clear travel promise.
 *   - Destination = user's current location (from UserSettings).
 *   - If user has no current location, falls back to their home anchor character's home.
 *   - Writes travel state to Character record (all UI surfaces read from this).
 *   - Creates a ScheduledEvent for arrival after a realistic delay (10–30 min).
 *   - The presence_stay_lock is NOT set — this is character-chosen movement.
 *   - Does NOT override an existing travel commitment to the same destination.
 */

// Travel promise phrases — must be from the character's own dialogue (not user's)
const TRAVEL_PROMISE_PATTERNS = [
  /\b(i'm|i am)\s+(on\s+my\s+way|coming|heading\s+(over|there|to\s+you)|coming\s+(over|now|right\s+now|through))\b/i,
  /\b(i'll|i\s+will)\s+(be\s+(there|over|on\s+my\s+way)|come\s+over|come\s+by|head\s+over|stop\s+by)\b/i,
  /\b(i'm|i\s+am)\s+(getting\s+in\s+the\s+car|grabbing\s+my\s+keys|leaving\s+now|headed\s+your\s+way|on\s+my\s+way\s+to\s+you)\b/i,
  /\bmeet\s+(you|me)\s+there\b/i,
  /\b(be\s+there|coming\s+to\s+you|on\s+my\s+way\s+to\s+you)\b/i,
  /\b(i'm|i\s+am)\s+(?:already\s+)?(?:in\s+the\s+car|driving\s+over|walking\s+over|heading\s+your\s+way)\b/i,
  /\bgive\s+me\s+\d+\s+(?:min(?:ute)?s?|hours?)\b.*\b(?:there|over|heading|coming)\b/i,
];

function detectTravelPromise(text) {
  if (!text) return false;
  return TRAVEL_PROMISE_PATTERNS.some(p => p.test(text));
}

// Realistic travel delay based on approximate distance / time of day
function estimateTravelMinutes(character) {
  // Base: 15 minutes. Adjust for context clues in current_activity or presence.
  const activity = (character.current_activity || '').toLowerCase();
  const presence = character.resolved_presence_status || '';

  // If they're already home and it's local, 10–15 min
  if (presence === 'home') return 10 + Math.floor(Math.random() * 5);
  // If they're at work, more likely 20–30 min
  if (presence === 'at_work') return 20 + Math.floor(Math.random() * 10);
  // If traveling already, 5–10 min (already en route)
  if (presence === 'traveling') return 5 + Math.floor(Math.random() * 5);
  // Default: 15–20 min
  return 15 + Math.floor(Math.random() * 5);
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

    // ── STEP 1: Detect travel promise in character's response ─────────────────
    if (!detectTravelPromise(characterResponse)) {
      return Response.json({ success: true, committed: false, reason: 'no_travel_promise_detected' });
    }

    console.log(`[commitCharacterTravelToUser] Travel promise detected for char=${characterId}`);

    // ── STEP 2: Load character + user settings in parallel ────────────────────
    const [charArr, settingsArr] = await Promise.all([
      base44.entities.Character.filter({ id: characterId }, null, 1),
      base44.entities.UserSettings.filter({ owner_email: user.email }, null, 1),
    ]);

    const character = charArr?.[0];
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    const userSettings = settingsArr?.[0] || {};

    // ── STEP 3: Resolve destination = user's current location ─────────────────
    const destLocationId = userSettings.user_current_location_id || null;
    const destLocationName = userSettings.user_current_location_name || null;

    // If user has no active location, we cannot commit a real travel destination.
    // The character can say they're coming but we can't resolve where. Log and return.
    if (!destLocationId || !destLocationName) {
      console.log(`[commitCharacterTravelToUser] User has no current location — cannot commit travel destination for "${character.name}"`);
      // Still write a traveling state pointing "toward user" — vague but durable
      const now = new Date().toISOString();
      await base44.entities.Character.update(characterId, {
        resolved_presence_status: 'traveling',
        resolved_location_type: 'traveling',
        resolved_source_reason: 'conversation_travel_promise',
        resolved_last_updated_at: now,
        travel_status: 'traveling_to_destination',
        traveling_to_location_id: null,
        traveling_to_location_name: 'User location (resolving)',
        last_location_update_time: now,
        // CRITICAL: do NOT touch presence_stay_lock — this is character-chosen movement
      });
      return Response.json({
        success: true,
        committed: true,
        destination: null,
        reason: 'user_location_unknown_vague_travel_set',
      });
    }

    // ── STEP 4: Guard — don't re-commit if already traveling to the same place ─
    if (
      character.travel_status === 'traveling_to_destination' &&
      character.traveling_to_location_id === destLocationId
    ) {
      console.log(`[commitCharacterTravelToUser] "${character.name}" already traveling to ${destLocationName} — skipping duplicate commit`);
      return Response.json({ success: true, committed: false, reason: 'already_traveling_to_destination' });
    }

    // ── STEP 5: Write durable travel state ───────────────────────────────────
    const now = new Date().toISOString();
    const travelMinutes = estimateTravelMinutes(character);
    const arrivalTime = new Date(Date.now() + travelMinutes * 60 * 1000).toISOString();

    await base44.entities.Character.update(characterId, {
      // Traveling state — all UI surfaces read these
      resolved_presence_status: 'traveling',
      resolved_location_type: 'traveling',
      resolved_source_reason: 'conversation_travel_promise',
      resolved_last_updated_at: now,
      travel_status: 'traveling_to_destination',
      traveling_to_location_id: destLocationId,
      traveling_to_location_name: destLocationName,
      travel_destination_location_id: destLocationId,
      last_location_update_time: now,
      // Clear stay lock — this is a character-chosen movement, not a user-forced stay
      presence_stay_lock: false,
      presence_stay_lock_location_id: null,
    });

    console.log(`[commitCharacterTravelToUser] ✓ "${character.name}" now traveling to "${destLocationName}" (ETA ${travelMinutes}min, arrival=${arrivalTime})`);

    // ── STEP 6: Schedule arrival ──────────────────────────────────────────────
    // A ScheduledEvent survives page changes, refreshes, and navigation away.
    // processScheduledEvents will pick this up and call updateCharacterLocation when it fires.
    await base44.entities.ScheduledEvent.create({
      character_ids: [characterId],
      character_names: [character.name],
      description: `${character.name} arrives at ${destLocationName} after promising to come`,
      trigger_time: arrivalTime,
      status: 'pending',
      type: 'travel_arrival',
      source: 'conversation_travel_promise',
      conversation_id: conversationId || null,
      primary_character_id: characterId,
      event_payload: {
        destination_location_id: destLocationId,
        destination_location_name: destLocationName,
        travel_promise_source: 'chat_response',
        owner_email: user.email,
        committed_at: now,
      },
    });

    console.log(`[commitCharacterTravelToUser] ✓ Arrival event scheduled for ${arrivalTime}`);

    return Response.json({
      success: true,
      committed: true,
      characterName: character.name,
      destination: destLocationName,
      travelMinutes,
      arrivalTime,
    });

  } catch (error) {
    console.error('[commitCharacterTravelToUser]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});