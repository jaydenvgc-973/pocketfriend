/**
 * sceneCrimeOutcome.js — WHAT ACTUALLY HAPPENS WHEN A CRIME ACTIVITY IS CHOSEN
 *
 * Pickpocket, Burglarize and Call the Cops are ordinary Scenes activities: they run
 * through the existing activity strip, the existing actor selector and the existing
 * narrative pipeline. This module only settles the OUTCOME of the attempt from the
 * circumstances that already exist — the people taking part, the place, and what is
 * already happening in the scene.
 *
 * It invents nothing:
 *   • an attempt is never automatically caught, and being caught is never automatically
 *     an arrest;
 *   • police intervention is never mandatory;
 *   • no money or property is ever said to have changed hands — the narrative is told to
 *     leave ownership alone unless the app's own transaction/inventory code did it.
 *
 * The only persistent consequence it can trigger is a real arrest, which is then carried
 * out by the existing custody pathway (arrestCharacter → the established incarceration
 * fields, the facility's own inmate roster and its existing cell assignment).
 */
import { base44 } from '@/api/base44Client';

// The activities whose outcome is settled here rather than by the plain activity run.
export const CRIME_ACTIVITY_IDS = ['pickpocket', 'burglarize', 'call_the_cops'];

// The established character traits that make a theft activity appropriate for a person.
export const CRIME_TRAITS = ['trait_thief', 'trait_lawbreaker'];

/** Whether anyone taking part lives that way — the reason a theft is offered here at all. */
export function castHasCrimeTrait(people = []) {
  return (people || []).some((p) => CRIME_TRAITS.some((t) => p?.[t] === true));
}

const OUTCOME_SCHEMA = {
  type: 'object',
  properties: {
    // One sentence describing what actually happened, in the scene's own words.
    direction: { type: 'string' },
    // A person is taken into police custody as part of this outcome.
    arrested: { type: 'boolean' },
    // The name of the person arrested, exactly as given in the cast list, or "".
    arrested_name: { type: 'string' },
    // Police are called to the scene or arrive during it.
    officer_needed: { type: 'boolean' },
  },
};

const ACTION_BRIEF = {
  pickpocket:
    'A character is attempting to pick someone\'s pocket. Decide how the attempt goes from the circumstances: it may go unnoticed, the target may notice something suspicious, the target may catch them in the act, a bystander may see it, they may be confronted, someone may call the police, an officer who is already here may step in, they may get away with it, or they may be arrested.',
  burglarize:
    'A character is attempting to burglarize a property here. Decide how it goes from the circumstances: it may succeed undetected, they may be interrupted before finishing, a resident, employee or passer-by may discover them, they may be confronted, they may leave with nothing, the police may be called, they may get away before police arrive, or they may be arrested.',
  call_the_cops:
    'A character is calling the police about what is happening here. Decide what the call actually leads to: the police may simply take a report, may say they will send someone, may arrive, may ask questions, or may take someone into custody. A call is never automatically an arrest.',
};

/**
 * Settle the outcome of one crime activity.
 *
 * @param {Object} input
 * @param {string} input.actionId        pickpocket | burglarize | call_the_cops
 * @param {string[]} input.actorNames    the people carrying it out
 * @param {string} input.targetName      who it is aimed at, when the user chose someone
 * @param {string[]} input.castNames     everyone in the scene, as they are known here
 * @param {string} input.locationName    where this is happening
 * @param {string} input.locationCategory the place's own category
 * @param {string} input.circumstances   the established who-is-here-and-why block, if any
 * @param {string} input.recentContext   the last few lines of the scene
 */
export async function resolveCrimeOutcome({
  actionId,
  actorNames = [],
  targetName = null,
  castNames = [],
  locationName = 'this place',
  locationCategory = '',
  circumstances = '',
  recentContext = '',
}) {
  const actors = actorNames.filter(Boolean);
  const brief = ACTION_BRIEF[actionId] || ACTION_BRIEF.pickpocket;

  const result = await base44.integrations.Core.InvokeLLM({
    prompt: `You are settling what actually happens in a scene, from circumstances that already exist. Do not invent new people, new places, weapons, serious injuries or legal proceedings.

PLACE: ${locationName}${locationCategory ? ` (${locationCategory})` : ''}
TAKING PART: ${actors.join(', ') || 'someone here'}
${targetName ? `AIMED AT: ${targetName} — the attempt is made against this person, not anyone else.\n` : ''}EVERYONE IN THE SCENE: ${castNames.filter(Boolean).join(', ') || 'the people here'}
${circumstances ? `\nESTABLISHED CIRCUMSTANCES:\n${circumstances}\n` : ''}${recentContext ? `\nWHAT HAS JUST BEEN HAPPENING:\n${recentContext}\n` : ''}
WHAT IS BEING ATTEMPTED:
${brief}

RULES:
- The outcome must follow from these circumstances, not from a fixed sequence. A thief is not automatically caught, and being caught does not automatically mean an arrest.
- Police involvement happens only when it makes sense here: if an officer is already among the people in the scene they may step in; otherwise someone may or may not call them.
- Nobody outside the cast list may be arrested. Use "" for arrested_name when no one is arrested.
- Never state or imply that money or property changed hands. Do not say something was stolen, lifted, pocketed, taken, or recovered — only describe the attempt and what was noticed.
- Keep "direction" to one or two sentences of plain description of what happened.

Return JSON.`,
    response_json_schema: OUTCOME_SCHEMA,
  });

  const data = result && typeof result === 'object' ? result : {};
  return {
    direction: String(data.direction || '').trim(),
    arrested: data.arrested === true,
    arrestedName: String(data.arrested_name || '').trim(),
    officerNeeded: data.officer_needed === true,
  };
}

/**
 * The responding officer, when police attendance is required and no officer is already
 * part of the scene. This is the app's EXISTING temporary-NPC mechanism (the same extra
 * scene people the court, City Hall and the realtor use) — not another NPC system, and
 * not a permanent character record.
 */
export function buildRespondingOfficer() {
  const stamp = Date.now();
  return {
    id: `npc_police_officer_${stamp}`,
    name: 'Police Officer',
    role: 'Police Officer',
    isNpc: true,
    npcType: 'staff',
    avatar_url: null,
  };
}

/** Whether an officer is already taking part in this scene. */
export function officerAlreadyHere(people = []) {
  return (people || []).some((p) => {
    const title = [p?.role, p?.work_details?.job_title, p?.occupation, p?.current_job]
      .filter(Boolean).join(' ').toLowerCase();
    return /police|officer|deputy|sheriff|constable|trooper/.test(title);
  });
}

/** The existing police station / jail this app already has, or null. */
export function pickCustodyFacility(locations = []) {
  return (locations || []).find((l) => l?.category === 'jail_prison' || l?.is_confinement_facility === true) || null;
}