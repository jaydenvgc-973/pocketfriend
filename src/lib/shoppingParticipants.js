/**
 * shoppingParticipants.js — WHO IS SHOPPING, WHO PAYS, WHO RECEIVES
 *
 * Retail shopping in Scenes has three separate roles, and they are not the same person:
 *
 *   payer     — the User or a character who is actually here shopping and pays
 *   recipient — any character on the account who receives the merchandise, present or not
 *   employee  — someone working here (a cashier or manager on shift) is not a customer
 *
 * These helpers only read existing records: scene participation, the account's character
 * records, the location's employment and shift data, and character presence. Nothing here
 * moves a character, changes a shift, adds a scene participant or invents a record.
 */
import { isCharacterOnShift } from './workScheduleUtils';

/** The people actually in this scene, deduplicated. */
export function presentShoppingPeople({ observeMode, observeCast = [], traveledWithChars = [], selectedNpcs = [] }) {
  const people = observeMode ? observeCast : [...traveledWithChars, ...selectedNpcs.filter((n) => !n.isNpc)];
  return people.filter((c, i, arr) => c?.id && arr.findIndex((x) => x.id === c.id) === i);
}

/**
 * Which of those present people are working here right now.
 * On shift by the venue's employment record, or present at this location as `at_work`.
 * Anyone else — including an employee who is off shift and shopping — is a customer.
 */
export function onShiftEmployeeIds(people, location) {
  if (!location?.id) return [];
  return (people || [])
    .filter((c) =>
      isCharacterOnShift(c.id, location)
      || (c.resolved_current_location_id === location.id && c.resolved_presence_status === 'at_work')
    )
    .map((c) => c.id);
}

/**
 * Eligible recipients: the account's own existing character records, whether they are at
 * the store, at home, at work, at school or anywhere else. A gift never requires presence.
 */
export function accountRecipients(characters, ownerEmail) {
  if (!ownerEmail) return [];
  return (characters || []).filter((c) =>
    c?.id
    && c.owner_email === ownerEmail
    && c.life_status !== 'deceased'
    && !['deleted', 'soft_deleted', 'merged'].includes(c.status)
  );
}