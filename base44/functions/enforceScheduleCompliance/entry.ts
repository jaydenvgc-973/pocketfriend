import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * STRICT SCHEDULE ENFORCEMENT
 * 
 * Runs every 5 minutes to verify and auto-correct schedule violations.
 * If a character should be at work/school but isn't, force correct their location immediately.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all active characters and locations
    const characters = await base44.entities.Character.filter(
      { created_by: user.email, status: 'active' },
      "-updated_date"
    );
    
    const locationsRes = await base44.functions.invoke('fetchAllLocationsForUser', {});
    const locations = locationsRes?.data?.locations || [];
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    // Import resolution engine
    const { checkScheduleViolation, autoCorrectScheduleViolation } = await import('../lib/locationResolutionEngine.js');

    const violations = [];
    const corrections = [];
    const now = new Date();

    // Check each character for schedule violations
    for (const char of characters) {
      const violation = checkScheduleViolation(char, locationMap, now);

      if (violation.isViolating) {
        violations.push({
          character_id: char.id,
          character_name: char.name,
          violation_type: violation.violation_type,
          should_be_at: violation.should_be_at
        });

        // AUTO-CORRECT: Apply the correction immediately
        const correction = autoCorrectScheduleViolation(char, locationMap, now);
        if (correction) {
          try {
            await base44.entities.Character.update(char.id, correction);
            corrections.push({
              character_id: char.id,
              character_name: char.name,
              corrected_to: violation.should_be_at.location_name,
              reason: violation.should_be_at.reason
            });
          } catch (err) {
            console.error(`Failed to correct ${char.name}:`, err.message);
          }
        }
      }
    }

    return Response.json({
      status: 'SCHEDULE_COMPLIANCE_CHECK',
      timestamp: now.toISOString(),
      total_characters: characters.length,
      violations_detected: violations.length,
      corrections_applied: corrections.length,
      violations,
      corrections
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});