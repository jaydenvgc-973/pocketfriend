import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get ALL characters for this user
    const allCharacters = await base44.entities.Character.filter({ created_by: user.email }, '-created_date');
    
    // Get all locations
    const allLocations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    const diagnostics = [];
    const issues = [];
    const fixes = [];

    for (const character of allCharacters) {
      if (character.status === 'deleted') continue;

      const diag = {
        characterId: character.id,
        characterName: character.name,
        statedLocation: character.current_location_id ? locationMap[character.current_location_id]?.name : 'None',
        statedActivity: character.current_activity || 'None',
        scheduledWorkLocation: character.occupation_location_id ? locationMap[character.occupation_location_id]?.name : 'Unemployed',
        isOnShift: false,
        mismatch: false,
        issue: null,
        recommendation: null,
      };

      // Check if character is currently on shift at their work location
      if (character.occupation_location_id && character.work_start_time && character.work_end_time && character.work_days) {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        const [workStartH, workStartM] = character.work_start_time.split(':').map(Number);
        const [workEndH, workEndM] = character.work_end_time.split(':').map(Number);
        const workStartMinutes = workStartH * 60 + workStartM;
        const workEndMinutes = workEndH * 60 + workEndM;

        const onScheduledDay = character.work_days.includes(dayOfWeek);
        const withinWorkHours = currentMinutes >= workStartMinutes && currentMinutes <= workEndMinutes;

        diag.isOnShift = onScheduledDay && withinWorkHours;
      }

      // Check for mismatches
      if (character.current_location_id && character.occupation_location_id) {
        const statedLocId = character.current_location_id;
        const scheduledLocId = character.occupation_location_id;

        // If they say they're at work location but NOT on shift → mismatch
        if (statedLocId === scheduledLocId && !diag.isOnShift) {
          diag.mismatch = true;
          diag.issue = `Character is at work location but NOT on shift`;
          diag.recommendation = `Trust character's statement: they're at ${diag.statedLocation} but off-duty. Update activity to reflect "off the clock" if needed.`;
          issues.push(diag);
        }
      }

      // If character says they're somewhere but NOT their work location, that's authoritative
      if (character.current_location_id && character.current_location_id !== character.occupation_location_id) {
        diag.mismatch = false; // This is fine — character is allowed to be elsewhere
        diag.recommendation = `Character's stated location (${diag.statedLocation}) is authoritative. Not their work location, so this is valid.`;
      }

      // If NO current location but ON shift, they should be at work
      if (!character.current_location_id && diag.isOnShift) {
        diag.issue = `Character is on shift but current_location_id is not set`;
        diag.recommendation = `Set current_location_id to their work location: ${character.occupation_location_id}`;
        issues.push(diag);
        fixes.push({
          characterId: character.id,
          characterName: character.name,
          fix: 'Set current_location_id to work location',
          locationId: character.occupation_location_id,
        });
      }

      diagnostics.push(diag);
    }

    return Response.json({
      totalCharacters: allCharacters.length,
      totalDiagnostics: diagnostics.length,
      issuesFound: issues.length,
      diagnostics,
      issues,
      fixes,
      summary: `Checked ${allCharacters.length} characters. Found ${issues.length} location/schedule mismatches. Character statements are SOURCE OF TRUTH — system should reflect where they say they are.`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});