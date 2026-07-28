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
  // "heading to the bar", "going to the gym", "at the bar" — stop before "to see/check/find/meet/get", conjunctions, or sentence end
  /\b(?:i'm at|i am at|i'm in|currently at|just got to|heading to(?:\s+the)?|at the|going to the|going to|at my|made it to|just pulled up to|arrived at)\s+([\w\s'']+?)(?=\s+to\s+(?:see|check|find|meet|get|grab|pick)|[,.]|\s+(?:so|and|but|because|since|where|who|with|for)\b|$)/i,
  /\b(?:i'm|i am)\s+(?:at|in)\s+(?:the\s+)?([\w\s'']+?)(?=\s+to\s+(?:see|check|find|meet|get)|[,.]|\s+(?:so|and|but|because|since|where|who|with)\b|$)/i,
];

const RABBIT_HOLE_TERMS = new Set([
  'studio', 'rehearsal', 'set', 'backstage', 'session', 'recording session',
  'appointment', 'class', 'interview', 'court', 'warehouse', 'venue',
  'stage', 'rooftop', 'gallery', 'lab', 'salon', 'clinic',
]);

const VAGUE = ['out', 'busy', 'gone', 'away', 'around', 'somewhere', 'good', 'here'];

// ── VAGUE LOCATION PHRASE GUARD ───────────────────────────────────────────────
// Phrases that sound location-like but carry no real destination meaning.
// If detected, do NOT write as a real location name — write "Away" + rabbit_hole instead.
const VAGUE_LOCATION_PHRASES = new Set([
  'nearby', 'near', 'around', 'around here', 'around town', 'around the area',
  'out', 'outside', 'out there', 'out here', 'out and about',
  'somewhere', 'somewhere nearby', 'somewhere around here', 'somewhere close',
  'here', 'there', 'over there', 'right here', 'right there',
  'close by', 'close', 'not far', 'not far from here',
  'by', 'nearby somewhere', 'around somewhere',
]);

function isVagueLocationPhrase(phrase) {
  if (!phrase) return true;
  const normalized = phrase.toLowerCase().trim().replace(/\s+/g, ' ');
  return VAGUE_LOCATION_PHRASES.has(normalized);
}

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

    // ── PROTECTED REST-STATE GUARD (sleep + hospitalization) ───────────────
    // Canonical rule (sleepUtils.js): "Sleep and naps are the SUSPENSION of
    // activities. When a character enters a sleep or nap state, character-driven
    // activities STOP. Social, travel, entertainment, and activity systems do
    // NOT fire." and "Social needs MUST NOT wake a sleeping character."
    //
    // Chat activity is NOT a valid wake authority. A chat-mentioned location
    // must NOT overwrite a sleeping/napping/passed_out character's presence.
    // Normal sleep requires 6–8 hours; chat cannot cut it short. The character
    // addresses location/activity needs after waking naturally.
    //
    // HOSPITALIZED characters are in protected medical recovery. The ONLY exit
    // is discharge through enforceCharacterLocationPresence's needs-based gate
    // (all canonical life-needs ≥ 85). A chat mention of "home" or any other
    // place is NOT a discharge order — it must NOT move a hospitalized character
    // or change their presence. They remain at the hospital as a patient until
    // the discharge authority releases them.
    const PROTECTED_REST_STATES = new Set(['sleeping', 'napping', 'passed_out', 'hospitalized']);
    if (PROTECTED_REST_STATES.has(character.resolved_presence_status)) {
      const _isHospital = character.resolved_presence_status === 'hospitalized';
      return Response.json({
        success: false,
        updated: false,
        blocked: true,
        reason: _isHospital ? 'hospitalized_authority_guard' : 'sleep_authority_guard',
        character_id: characterId,
        presence_status: character.resolved_presence_status,
        message: _isHospital
          ? `${character.name} is hospitalized — chat location update blocked. Hospitalized characters are in protected medical recovery and can only be discharged by the recovery authority (all needs ≥ 85), never by a chat mention of a location.`
          : `${character.name} is ${character.resolved_presence_status} — chat location update blocked. Sleep is the suspension of activities; chat is not a valid wake authority.`,
      });
    }

    const allLocations = locRes?.data?.locations || [];
    const aliases = aliasArr || [];

    // Detect spoken place
    const detected = detectSpokenPlace(messageContent);

    // If no specific location found, check if they said they're going out (vague travel)
    if (!detected) {
      const isGoingOut = detectGoingOut(messageContent);
      if (isGoingOut) {
        // Vague going-out statement — write Away/rabbit_hole, not a made-up location name
        await base44.entities.Character.update(characterId, {
          resolved_current_location_id: null,
          resolved_current_location_name: 'Away',
          resolved_location_type: 'rabbit_hole',
          resolved_presence_status: 'rabbit_hole',
          resolved_source_reason: 'vague_location_phrase_blocked',
          location_status: 'traveling',
          travel_status: 'traveling_to_destination',
          last_location_update_time: new Date().toISOString(),
        });
        console.log(`[updateCharacterLocationFromMessage] ✓ "${character.name}" marked Away (vague going-out — blocked from writing vague name)`);
        return Response.json({ success: true, updated: true, method: 'going_out_blocked', reason: 'vague_travel_detected' });
      }
      return Response.json({ success: true, updated: false, reason: 'no_place_detected' });
    }

    const { raw, normalized } = detected;

    // ── VAGUE PHRASE GUARD — applied before any location write ────────────────
    // If the extracted phrase is a vague positional word, do not attempt to match or
    // write it as a real location name. Return unresolved so the frontend can handle it.
    if (isVagueLocationPhrase(raw) || isVagueLocationPhrase(normalized)) {
      console.log(`[updateCharacterLocationFromMessage] BLOCKED vague phrase: "${raw}" — writing Away`);
      await base44.entities.Character.update(characterId, {
        resolved_current_location_id: null,
        resolved_current_location_name: 'Away',
        resolved_location_type: 'rabbit_hole',
        resolved_presence_status: 'rabbit_hole',
        resolved_source_reason: 'vague_location_phrase_blocked',
        last_location_update_time: new Date().toISOString(),
      });
      return Response.json({ success: true, updated: true, method: 'vague_blocked', phrase: raw });
    }

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