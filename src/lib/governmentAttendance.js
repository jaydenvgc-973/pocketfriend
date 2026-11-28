import { base44 } from "@/api/base44Client";

/**
 * governmentAttendance.js
 *
 * Physical attendance for a government event (court proceeding, civil ceremony).
 *
 * This file owns no location logic. It is a thin caller of the existing presence
 * authority — enforceCharacterLocationPresence — which is the sole canonical writer
 * of a character's resolved location and presence. A selected participant is placed
 * at the venue the same way any other visit is committed: as a visit with a stay
 * lock, so the existing autonomous movement system leaves them at the event for its
 * duration. When the event concludes the lock is released and the existing resolver
 * returns the character to their own schedule (work, school, home) on its own.
 *
 * Nothing here teleports a character the presence authority would refuse: a confined,
 * hospitalized or otherwise unavailable character is reported as unable to attend, and
 * the scene is built without them.
 */

const ATTENDANCE_REASON = "government_event_attendance";
const ATTENDANCE_AUTHORITY = "GovernmentVenueAttendance";

// The event lock is bounded: an event that is never formally closed still cannot keep
// anyone anchored to the venue forever. Four hours of Eastern time, expressed on the
// same basis the presence lock validator compares against (Eastern components).
function attendanceLockExpiry() {
  const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  return new Date(etNow.getTime() + 4 * 60 * 60 * 1000).toISOString();
}

/** Plain-language reason a selected participant could not attend. */
export function attendanceRefusalLabel(reason, name) {
  const who = name || "A selected participant";
  switch (reason) {
    case "confinement_block":
    case "incarceration_confinement_lock":
    case "house_arrest_confinement_lock":
      return `${who} is confined and cannot attend.`;
    case "hospitalized_relocation_blocked":
    case "hospitalized_movement_blocked":
      return `${who} is hospitalized and cannot attend.`;
    case "deceased":
      return `${who} is deceased.`;
    case "destination_not_in_scope":
      return `${who} cannot travel to this venue.`;
    case "destination_vacation_eligibility_blocked":
      return `${who} cannot travel to this venue right now.`;
    case "no_destination":
      return `${who} could not be brought to this venue.`;
    default:
      return `${who} could not be present at this venue.`;
  }
}

/**
 * Establish physical attendance at the venue for the selected characters, through the
 * existing presence authority. Returns who is actually attending and who could not be.
 *
 * Each character is placed under the account that actually owns them: the presence
 * authority is scoped by owner, so a known cross-account participant (a juror or a
 * witness) is never placed by writing another account's record with this account's
 * scope. Their ownership is untouched either way — the authority itself decides whether
 * that character can legitimately reach this venue.
 */
export async function placeEventAttendees({ location, characterIds = [], ownerEmail, characters = [] }) {
  const ids = [...new Set((characterIds || []).filter(Boolean))];
  if (!location?.id || ids.length === 0) return { attendingIds: [], refused: [] };

  const ownerById = new Map((characters || []).filter((c) => c?.id).map((c) => [c.id, c.owner_email || ownerEmail]));

  const results = await Promise.all(ids.map(async (id) => {
    try {
      const res = await base44.functions.invoke("enforceCharacterLocationPresence", {
        character_id: id,
        owner_email: ownerById.get(id) || ownerEmail,
        requested_presence_status: "visiting",
        requested_location_id: location.id,
        requested_location_name: location.name,
        requested_source_reason: ATTENDANCE_REASON,
        requested_authority: ATTENDANCE_AUTHORITY,
        requested_stay_lock: true,
        presence_stay_lock_reason: ATTENDANCE_REASON,
        presence_stay_lock_authority: ATTENDANCE_AUTHORITY,
        presence_stay_lock_release_condition: "government_event_end",
        presence_stay_lock_expires_at: attendanceLockExpiry(),
        presence_stay_lock_created_by: "system_automation",
      });
      const data = res?.data || {};
      // 'accepted' committed the attendance; 'no_change' means they are already exactly
      // there, which is attendance too.
      const ok = ["accepted", "no_change"].includes(data.disposition);
      return { id, ok, reason: data.reason || null };
    } catch (err) {
      return { id, ok: false, reason: err?.message || "unavailable" };
    }
  }));

  return {
    attendingIds: results.filter((r) => r.ok).map((r) => r.id),
    refused: results.filter((r) => !r.ok),
  };
}

/**
 * Release the event. Only participants still holding THIS event's lock are released —
 * a character who went to sleep or started a shift keeps that system's own authority.
 * The lock release is followed by the existing recompute, so each character returns to
 * their own established schedule rather than being sent somewhere arbitrary.
 */
export async function releaseEventAttendees({ characterIds = [], ownerEmail, characters = [], restoreHospitalized = [] }) {
  const ids = [...new Set((characterIds || []).filter(Boolean))];
  if (ids.length === 0) return;

  const ownerById = new Map((characters || []).filter((c) => c?.id).map((c) => [c.id, c.owner_email || ownerEmail]));
  const ownIds = ids.filter((id) => (ownerById.get(id) || ownerEmail) === ownerEmail);

  let held = [];
  try {
    const records = await base44.entities.Character.filter({ id: { $in: ownIds } }, "-created_date", ownIds.length);
    held = (records || [])
      .filter((c) => c.presence_stay_lock === true && c.presence_stay_lock_reason === ATTENDANCE_REASON)
      .map((c) => c.id);
  } catch {
    return;
  }
  // A cross-account participant's lock is confirmed on the record this account already
  // holds, then released under that character's own account — never under this one.
  const crossHeld = ids.filter((id) => !ownIds.includes(id) && (characters || []).some(
    (c) => c?.id === id && c.presence_stay_lock === true && c.presence_stay_lock_reason === ATTENDANCE_REASON
  ));

  await Promise.all([...held, ...crossHeld].map(async (id) => {
    const owner = ownerById.get(id) || ownerEmail;
    try {
      await base44.functions.invoke("enforceCharacterLocationPresence", {
        character_id: id,
        owner_email: owner,
        requested_lock_release: true,
      });
      // No transition requested — the authority recomputes from this character's own
      // schedule, needs and home. This is the existing return-to-normal resolution.
      await base44.functions.invoke("enforceCharacterLocationPresence", {
        character_id: id,
        owner_email: owner,
      });
    } catch {
      // The bounded lock expiry releases anyone the release could not reach.
    }
  }));

  // A hospitalized participant attended court and goes back to their care unchanged.
  // The summons moved them for the proceeding only, so their hospital presence is
  // re-established through the same authority once the event ends — care is never lost
  // by appearing in court.
  await Promise.all((restoreHospitalized || [])
    .filter((h) => h?.id && h?.location_id && (ownerById.get(h.id) || ownerEmail) === ownerEmail)
    .map(async (h) => {
      try {
        await base44.functions.invoke("enforceCharacterLocationPresence", {
          character_id: h.id,
          owner_email: ownerEmail,
          requested_presence_status: "hospitalized",
          requested_location_id: h.location_id,
          requested_location_name: h.location_name,
          requested_source_reason: "medical_emergency",
          requested_authority: ATTENDANCE_AUTHORITY,
        });
      } catch {
        // Their own record still carries their care state; nothing is discharged here.
      }
    }));
}