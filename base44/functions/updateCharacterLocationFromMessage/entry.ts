import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * updateCharacterLocationFromMessage
 * 
 * Resolution priority:
 *   1. Exact saved-location match (name or keyword)
 *   2. User-scoped alias memory (saved_location or rabbit_hole)
 *   3. No match → return unresolved=true so frontend can show popup
 *
 * If a match is found, updates character's resolved presence fields.
 * NEVER defaults to home just because no exact match exists.
 */

function normalizePhrase(p) {
  return p.toLowerCase().trim()
    .replace(/['".,!?]/g, '')
    .replace(/\bthe\b\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const PLACE_PATTERNS = [
  /\b(?:i'm at|i am at|i'm in|currently at|just got to|heading to|at the|going to the|at my|made it to|just pulled up to|arrived at)\s+([\w\s'']+?)(?:\s*[,.]|$)/i,
  /\b(?:i'm|i am)\s+(?:at|in)\s+(?:the\s+)?([\w\s'']+?)(?:\s*[,.]|$)/i,
];

const RABBIT_HOLE_TERMS = new Set([
  'studio', 'rehearsal', 'set', 'backstage', 'session', 'recording session',
  'appointment', 'class', 'interview', 'court', 'warehouse', 'venue',
  'stage', 'rooftop', 'gallery', 'lab', 'salon', 'clinic',
]);

const VAGUE = ['out', 'busy', 'gone', 'away', 'around', 'somewhere', 'back', 'good', 'here'];

// Detect "going out" / "heading out" / "stepping out" statements — sets traveling state without specific destination
const GOING_OUT_PATTERNS = [
  /\b(?:i'm|i am|i'll be|gonna be|going to be)\s+(?:going|heading|stepping|getting|going\s+out|heading\s+out|stepping\s+out|out\s+for\s+a\s+bit|out\s+for\s+a\s+while|out\s+tonight|out\s+today|out\s+right\s+now)\b/i,
  /\b(?:just\s+)?(?:left|leaving|heading out|stepping out|going out|going for a walk|going for a run|going for a drive|going to run errands|running errands|out\s+for\s+a\s+bit)\b/i,
  /\b(?:i\s+need\s+to\s+go|gotta\s+go|gotta\s+head\s+out|time\s+to\s+go|about\s+to\s+head\s+out)\b/i,
];

function detectGoingOut(msg) {
  const lower = msg.toLowerCase();
  return GOING_OUT_PATTERNS.some(p => p.test(lower));
}

function detectSpokenPlace(msg) {
  const lower = msg.toLowerCase();
  // Skip pure single-word vague
  if (VAGUE.some(v => lower === v || lower === `i'm ${v}`)) return null;

  for (const pattern of PLACE_PATTERNS) {
    const m = msg.match(pattern);
    if (m && m[1]) {
      const raw = m[1].trim();
      if (raw.length < 2 || VAGUE.includes(raw.toLowerCase())) continue;
      return { raw, normalized: normalizePhrase(raw) };
    }
  }

  // Direct mention of a rabbit-hole term
  for (const term of RABBIT_HOLE_TERMS) {
    if (lower.includes(term)) {
      return { raw: term, normalized: term };
    }
  }

  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, messageContent } = await req.json();
    if (!characterId || !messageContent) {
      return Response.json({ error: 'Missing characterId or messageContent' }, { status: 400 });
    }

    const [charArr, locRes, aliasArr] = await Promise.all([
      base44.entities.Character.filter({ id: characterId }),
      base44.functions.invoke('fetchAllLocationsForUser', {}),
      base44.asServiceRole.entities.LocationAlias.filter({ owner_email: user.email }),
    ]);

    const character = charArr?.[0];
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    const allLocations = locRes?.data?.locations || [];
    const aliases = aliasArr || [];

    // Detect spoken place
    const detected = detectSpokenPlace(messageContent);

    // If no specific location found, check if they said they're going out (vague travel)
    if (!detected) {
      const isGoingOut = detectGoingOut(messageContent);
      if (isGoingOut) {
        // Set character to a traveling/out state without a specific destination
        await base44.entities.Character.update(characterId, {
          resolved_current_location_name: 'Out',
          resolved_location_type: 'visit',
          resolved_presence_status: 'visiting',
          resolved_source_reason: 'chat_going_out',
          location_status: 'traveling',
          travel_status: 'traveling_to_destination',
          last_location_update_time: new Date().toISOString(),
        });
        console.log(`[updateCharacterLocationFromMessage] ✓ "${character.name}" marked as out/traveling (vague going-out statement)`);
        return Response.json({ success: true, updated: true, method: 'going_out', reason: 'vague_travel_detected' });
      }
      return Response.json({ success: true, updated: false, reason: 'no_place_detected' });
    }

    const { raw, normalized } = detected;

    // STEP 1: Exact saved-location match
    let exactMatch = null;
    for (const loc of allLocations) {
      const locNorm = normalizePhrase(loc.name);
      const kws = (loc.keywords || []).map(k => normalizePhrase(k));
      if (locNorm === normalized || kws.includes(normalized)) {
        exactMatch = loc;
        break;
      }
      // Also check partial: message contains the full location name
      if (messageContent.toLowerCase().includes(loc.name.toLowerCase()) && loc.name.length > 4) {
        exactMatch = loc;
        break;
      }
    }

    if (exactMatch) {
      await base44.asServiceRole.entities.Character.update(characterId, {
        resolved_current_location_id: exactMatch.id,
        resolved_current_location_name: exactMatch.name,
        resolved_location_type: 'visit',
        resolved_presence_status: 'visiting',
        resolved_source_reason: 'chat_exact_match',
        location_status: 'at_location',
        is_rabbit_hole: false,
        rabbit_hole_label: null,
        last_location_update_time: new Date().toISOString(),
      });
      return Response.json({ success: true, updated: true, method: 'exact_match', location: exactMatch.name });
    }

    // STEP 2: Check alias memory (user-scoped)
    const alias = aliases.find(a => {
      const aPhrase = normalizePhrase(a.phrase);
      return aPhrase === normalized || normalized.includes(aPhrase) || aPhrase.includes(normalized);
    });

    if (alias) {
      if (alias.resolution_type === 'saved_location' && alias.resolved_location_id) {
        await base44.asServiceRole.entities.Character.update(characterId, {
          resolved_current_location_id: alias.resolved_location_id,
          resolved_current_location_name: alias.resolved_location_name,
          resolved_location_type: 'visit',
          resolved_presence_status: 'visiting',
          resolved_source_reason: 'chat_alias',
          location_status: 'at_location',
          is_rabbit_hole: false,
          rabbit_hole_label: null,
          last_location_update_time: new Date().toISOString(),
        });
        // Bump use count
        base44.asServiceRole.entities.LocationAlias.update(alias.id, { use_count: (alias.use_count || 1) + 1 }).catch(() => {});
        return Response.json({ success: true, updated: true, method: 'alias_saved_location', location: alias.resolved_location_name });
      }

      if (alias.resolution_type === 'rabbit_hole') {
        const label = alias.rabbit_hole_label || raw.replace(/\b\w/g, c => c.toUpperCase());
        await base44.asServiceRole.entities.Character.update(characterId, {
          resolved_current_location_id: null,
          resolved_current_location_name: label,
          resolved_location_type: 'rabbit_hole',
          resolved_presence_status: 'rabbit_hole',
          resolved_source_reason: 'chat_alias_rabbit_hole',
          location_status: 'at_location',
          is_rabbit_hole: true,
          rabbit_hole_label: label,
          rabbit_hole_subtype: alias.rabbit_hole_subtype || null,
          rabbit_hole_started_at: new Date().toISOString(),
          last_location_update_time: new Date().toISOString(),
        });
        base44.asServiceRole.entities.LocationAlias.update(alias.id, { use_count: (alias.use_count || 1) + 1 }).catch(() => {});
        return Response.json({ success: true, updated: true, method: 'alias_rabbit_hole', label });
      }

      if (alias.resolution_type === 'ignored') {
        return Response.json({ success: true, updated: false, reason: 'alias_ignored' });
      }
    }

    // STEP 3: Unresolved — return signal for frontend popup
    return Response.json({
      success: true,
      updated: false,
      unresolved: true,
      phrase: raw,
      normalized,
      characterId,
      characterName: character.name,
    });
  } catch (error) {
    console.error('[updateCharacterLocationFromMessage]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});