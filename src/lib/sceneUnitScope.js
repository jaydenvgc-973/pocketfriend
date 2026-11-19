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
  school: { unit: 'dorm room', units: 'dorm rooms', facility: 'school' },
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
 * The space this scene is inside when it is ONE WORKPLACE of a mixed-use property.
 * Same mechanism, different wording: a business is not an apartment, and the property's
 * residents are not inside its walls just because they live in the same building.
 */
export function getWorkspaceSceneScope(location, workplace) {
  if (!location || !workplace?.workplace_id) return null;
  return {
    unitId: `workspace:${workplace.workplace_id}`,
    unitLabel: workplace.name,
    unitNoun: 'workplace',
    unitNounPlural: 'workplaces',
    facilityName: location.name || 'the building',
    facilityNoun: location.category === 'home' ? 'building' : 'property',
    isWorkspace: true,
    businessType: workplace.business_type || null,
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
  const elsewherePhrase = scope.isWorkspace
    ? `so anyone in another part of the ${scope.facilityNoun} — another workplace or an apartment — is elsewhere right now`
    : `so anyone in another ${scope.unitNoun} is elsewhere right now`;
  return String(text)
    .replace(/\nOTHER VERIFIED CHARACTERS PRESENT HERE:[\s\S]*?You must recognize these characters as physically present with you\.\n/g, '\n')
    .replace(/\nOTHERS PRESENT: [^\n]*\n/g, '\n')
    .replace(/Your current location: ([^\n]*)/, (match, loc) => `Your current location: ${loc} — inside ${scope.unitLabel}`)
    .concat(`\n(That roster listed everyone in the whole ${scope.facilityNoun} as physically present. Only ${scope.unitLabel} is this scene, ${elsewherePhrase}. This changes nothing about the past: a visit, a conversation, or time these people actually spent together — including a visit to this ${scope.unitNoun} — really happened, is remembered, and is spoken about normally.)`);
}

/**
 * The boundary rule for a scene inside one unit of a multi-unit property.
 */
export function buildUnitBoundaryBlock(scope) {
  if (!scope) return '';
  const { unitLabel, unitNoun, unitNounPlural, facilityName, facilityNoun } = scope;

  if (scope.isWorkspace) {
    return `\n=== THE SPACE THIS SCENE IS IN (ONE WORKPLACE, NOT THE WHOLE ${String(facilityNoun).toUpperCase()}) ===
This moment happens inside ${unitLabel}, a workplace inside ${facilityName}${scope.businessType ? ` (${String(scope.businessType).replace(/_/g, ' ')})` : ''}.
- The people here are ${unitLabel}'s own people — the ones whose shift has them working here now — plus anyone who actually came in.
- Living in ${facilityName} does not put a resident inside ${unitLabel}. Apartments and their households are elsewhere in the ${facilityNoun} right now, and are never present, never watching, and never part of this moment.
- Other businesses inside ${facilityName} are separate establishments. Their staff and customers are elsewhere; being employed in the ${facilityNoun} is not being in ${unitLabel}.
- Someone employed at ${unitLabel} who is not working now is not here. No one is described as on shift unless they actually are.
- A visit that really happened stays true. If someone did come into ${unitLabel} — earlier in this scene, in a recorded memory, or in a story these people already told — they really did visit, remember it, and speak about it normally.
- This is a working place, not a residence: no one lives here, and no one treats ${unitLabel} as home.
===`;
  }
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