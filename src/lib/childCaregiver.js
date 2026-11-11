/**
 * childCaregiver
 *
 * One authority for reading the EXISTING child-supervision caregiver. The caregiver is
 * maintained by ensureChildCaregiverPresence: a npc_regular Character record with
 * is_sitter = true and sitter_assigned_to_location_id = the home it was assigned to.
 *
 * ON DUTY is the assignment itself. The caregiver is assigned only while children are
 * home and no adult who lives there has returned. A visiting adult never ends it, and
 * the caregiver is never a household guardian — it is the supervision, not the reason
 * supervision stops.
 *
 * Read-only. Nothing here creates, assigns, or removes a caregiver.
 */

export function isCaregiverRecord(character) {
  if (!character) return false;
  return character.is_sitter === true || /babysit|caregiver|nanny|sitter/i.test(String(character.occupation || ''));
}

export function isCaregiverOnDuty(character, locationId) {
  if (!character || !locationId) return false;
  // The assignment IS the supervision, and presence resolution follows it
  // (locationResolutionEngine's child-supervision guard). A cleared assignment is not
  // on duty — that is how departure is expressed.
  return character.is_sitter === true && character.sitter_assigned_to_location_id === locationId;
}