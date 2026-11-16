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
 * The one line removed is the property-wide co-presence roster ("OTHER VERIFIED
 * CHARACTERS PRESENT HERE … You must recognize these characters as physically present
 * with you"). Everything else — identity, memories, relationship, schedule facts — is
 * passed through untouched.
 */
export function scopeCanonicalContext(text, scope) {
  if (!text || !scope) return text;
  return String(text)
    .replace(/\nOTHER VERIFIED CHARACTERS PRESENT HERE:[\s\S]*?You must recognize these characters as physically present with you\.\n/g, '\n')
    .replace(/\nOTHERS PRESENT: [^\n]*\n/g, '\n')
    .replace(/Your current location: ([^\n]*)/, (match, loc) => `Your current location: ${loc} — inside ${scope.unitLabel}`);
}

/**
 * The boundary rule for a scene inside one unit of a multi-unit property.
 */
export function buildUnitBoundaryBlock(scope) {
  if (!scope) return '';
  const { unitLabel, unitNoun, unitNounPlural, facilityName, facilityNoun } = scope;
  return `\n=== THE SPACE THIS SCENE IS IN (NOT THE WHOLE ${String(facilityNoun).toUpperCase()}) ===
This moment happens inside ${unitLabel} — one ${unitNoun} inside ${facilityName}, with its own occupants.
- ${facilityName}'s other ${unitNounPlural} are separate spaces. Anyone assigned to another ${unitNoun} is elsewhere in the ${facilityNoun}, not in this one.
- Living in the same ${facilityNoun}, being treated in it, or being held in it is NOT being in this ${unitNoun}. Never present those people as roommates, cellmates, visitors, or as someone who entered, knocked, passed through, or spent time here, unless an established event in this scene puts them here.
- Knowing people exist elsewhere in the ${facilityNoun} is ordinary awareness. It never becomes a visit, an entry, a complaint about strangers in the space, or a memory of one.
- Shared areas of the ${facilityNoun} (lobby, hallway, waiting room, common area) are outside this ${unitNoun}; encounters there happen only when the scene is actually in one of them.
- An identical reference image or identical décor does not make another ${unitNoun} this one.
===`;
}