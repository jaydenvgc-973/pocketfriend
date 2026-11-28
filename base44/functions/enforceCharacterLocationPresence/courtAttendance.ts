/**
 * MANDATORY COURT APPEARANCE — THE SUMMONS IS THE AUTHORIZATION
 *
 * A court summons is not ordinary travel, not an invitation, and not a visit request.
 * It is the legal requirement that a named person be present at the designated
 * courthouse, so it is committed ahead of every travel, custody, care,
 * institutional-home and schedule gate. No eligibility rule can prevent a required
 * appearance.
 *
 * What is written here is ONLY the resolved presence. Every legal and custodial field
 * (is_jailed, house_arrest_active, incarceration_status, sentence, treatment,
 * residential assignment) is left exactly as it was: a person attending under custody
 * remains in custody while in court, and their own schedule, care and housing resume
 * through the existing systems when the proceeding ends.
 *
 * Physical attendance is separate from speaking participation. Everyone summoned is
 * placed here regardless of who will speak; the courtroom's own rules decide who has
 * the floor.
 */

const ATTENDANCE_AUTHORITY = "GovernmentVenueAttendance";
const ATTENDANCE_REASON = "government_event_attendance";

export async function commitCourtAttendance({ base44, characterId, payload, locationMap, etTime, ownerEmail }) {
  if (payload?.requested_authority !== ATTENDANCE_AUTHORITY) return null;
  const destinationId = payload.requested_location_id;
  // A lock release is the end of the event, not an appearance.
  if (!destinationId || payload.requested_lock_release === true) return null;

  const destination = locationMap?.[destinationId];
  const destinationName = destination?.name || payload.requested_location_name || "Courthouse";
  const nowIso = new Date().toISOString();

  const fields: Record<string, any> = {
    resolved_current_location_id: destinationId,
    resolved_current_location_name: destinationName,
    resolved_location_type: "visit",
    resolved_presence_status: "visiting",
    resolved_source_reason: payload.requested_source_reason || "court_summons",
    resolved_last_updated_at: nowIso,
    last_arrived_time: etTime.toISOString(),
    location_status: "at_location",
    travel_status: "not_traveling",
    travel_destination_location_id: null,
    traveling_to_location_id: null,
    traveling_to_location_name: null,
  };

  // The event lock keeps the existing autonomous movement system from moving a
  // participant away mid-proceeding. It is bounded and released when the event ends.
  if (payload.requested_stay_lock === true) {
    fields.presence_stay_lock = true;
    fields.presence_stay_lock_reason = payload.presence_stay_lock_reason || ATTENDANCE_REASON;
    fields.presence_stay_lock_authority = ATTENDANCE_AUTHORITY;
    fields.presence_stay_lock_location_id = destinationId;
    fields.presence_stay_lock_set_at = nowIso;
    fields.presence_stay_lock_release_condition = payload.presence_stay_lock_release_condition || "government_event_end";
    fields.presence_stay_lock_expires_at = payload.presence_stay_lock_expires_at || null;
    fields.presence_stay_lock_created_by = payload.presence_stay_lock_created_by || "system_automation";
  }

  await base44.asServiceRole.entities.Character.update(characterId, fields);

  return {
    disposition: "accepted",
    character_id: characterId,
    owner_email: ownerEmail,
    reason: null,
    committed_result: {
      resolved_current_location_id: destinationId,
      resolved_current_location_name: destinationName,
      resolved_location_type: "visit",
      resolved_presence_status: "visiting",
      resolved_source_reason: fields.resolved_source_reason,
    },
    timestamp: etTime.toISOString(),
  };
}