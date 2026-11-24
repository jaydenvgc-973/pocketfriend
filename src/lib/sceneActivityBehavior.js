/**
 * sceneActivityBehavior.js — WHAT AN ACTIVITY-STRIP ACTION MEANS
 *
 * The Scenes strip already has two established modes, Narrative and Direct. What it never
 * had was a single statement of which mode each activity belongs to, so choosing an action
 * could be played as a request to discuss it instead of the thing actually happening.
 *
 *   immediate — the activity HAS ALREADY HAPPENED (or is happening now) the moment it is
 *               chosen. It is canon as soon as it is selected: the kiss happened, the meal
 *               is on the table, the money moved. The scene continues from it and never
 *               asks the characters to perform it, agree to it, or play it out again.
 *
 *   direct    — behavior to be carried out now. The scene plays it out through what the
 *               characters actually say and do. It is not a finished event before they
 *               have done it.
 *
 * The classification follows what the activity IS — never its name, emoji or category.
 * This is the only place the distinction is decided, so the strip, the who-and-who
 * selector and the observed scene cannot disagree about the same action.
 */
import { EATING_ACTION_IDS, IN_WORLD_ACTIVITY_TEXT } from './sceneActionConfig';

// Settled states and established interactions: choosing one means it is already the case.
const IMMEDIATE_ACTIVITY_IDS = new Set([
  // A moment between two people that is not a request — it happens.
  'kiss', 'moonwink',
  // Being somewhere, settled: the person is now sitting, resting, asleep, in the water.
  'sit', 'sit_bench', 'sit_booth', 'sit_counter', 'sit_outside', 'sit_work',
  'relax', 'lay_down', 'nap',
  'bathroom', 'bathroom_break', 'home_shower', 'jail_shower', 'home_brush_teeth',
  // Checked in: the room, the bed or the table is theirs now.
  'hotel_checkin', 'hotel_room', 'shelter_checkin', 'shelter_rest', 'sk_sit',
  // A fight has happened the moment it is chosen: it is a lived event both of them were
  // in, never a proposal to be agreed to.
  'fight_with',
  // An attempt and its outcome are settled when it is chosen: the theft happened, the
  // call was made, and what came of it already did.
  'pickpocket', 'burglarize', 'call_the_cops',
]);

/**
 * Which established mode this activity uses.
 *
 * A meal or a drink is already on the table when it is chosen (the app records it against
 * the person who has it), and anything purchased, paid for or served has already been
 * transacted by the time the action returns — so those are immediate too. Everything else
 * is behavior the scene has to actually carry out.
 */
export function activityBehaviorFor(action) {
  if (!action) return 'direct';
  const id = action.id;
  if (IMMEDIATE_ACTIVITY_IDS.has(id)) return 'immediate';
  if (EATING_ACTION_IDS.includes(id)) return 'immediate';
  if (['purchase', 'service', 'fee'].includes(action.action_class)) return 'immediate';
  return 'direct';
}

export function isImmediateActivity(action) {
  return activityBehaviorFor(action) === 'immediate';
}

/**
 * The centered feed line for a strip action: the activity and the people actually taking
 * part in it.
 *
 * An interface-only title never reaches the scene feed. Where the activity's name would
 * otherwise be shown, the moment itself is described instead — so the intimacy activity
 * is never named by its button, and a two-person interaction names both people.
 */
export function activityFeedLine({ actionId, label, verb = null, participants = [] }) {
  const names = (participants || []).filter(Boolean);
  const who = names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : (names[0] || '');

  const inWorld = IN_WORLD_ACTIVITY_TEXT[actionId];
  if (inWorld) {
    if (names.length === 2) return `${names[0]} ${inWorld.pair || inWorld.past} ${names[1]}`;
    return who ? `${who} ${inWorld.past}` : inWorld.past;
  }

  // Two named people with a verb read as the moment itself: "Gideon kissed Khalil".
  if (names.length === 2 && verb) return `${names[0]} ${verb} ${names[1]}`;
  return who ? `${label} — ${who}` : (label || '');
}