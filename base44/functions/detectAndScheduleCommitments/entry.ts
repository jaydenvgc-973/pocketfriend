/**
 * detectAndScheduleCommitments
 *
 * Detects travel commitments in character messages and schedules INSTANT relocations.
 *
 * RULES:
 * - Uses user-scoped Character.list() — NEVER service-role or created_by
 * - No TravelSession creation — travel is INSTANT at scheduled time
 * - No progress bars. No in-transit state.
 * - Confirmed destination → schedules processScheduledRelocations via Character fields
 * - Returns: detected, commitment_type, destination, scheduled_at, confirmation_required
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── TRAVEL DIRECTIVE PATTERNS (immediate / in-progress) ─────────────────────
const TRAVEL_DIRECTIVE_PATTERNS = [
  /\b(i'?m?\s*on\s+my\s+way)\b/i,
  /\b(i'?m?\s*leaving\s+(now|right\s+now)?)\b/i,
  /\b(i'?m?\s*(heading|coming|going)\s+(there|over|to\s+you|your\s+way|out)\s*(now|right\s+now)?)\b/i,
  /\b(i'?m?\s*about\s+to\s+(leave|head\s+out|go))\b/i,
  /\b(i\s+need\s+to\s+(go|leave|head\s+out))\b/i,
  /\b(i'?ll?\s*meet\s+you\s+there)\b/i,
  /\b(i'?m?\s*coming)\b/i,
  /\b(heading\s+out\s+now|just\s+left|already\s+(left|heading|on\s+my\s+way))\b/i,
  /\b(pulling\s+up|almost\s+there|around\s+the\s+corner|a?\s*few\s+minutes\s+away)\b/i,
];

// ── TRAVEL PROMISE PATTERNS (future) ─────────────────────────────────────────
const TRAVEL_PROMISE_PATTERNS = [
  /\b(i'?ll?\s*be\s+there\s+in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?))\b/i,
  /\b(i'?ll?\s*(come|head|stop|swing|drop)\s*(over|by|there)\s*(soon|later|tonight|in\s+a\s+bit|after\s+work)?)\b/i,
  /\b(i'?ll?\s*meet\s+you\s+(there|at|later|tonight|soon))\b/i,
  /\b(see\s+you\s+(in\s+(\d+)\s*(minutes?|mins?)|soon|there|tonight|later))\b/i,
  /\b(be\s+there\s+in\s+(\d+)\s*(minutes?|mins?))\b/i,
];

const DESTINATION_PATTERN = /(?:to|at|heading\s+to|going\s+to|come\s+to|over\s+to|meet\s+(?:you\s+)?at)\s+([A-Za-z0-9][^.!?,\n]{2,40}?)(?:\s+in\s+\d|\s+at\s+\d|[.!?,]|$)/i;

function resolveEtaMinutes(text) {
  const m = text.match(/in\s+(\d+)\s*(minutes?|mins?)/i);
  if (m) return parseInt(m[1], 10);
  const h = text.match(/in\s+(\d+)\s*(hours?|hrs?)/i);
  if (h) return parseInt(h[1], 10) * 60;
  if (/\b(soon|in\s+a\s+bit|shortly|on\s+my\s+way|leaving\s+now|heading\s+out)\b/i.test(text)) return 15;
  if (/\blater\b/i.test(text)) return 90;
  if (/tonight|this\s+evening/i.test(text)) return 120;
  return 20; // default
}

function getHardBlockReason(character) {
  if (character.is_jailed) return `${character.name} is incarcerated and cannot travel.`;
  if (character.house_arrest_active) return `${character.name} is under house arrest.`;
  if (['incarcerated', 'house_arrest', 'confined'].includes(character.resolved_presence_status)) {
    return `${character.name} is confined (${character.resolved_presence_status}).`;
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, characterName, messageContent, conversationId } = await req.json();
    if (!characterId || !messageContent || !conversationId) {
      return Response.json({ error: 'characterId, messageContent, conversationId required' }, { status: 400 });
    }

    const lower = messageContent.toLowerCase();

    // Classify commitment type
    const isDirective = TRAVEL_DIRECTIVE_PATTERNS.some(p => p.test(lower));
    const isPromise   = !isDirective && TRAVEL_PROMISE_PATTERNS.some(p => p.test(lower));

    if (!isDirective && !isPromise) {
      return Response.json({ detected: false, reason: 'no_commitment_language' });
    }

    // Load character via user-scoped roster (ONLY working path)
    const allChars = await base44.entities.Character.list(null, 500);
    const character = allChars.find(c => c.id === characterId);

    if (!character) {
      return Response.json({ detected: false, reason: 'character_not_found_in_roster', characterId });
    }

    const blockReason = getHardBlockReason(character);
    if (blockReason) {
      return Response.json({ detected: true, blocked: true, block_reason: blockReason });
    }

    // Extract destination from message
    let destinationName = null;
    const destMatch = messageContent.match(DESTINATION_PATTERN);
    if (destMatch?.[1]) {
      destinationName = destMatch[1].trim().replace(/\s+(in|at|to)$/i, '');
    }

    // Calculate ETA
    const etaMinutes = resolveEtaMinutes(lower);
    const now = Date.now();
    const scheduledAt = new Date(now + etaMinutes * 60000).toISOString();

    // Try to resolve destination location ID from location list
    let destinationLocationId = null;
    let destinationLocationName = destinationName;

    if (destinationName) {
      const allLocs = await base44.entities.LocationReference.list(null, 300);
      const normalizedDest = destinationName.toLowerCase();
      const matched = allLocs.find(l => l.name && l.name.toLowerCase().includes(normalizedDest));
      if (matched) {
        destinationLocationId = matched.id;
        destinationLocationName = matched.name;
      }
    }

    // Write CharacterCommitment record
    const commitment = await base44.asServiceRole.entities.CharacterCommitment.create({
      character_id: characterId,
      character_name: character.name,
      owner_email: character.owner_email || user.email,
      commitment_type: 'arrival',
      destination_location_id: destinationLocationId,
      destination_location_name: destinationLocationName || 'unresolved destination',
      commitment_source: 'conversational_message',
      source_conversation_id: conversationId,
      commitment_text: messageContent.substring(0, 300),
      expected_arrival_time: scheduledAt,
      expected_arrival_window_minutes: Math.max(5, Math.round(etaMinutes * 0.2)),
      interruptible: false,
      status: 'active',
      created_at: new Date(now).toISOString(),
    });

    // If we have a confirmed destination location ID, schedule the instant relocation
    // by stamping the character's pending_scheduled_relocation_at and next_location_id fields.
    // processScheduledRelocations (runs every 5 min) will execute the move at the scheduled time.
    if (destinationLocationId) {
      await base44.entities.Character.update(characterId, {
        pending_scheduled_relocation_at: scheduledAt,
        next_location_id: destinationLocationId,
        next_location_name: destinationLocationName,
        pending_relocation_source: 'commitment',
        pending_relocation_message_id: commitment.id,
        pending_relocation_confirmed_at: new Date(now).toISOString(),
      });
    }

    // Write short-term memory
    await base44.asServiceRole.entities.CharacterMemory.create({
      character_id: characterId,
      memory_type: 'event',
      memory_text: `I committed to going to ${destinationLocationName || 'the destination'}: "${messageContent.substring(0, 150)}". Scheduled arrival: ${scheduledAt}.`,
      memory_summary: `Travel commitment to ${destinationLocationName || 'destination'}`,
      importance_score: 7,
      permanence: 'short_term',
    }).catch(() => {});

    console.log(`[detectAndScheduleCommitments] char="${character.name}" type=${isDirective ? 'directive' : 'promise'} dest="${destinationLocationName}" eta=${etaMinutes}min scheduled=${scheduledAt} dest_resolved=${!!destinationLocationId}`);

    return Response.json({
      detected: true,
      commitment_type: isDirective ? 'travel_directive' : 'travel_promise',
      character_name: character.name,
      destination_name: destinationLocationName,
      destination_location_id: destinationLocationId,
      eta_minutes: etaMinutes,
      scheduled_at: scheduledAt,
      commitment_id: commitment.id,
      destination_resolved: !!destinationLocationId,
      // If destination could NOT be resolved, caller should show confirmation prompt with manual location picker
      confirmation_required: !destinationLocationId,
    });

  } catch (error) {
    console.error('[detectAndScheduleCommitments] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});