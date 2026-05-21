/**
 * validateTravelIntegrity
 *
 * Validates that Character.travel_status and TravelSession are synchronized.
 * Returns detailed blocker reasons if travel is invalid.
 *
 * A character may ONLY show traveling if:
 * 1. activeSession exists with valid route_status (preparing|in_transit|delayed)
 * 2. All required session fields exist and are valid
 * 3. Origin and destination locations resolve
 * 4. Status bar can render (estimated_arrival_time, duration_minutes, progress_percent)
 * 5. Map movement can render (origin_location_id, destination_location_id, progress_percent)
 */
export function validateTravelIntegrity({ character, activeSession, locationsById = {} }) {
  const blockers = [];
  const proof = {
    character_id: character?.id,
    character_travel_status: character?.travel_status,
    has_active_session: !!activeSession,
    session_id: activeSession?.id,
    session_route_status: activeSession?.route_status,
  };

  // ── RULE 1: If traveling, session MUST exist ──────────────────────────────
  const travelingStates = ['traveling_to_work', 'traveling_to_school', 'traveling_to_destination'];
  const isCharacterTraveling = travelingStates.includes(character?.travel_status);

  if (isCharacterTraveling && !activeSession) {
    blockers.push('character_travel_status_without_session');
    proof.blocker_reason = 'character_travel_status_without_session';
  }

  // ── RULE 2: If session exists, character MUST be traveling ─────────────────
  if (activeSession && !isCharacterTraveling) {
    blockers.push('session_without_character_travel_status');
    proof.blocker_reason = 'session_without_character_travel_status';
  }

  // ── RULE 3: Ownership match ────────────────────────────────────────────────
  if (activeSession && character?.owner_email !== activeSession.owner_email) {
    blockers.push('ownership_mismatch');
    proof.ownership_mismatch = {
      character_owner_email: character?.owner_email,
      session_owner_email: activeSession.owner_email,
    };
  }

  // ── RULE 4: Route status must be valid ──────────────────────────────────────
  const validRouteStatuses = ['preparing', 'in_transit', 'delayed'];
  if (activeSession && !validRouteStatuses.includes(activeSession.route_status)) {
    blockers.push('invalid_route_status');
    proof.invalid_route_status = activeSession.route_status;
  }

  // ── RULE 5-6: Origin and destination must exist ──────────────────────────────
  const originLocation = locationsById[activeSession?.origin_location_id];
  const destLocation = locationsById[activeSession?.destination_location_id];

  if (activeSession && !originLocation) {
    blockers.push('missing_origin');
    proof.origin_resolution = { id: activeSession.origin_location_id, found: false };
  }

  if (activeSession && !destLocation) {
    blockers.push('missing_destination');
    proof.destination_resolution = { id: activeSession.destination_location_id, found: false };
  }

  // ── RULE 7: Estimated times must exist ──────────────────────────────────────
  if (activeSession && !activeSession.estimated_departure_time) {
    blockers.push('missing_departure_time');
  }

  if (activeSession && !activeSession.estimated_arrival_time) {
    blockers.push('missing_eta');
  }

  // ── RULE 8: Duration must exist and be positive ────────────────────────────
  if (activeSession && (!activeSession.duration_minutes || activeSession.duration_minutes <= 0)) {
    blockers.push('invalid_duration');
    proof.duration_minutes = activeSession.duration_minutes;
  }

  // ── RULE 9: Progress must be valid number 0-100 ──────────────────────────────
  const progress = activeSession?.progress_percent;
  if (activeSession && (progress === null || progress === undefined || progress < 0 || progress > 100)) {
    blockers.push('invalid_progress');
    proof.progress_percent = progress;
  }

  // ── RULE 10: ETA validation ───────────────────────────────────────────────────
  if (activeSession && activeSession.estimated_arrival_time) {
    const eta = new Date(activeSession.estimated_arrival_time).getTime();
    const now = Date.now();
    const etaPassed = eta < now;
    proof.eta_passed = etaPassed;
    proof.estimated_arrival_time = activeSession.estimated_arrival_time;
    proof.now = new Date(now).toISOString();

    if (etaPassed && activeSession.route_status !== 'arrived') {
      blockers.push('eta_passed_but_not_arrived');
    }
  }

  // ── STATUS BAR DATA EXISTS ──────────────────────────────────────────────────
  const hasStatusBarData =
    !!activeSession?.estimated_arrival_time &&
    !!activeSession?.duration_minutes &&
    activeSession?.progress_percent !== null &&
    activeSession?.progress_percent !== undefined;
  proof.status_bar_data_exists = hasStatusBarData;

  if (isCharacterTraveling && !hasStatusBarData) {
    blockers.push('status_bar_missing');
  }

  // ── MAP MOVEMENT DATA EXISTS ───────────────────────────────────────────────
  const hasMapMovementData =
    !!activeSession?.origin_location_id &&
    !!activeSession?.destination_location_id &&
    (activeSession?.progress_percent !== null && activeSession?.progress_percent !== undefined);
  proof.map_movement_source_exists = hasMapMovementData;

  if (isCharacterTraveling && !hasMapMovementData) {
    blockers.push('map_marker_missing');
  }

  return {
    valid: blockers.length === 0,
    blocker_reason: blockers.length > 0 ? blockers[0] : null,
    blockers,
    status_bar_data_exists: hasStatusBarData,
    map_movement_source_exists: hasMapMovementData,
    proof,
  };
}