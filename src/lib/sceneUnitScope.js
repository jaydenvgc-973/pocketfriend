/**
 * sceneUnitScope
 *
 * ONE BUILDING IS NOT ONE ROOM.
 *
 * A residence keeps its apartments in `residential_units`, a hospital its patient rooms,
 * a prison its cells — the same assignments the Places page already maintains. The Scenes
 * prompt is written around the PROPERTY (`location.name`), and the canonical co-presence
 * context marks everyone sharing that property id as physically present. Inside a specific
 * apartment / patient room / cell that reads as neighbours standing in the room, which is
 * how residents of other units became invented visitors.
 *
 * These helpers keep the Scenes dialogue on the selected space, using only the existing
 * assignments. Nothing is created, moved, reassigned, renamed, or removed.
 */
import { getUnitById, getUnitLabel } from '@/lib/residentialUnits';

const NOUNS = {
  home: { unit: 'apartment', units: 'apartments', facility: 'building' },
  hotel: { unit: 'room', units: 'rooms', facility: 'hotel' },
  medical: { unit: 'patient room', units: 'patient rooms', facility: 'hospital' },
  jail_prison: { unit: 'cell', units: 'cells', facility: 'facility' },
};

/**
 * The space this scene is actually inside, or null when the whole property is the scene
 * (no unit chosen, or a property that has no internal units). Never guessed from text.
 */
export function getSceneUnitScope(location, unitId) {
  if (!location || !unitId) return null;
  const unit = getUnitById(location, unitId);
  if (!unit) return null;
  const nouns = NOUNS[location.category] || NOUNS.home;
  return {
    unitId: unit.unit_id,
    unitLabel: getUnitLabel(unit.unit_name, location) || unit.unit_name,
    unitNoun: nouns.unit,
    unitNounPlural: nouns.units,
    facilityName: location.name || 'the building',
    facilityNoun: nouns.facility,
  };
}

/**
 * Corrects a canonical context block that was built for the property so it no longer
 * asserts that everyone in the building is physically in this space.
 *
 * Only the CURRENT co-presence roster is removed ("OTHER VERIFIED CHARACTERS PRESENT
 * HERE … You must recognize these characters as physically present with you"). Everything
 * else — identity, memories, relationships, schedule facts, and every visit or shared
 * experience these people actually had — is passed through untouched, and the correction
 * says so, so a past visit is never read as never having happened.
 */
export function scopeCanonicalContext(text, scope) {
  if (!text || !scope) return text;
  return String(text)
    .replace(/\nOTHER VERIFIED CHARACTERS PRESENT HERE:[\s\S]*?You must recognize these characters as physically present with you\.\n/g, '\n')
    .replace(/\nOTHERS PRESENT: [^\n]*\n/g, '\n')
    .replace(/Your current location: ([^\n]*)/, (match, loc) => `Your current location: ${loc} — inside ${scope.unitLabel}`)
    .concat(`\n(That roster listed everyone in the whole ${scope.facilityNoun} as physically present. Only ${scope.unitLabel} is this scene, so anyone in another ${scope.unitNoun} is elsewhere right now. This changes nothing about the past: a visit, a conversation, or time these people actually spent together — including a visit to this ${scope.unitNoun} — really happened, is remembered, and is spoken about normally.)`);
}

/**
 * The boundary rule for a scene inside one unit of a multi-unit property.
 */
export function buildUnitBoundaryBlock(scope) {
  if (!scope) return '';
  const { unitLabel, unitNoun, unitNounPlural, facilityName, facilityNoun } = scope;
  return `\n=== THE SPACE THIS SCENE IS IN (NOT THE WHOLE ${String(facilityNoun).toUpperCase()}) ===
This moment happens inside ${unitLabel} — one ${unitNoun} inside ${facilityName}, with its own occupants.
- Who is in this ${unitNoun} right now is decided by this scene, not by the ${facilityNoun} someone belongs to.
- Being assigned to another ${unitNoun} — living, being treated, or being held in it — is NOT being in this ${unitNoun}. Building membership alone never makes someone a roommate, cellmate or visitor here, and never means they entered, knocked, passed through, or spent time here.
- Anyone actually here (the people listed as present, plus the place's own people) really is here, and that stands.
- A visit that really happened stays true. If someone did come into this ${unitNoun} — earlier in this scene, in a recorded memory, or in a story these people already told — then they really did visit: they remember it, may bring it up, and speak about it as something that happened to them. It is never undone, rewritten, denied, or treated as though it never took place.
- The distinction is only about this moment: another ${unitNoun} of the same ${facilityNoun} is somewhere else right now. Past visits, conversations and shared time in this ${unitNoun} are unaffected and remain part of these people's lives.
- Knowing people exist elsewhere in the ${facilityNoun} is ordinary awareness. It never becomes a visit, an entry, a complaint about strangers in the space, or a memory of one.
- Shared areas of the ${facilityNoun} (lobby, hallway, waiting room, common area) are outside this ${unitNoun}; encounters there happen only when the scene is actually in one of them.
- An identical reference image or identical décor does not make another ${unitNoun} this one.
===`;
}