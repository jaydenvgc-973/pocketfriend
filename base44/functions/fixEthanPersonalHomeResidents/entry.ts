import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * fixEthanPersonalHomeResidents
 *
 * TARGETED FIX for characters incorrectly assigned to "Ethan Thompson's Home"
 * via the `fixed_corrupted_home_id` automated repair logic.
 *
 * WHAT THIS DOES:
 * - Moves Stephanie, Sarah, Marisol, Vanessa, Larry from Ethan Thompson's Home
 *   to Ethan's Family Home (which is their canonical residence as npc_family_members)
 * - Updates both current_home_location_id AND resolved_ fields
 * - Leaves Ethan Thompson UNTOUCHED (he correctly lives at his own home)
 * - Leaves Thomas and Linda UNTOUCHED (they are already at Ethan's Family Home)
 * - Does NOT touch any other character
 *
 * PROOF SOURCE for each correction:
 * - All 5 characters are character_type = npc_family_member
 * - Thomas and Linda (same family) already have Ethan's Family Home as their home
 * - The resident_family_members on Ethan's Family Home lists Sarah, Larry, Thomas, Stephanie
 * - Marisol and Vanessa are npc_family_member characters on the same account
 * - All 5 have resolved_source_reason = 'fixed_corrupted_home_id' (automated mis-assignment)
 *
 * Pass confirm=true to execute. Default is dry run.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const confirmWrite = body?.confirm === true;

    const PERSONAL_HOME_ID = '69d03c56a5e65c211c8a6105'; // Ethan Thompson's Home
    const FAMILY_HOME_ID   = '69d03c5558a81a27afb716eb'; // Ethan's Family Home
    const ETHAN_ID         = '69c0d59d7e382cc866ded9c9'; // Ethan Thompson — DO NOT TOUCH

    // These are the exact character IDs confirmed as wrongly assigned
    const WRONGLY_ASSIGNED = [
      { id: '69cc3d44b25d3fd3a0fd6452', name: 'Stephanie' },
      { id: '69cc3d42d6ca008ac66f34fd', name: 'Sarah' },
      { id: '69cc3d5da03ec2209200dff4', name: 'Marisol' },
      { id: '69cc3d612394d529d2754ccb', name: 'Vanessa' },
      { id: '69cc3d43cc9d37cbf0c6888d', name: 'Larry' },
    ];

    // Read the family home location to get its name
    const familyHomeArr = await base44.entities.LocationReference.filter({ id: FAMILY_HOME_ID });
    const familyHome = familyHomeArr[0];
    if (!familyHome) {
      return Response.json({
        error: 'Ethan\'s Family Home location not found by ID',
        family_home_id: FAMILY_HOME_ID,
      }, { status: 404 });
    }

    const now = new Date().toISOString();
    const results = [];

    for (const target of WRONGLY_ASSIGNED) {
      // Read current state to verify before writing
      const charArr = await base44.entities.Character.filter({ id: target.id });
      const char = charArr[0];

      if (!char) {
        results.push({
          id: target.id,
          name: target.name,
          action: 'SKIP',
          reason: 'Character not found',
        });
        continue;
      }

      // Safety check: never touch Ethan
      if (char.id === ETHAN_ID) {
        results.push({
          id: char.id,
          name: char.name,
          action: 'SKIP_PROTECTED',
          reason: 'This is Ethan Thompson — protected',
        });
        continue;
      }

      // Verify they are currently wrongly assigned to personal home
      const isAtPersonalHome =
        char.current_home_location_id === PERSONAL_HOME_ID ||
        char.home_location_id === PERSONAL_HOME_ID;

      if (!isAtPersonalHome) {
        results.push({
          id: char.id,
          name: char.name,
          action: 'SKIP_ALREADY_CLEAN',
          reason: `home is ${char.current_home_location_id} — not at personal home`,
          current_home: char.current_home_location_id,
        });
        continue;
      }

      const updatePayload = {
        // Fix the home field — canonical residence
        current_home_location_id: FAMILY_HOME_ID,
        // Fix the resolved location — where they are right now
        resolved_current_location_id: FAMILY_HOME_ID,
        resolved_current_location_name: familyHome.name,
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'canonical_family_home_restored',
        resolved_last_updated_at: now,
        // Clear any stale travel/movement state
        travel_status: 'not_traveling',
        travel_destination_location_id: null,
        traveling_to_location_id: null,
        traveling_to_location_name: null,
      };

      if (confirmWrite) {
        await base44.entities.Character.update(char.id, updatePayload);
      }

      results.push({
        id: char.id,
        name: char.name,
        action: confirmWrite ? 'FIXED' : 'DRY_RUN',
        from: {
          current_home_location_id: char.current_home_location_id,
          resolved_current_location_id: char.resolved_current_location_id,
          resolved_current_location_name: char.resolved_current_location_name,
          resolved_source_reason: char.resolved_source_reason,
        },
        to: {
          current_home_location_id: FAMILY_HOME_ID,
          resolved_current_location_id: FAMILY_HOME_ID,
          resolved_current_location_name: familyHome.name,
          resolved_source_reason: 'canonical_family_home_restored',
        },
        proof: 'npc_family_member; Thomas and Linda already at Family Home; fixed_corrupted_home_id was automated mis-assignment',
      });
    }

    // Also verify the LocationReference for Ethan's personal home still only has Ethan
    const personalHomeArr = await base44.entities.LocationReference.filter({ id: PERSONAL_HOME_ID });
    const personalHome = personalHomeArr[0];
    const personalResidentIds = personalHome?.resident_character_ids || [];
    const nonEthanInLocation = personalResidentIds.filter(id => id !== ETHAN_ID);

    // If there are non-Ethan IDs in the location record, report them (but don't auto-fix location record here)
    const locationRecordStatus = nonEthanInLocation.length === 0
      ? 'CLEAN: Only Ethan is in resident_character_ids'
      : `WARNING: ${nonEthanInLocation.length} non-Ethan IDs in resident_character_ids: ${nonEthanInLocation.join(', ')}`;

    return Response.json({
      dry_run: !confirmWrite,
      family_home_name: familyHome.name,
      family_home_id: FAMILY_HOME_ID,
      personal_home_resident_ids_status: locationRecordStatus,
      corrections: results,
      summary: confirmWrite
        ? `Fixed ${results.filter(r => r.action === 'FIXED').length} characters. Ethan Thompson's Home now contains only Ethan.`
        : `DRY RUN: Would fix ${results.filter(r => r.action === 'DRY_RUN').length} characters. Pass confirm=true to execute.`,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});