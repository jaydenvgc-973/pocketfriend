/**
 * sceneAccommodations.js — what a place actually provides to sleep or rest on.
 *
 * A character sleeps on what their surroundings really have. A bedroom's bed is used when
 * there is a bed; a couch is used when the room has one; an encampment offers the ground, a
 * blanket, cardboard, a tent or a bench. Nothing here creates an object, a zone or a
 * destination — it only reads the zone names, zone descriptions and location description
 * that Places already stores, so the picture can say what is genuinely there.
 *
 * Pure reads of records already in hand — no fetching, no writes.
 */

// Ordered by preference: the first place someone would sleep comes first.
const ACCOMMODATION_CUES = [
  { pattern: /bedroom|bed room|master suite|\bbed\b|\bbeds\b|bunk|murphy bed|daybed/i, label: 'bed' },
  { pattern: /couch|sofa|sectional|loveseat|sleeper sofa/i, label: 'couch' },
  { pattern: /mattress|futon|air mattress|air bed|cot\b|crib/i, label: 'mattress' },
  { pattern: /hammock/i, label: 'hammock' },
  { pattern: /sleeping bag/i, label: 'sleeping bag' },
  { pattern: /tent|encampment|makeshift shelter/i, label: 'tent' },
  { pattern: /bench/i, label: 'bench' },
  { pattern: /cardboard/i, label: 'cardboard' },
  { pattern: /blanket|quilt|sleeping pad/i, label: 'blanket' },
  { pattern: /armchair|recliner|\bchair\b/i, label: 'chair' },
  { pattern: /carpet|rug|floor|ground|pavement|sidewalk|street|alley|lot\b|under the bridge|underpass|overpass|yard|park\b/i, label: 'ground' },
];

/**
 * The sleeping/resting accommodations this place establishes, most preferred first.
 * The selected zone decides when there is one; otherwise the property's own zones do.
 */
export function resolveEstablishedAccommodations(location, zoneName) {
  if (!location) return [];
  const zones = Array.isArray(location.zones) ? location.zones : [];
  const selected = zoneName ? zones.find((z) => z && z.zone_name === zoneName) : null;

  const text = selected
    ? `${selected.zone_name || ''} ${selected.zone_description || ''}`
    : [location.name, location.description, ...zones.map((z) => `${z?.zone_name || ''} ${z?.zone_description || ''}`)].filter(Boolean).join(' ');

  const found = [];
  for (const cue of ACCOMMODATION_CUES) {
    if (cue.pattern.test(text) && !found.includes(cue.label)) found.push(cue.label);
  }
  return found.slice(0, 4);
}

/**
 * The authoritative sleep/rest sentence for a picture.
 *
 * It states where these people actually sleep — the bed if this place has a bed, otherwise
 * whatever it really offers — and forbids anything the place does not have. It never
 * assumes a bed exists, and it never forbids one that does.
 */
export function buildSleepAccommodationRule({ names = [], accommodations = [] } = {}) {
  const who = names.filter(Boolean).join(' and ');
  if (!who) return '';
  const plural = names.filter(Boolean).length > 1;
  const list = accommodations.filter(Boolean);

  if (list.length > 0) {
    return `SLEEP/REST STATE (authoritative — do not contradict): ${who} ${plural ? 'are' : 'is'} asleep — eyes closed, relaxed, not awake and not talking. They sleep on what this place actually provides: ${list.join(', ')}. Use the real one that is here — the bed when this place has a bed, otherwise the couch, mattress, bench, tent or ground just listed — and ⛔ add nothing that is not here.`;
  }

  return `SLEEP/REST STATE (authoritative — do not contradict): ${who} ${plural ? 'are' : 'is'} asleep — eyes closed, relaxed, not awake and not talking. This place provides no bed, couch or mattress: they sleep on what is actually here — the ground, cardboard, a blanket, a sleeping bag, inside a tent, on a bench, or in a chair. ⛔ Never invent a bed, mattress, couch or bedroom.`;
}