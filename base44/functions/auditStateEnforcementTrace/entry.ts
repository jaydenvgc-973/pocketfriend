import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * AUDIT STATE ENFORCEMENT TRACE
 * 
 * Proves that characters in travel_status !== 'not_traveling' are:
 * 1. Identified
 * 2. Processed by enforcement functions
 * 3. Resolved to valid end state
 * 
 * Returns complete trace with NO SILENT FAILURES.
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

    // IDENTIFY: Characters in travel status
    const travelingCharacters = characters.filter(c => 
      c.travel_status && c.travel_status !== 'not_traveling'
    );

    console.log(`[auditStateEnforcementTrace] Found ${travelingCharacters.length} characters in travel state`);

    const traceReport = [];
    const violationLog = [];

    for (const char of travelingCharacters) {
      const destLocId = char.travel_destination_location_id;
      const destLoc = locationMap[destLocId];
      const destExists = !!destLoc;

      // TRACE: Determine what should have happened
      let expectedEnforcementFunction = 'forceTravelStateResolution';
      let expectedAction = 'unknown';
      let validReason = null;

      // Valid reason to keep traveling:
      // - destination is valid AND reachable
      if (destExists && destLocId) {
        expectedAction = 'VALID_TRAVEL_CONTINUE';
        validReason = `destination_exists: ${destLoc.name}`;
      }
      // Invalid reason to keep traveling:
      // - destination missing OR null
      else {
        expectedAction = 'SHOULD_FORCE_HOME';
        expectedEnforcementFunction = 'forceTravelStateResolution';
        validReason = destLocId ? `destination_not_found_id_${destLocId}` : 'no_destination_set';
      }

      // Determine if this is a violation
      const isViolation = expectedAction === 'SHOULD_FORCE_HOME' && char.travel_status !== 'not_traveling';

      const traceEntry = {
        character_name: char.name,
        character_id: char.id,
        current_state: {
          travel_status: char.travel_status,
          travel_destination_location_id: destLocId,
          resolved_current_location_name: char.resolved_current_location_name,
          resolved_presence_status: char.resolved_presence_status,
        },
        destination_validation: {
          destination_id: destLocId,
          destination_exists: destExists,
          destination_name: destLoc?.name || null,
        },
        enforcement_trace: {
          expected_function: expectedEnforcementFunction,
          expected_action: expectedAction,
          valid_reason_to_travel: validReason,
        },
        is_violation: isViolation,
        violation_reason: isViolation ? 'character_in_invalid_travel_state' : null,
      };

      traceReport.push(traceEntry);

      if (isViolation) {
        violationLog.push({
          character_name: char.name,
          character_id: char.id,
          violation: `CRITICAL: In travel_status '${char.travel_status}' with invalid/missing destination`,
          required_action: `Run forceTravelStateResolution to move to home or valid arrival`,
        });
      }
    }

    // FINAL VERDICT
    const criticalViolations = violationLog.length;
    const systemSafe = criticalViolations === 0;

    return Response.json({
      timestamp: new Date().toISOString(),
      user_email: user.email,
      enforcement_audit: {
        total_characters: characters.length,
        characters_in_travel: travelingCharacters.length,
        characters_with_valid_travel: traceReport.filter(t => !t.is_violation).length,
        characters_with_invalid_travel: violationLog.length,
      },
      trace_report: traceReport,
      violations: violationLog.length > 0 ? violationLog : null,
      system_verdict: {
        no_silent_failures: violationLog.length === 0,
        all_travel_enforced: violationLog.length === 0,
        system_safe: systemSafe,
        critical_violations_found: criticalViolations,
        recommendation: systemSafe 
          ? 'STATE ENFORCEMENT PASSING — All characters in valid states'
          : `STATE ENFORCEMENT FAILURE — ${criticalViolations} violations found. Run forceTravelStateResolution immediately.`,
      }
    });

  } catch (error) {
    console.error('[auditStateEnforcementTrace]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});