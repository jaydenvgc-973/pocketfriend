/**
 * courtParticipation.js
 *
 * How a selected participant can take part in a court proceeding. It adds no new status
 * system and writes nothing: it reads the character's existing authoritative
 * circumstance — hospitalization, incarceration — and says whether they can be brought
 * physically to the courthouse or must take part remotely from where they actually are.
 *
 * Work and school are deliberately absent from every rule here: a scheduled shift or a
 * class never prevents court attendance, and nothing in this file touches a schedule,
 * an employment record, an enrollment, a hospital status or a sentence.
 */
import { isIncarceratedCharacter } from "./jailSceneRules";

/** Currently hospitalized, by the presence authority's own status. */
export function isHospitalizedCharacter(person) {
  return person?.resolved_presence_status === "hospitalized";
}

/**
 * How this participant appears in court.
 *
 * A court summons is a legal obligation and the authorization for that person's
 * presence — not ordinary travel. So every required participant is brought physically
 * to the courthouse regardless of custody, house arrest or hospitalization, and those
 * circumstances are never changed by appearing. (Custody and treatment remain exactly
 * as they were; only where the person is standing for the proceeding changes.)
 *
 * Kept as a function so callers keep one shared reading of a participant's mode.
 */
export function courtParticipationMode(person) {
  if (!person) return "physical";
  return "physical";
}

/**
 * A refusal that means the person simply stays where they are: custody and hospital are
 * physical facts, not unavailability. They take part remotely instead of being dropped.
 */
export function isRemoteRefusal(reason) {
  return [
    "confinement_block",
    "incarceration_confinement_lock",
    "house_arrest_confinement_lock",
    "hospitalized_relocation_blocked",
    "hospitalized_movement_blocked",
  ].includes(reason);
}

/** Where they actually are, from their own record. */
export function actualLocationName(person) {
  return person?.resolved_current_location_name || person?.incarceration_facility_name || "their own location";
}

/**
 * Role-specific eligibility, from the circumstance table:
 *
 *   circumstance            defendant  witness  juror
 *   hospitalized            allowed    excluded excluded
 *   incarcerated            allowed    allowed  excluded
 *   scheduled work / school allowed    allowed  allowed
 *   released from custody   allowed    allowed  allowed
 *
 * The role carries its own exclusions; a person's shift or class carries none.
 */
export function roleAcceptsCharacter(role, person) {
  if (!role || !person) return false;
  if (role.excludeIncarcerated && isIncarceratedCharacter(person)) return false;
  if (role.excludeHospitalized && isHospitalizedCharacter(person)) return false;
  return true;
}