import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FULL TRAVEL STATE VALIDATION
 * 
 * Checks ALL travel indicator fields:
 * - travel_status
 * - resolved_presence_status
 * - resolved_location_type
 * 
 * A character is "IN TRAVEL" if ANY field indicates traveling.
 * 
 * FAILURE = ANY field mismatch or unresolved travel state.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Load all user characters
    let characters = [];
    try {
      characters = await base44.entities.Character.filter({ owner_email: user.email });
    } catch {
      characters = await base44.asServiceRole.entities.Character.filter({ owner_email: user.email });
    }

    // Load all locations
    let locations = [];
    try {
      locations = await base44.entities.LocationReference.filter({ owner_email: user.email });
    } catch {
      locations = await base44.asServiceRole.entities.LocationReference.filter({ owner_email: user.email });
    }
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    // FULL STATE AUDIT
    const allCharacterStates = [];
    const travelingCharacters = [];
    const stateConflicts = [];

    for (const char of characters) {
      const travelStatus = char.travel_status || 'not_traveling';
      const resolvedPresence = char.resolved_presence_status || 'unknown';
      const resolvedLocType = char.resolved_location_type || 'unknown';
      const destLocId = char.travel_destination_location_id;
      const destLoc = destLocId ? locationMap[destLocId] : null;
      const currentLocName = char.resolved_current_location_name || 'Unknown';

      // CHECK: Is character traveling according to ANY field?
      const isTravelingViaStatus = travelStatus !== 'not_traveling';
      const isTravelingViaPresence = resolvedPresence === 'traveling';
      const isTravelingViaLocType = resolvedLocType === 'traveling';
      const isAnyTravelIndicatorActive = isTravelingViaStatus || isTravelingViaPresence || isTravelingViaLocType;

      // CHECK: Field alignment (all should agree)
      const fieldsAligned = 
        (travelStatus === 'not_traveling' && resolvedPresence !== 'traveling' && resolvedLocType !== 'traveling') ||
        (travelStatus !== 'not_traveling' && (resolvedPresence === 'traveling' || resolvedLocType === 'traveling'));

      const stateEntry = {
        character_name: char.name,
        character_id: char.id,
        travel_indicators: {
          travel_status: travelStatus,
          resolved_presence_status: resolvedPresence,
          resolved_location_type: resolvedLocType,
        },
        travel_detection: {
          traveling_via_travel_status: isTravelingViaStatus,
          traveling_via_resolved_presence: isTravelingViaPresence,
          traveling_via_resolved_location_type: isTravelingViaLocType,
          any_travel_indicator_active: isAnyTravelIndicatorActive,
        },
        location_context: {
          current_location_name: currentLocName,
          destination_id: destLocId || null,
          destination_name: destLoc?.name || null,
          destination_exists: !!destLoc,
        },
        state_validation: {
          fields_aligned: fieldsAligned,
          conflict_detected: !fieldsAligned,
        },
      };

      allCharacterStates.push(stateEntry);

      // If traveling via ANY field, add to traveling list
      if (isAnyTravelIndicatorActive) {
        travelingCharacters.push(stateEntry);
      }

      // If fields don't align, add to conflicts
      if (!fieldsAligned) {
        stateConflicts.push({
          character_name: char.name,
          character_id: char.id,
          conflict: `travel_status='${travelStatus}' but resolved_presence='${resolvedPresence}' and resolved_location_type='${resolvedLocType}'`,
          requires_investigation: true,
        });
      }
    }

    // SYSTEM VERDICT
    const systemPassing = travelingCharacters.length === 0 && stateConflicts.length === 0;

    return Response.json({
      timestamp: new Date().toISOString(),
      user_email: user.email,
      full_state_audit: {
        total_characters: characters.length,
        characters_with_any_travel_indicator: travelingCharacters.length,
        characters_with_field_conflicts: stateConflicts.length,
      },
      traveling_characters: travelingCharacters.length > 0 ? travelingCharacters : null,
      state_conflicts: stateConflicts.length > 0 ? stateConflicts : null,
      all_character_states: allCharacterStates,
      system_verdict: {
        all_travel_indicators_resolved: travelingCharacters.length === 0,
        all_fields_aligned: stateConflicts.length === 0,
        system_passing: systemPassing,
        critical_failures: travelingCharacters.length + stateConflicts.length,
        recommendation: systemPassing
          ? 'SYSTEM PASSING — No travel indicators active, all fields aligned'
          : `SYSTEM FAILING — ${travelingCharacters.length} characters in travel, ${stateConflicts.length} field conflicts detected`,
      }
    });

  } catch (error) {
    console.error('[auditFullTravelStateValidation]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});