/**
 * detectAndUpdateArrival — CANONICAL WRITE DISABLED
 *
 * This function previously detected arrival via REGEX on chat message text,
 * then wrote Character.resolved_current_location_id directly based on that
 * regex match — with zero LocationHistory proof and a silent .catch() on
 * the CharacterMemory write.
 *
 * Regex-based arrival detection writing canonical location state is a verified
 * bypass: it allows unverified chat text to mutate canonical character state
 * without producing any authoritative proof record.
 *
 * Per the repair mandate: if a function cannot meet the standard safely,
 * disable the canonical write and return a hard failure.
 *
 * This function now refuses to write Character.resolved_current_location_id.
 * The arrival phrase detection logic is preserved for observation/diagnostic
 * purposes, but the canonical Character.update and CharacterMemory.create
 * are disabled. Callers must use the verified travel/arrival pipeline
 * (createTravelSession → completeTravelArrivalVerified) instead.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ARRIVAL_PHRASES = [
  'standing at the door', 'at the door', 'i\'m here', 'i made it',
  'just arrived', 'i\'m outside', 'walking in', 'pulling up',
  'i\'m in', 'i just got', 'arrived at',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { message_id, character_id, conversation_id, message_text } = await req.json();
    if (!message_id || !character_id || !conversation_id || !message_text) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Detect arrival phrase (observation only — no canonical write)
    const lowerText = message_text.toLowerCase();
    const hasArrivalPhrase = ARRIVAL_PHRASES.some(phrase => lowerText.includes(phrase));

    if (!hasArrivalPhrase) {
      return Response.json({ detected: false, reason: 'no_arrival_phrase' });
    }

    // Arrival phrase detected — but canonical Character.update is DISABLED.
    // Return a hard failure explaining why.
    return Response.json({
      success: false,
      detected: true,
      arrival_phrase_found: true,
      error: 'canonical_write_disabled',
      reason: 'Regex-based arrival detection writing canonical Character.resolved_current_location_id is a verified bypass — it mutates canonical state without producing LocationHistory proof. Use the verified travel/arrival pipeline (createTravelSession → completeTravelArrivalVerified) instead.',
      detected_phrase: ARRIVAL_PHRASES.find(p => lowerText.includes(p)),
    }, { status: 422 });

  } catch (error) {
    console.error('[detectAndUpdateArrival]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});