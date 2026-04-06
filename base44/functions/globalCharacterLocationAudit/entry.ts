import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * GLOBAL AUDIT: Trace location display for ALL ACTIVE CHARACTERS
 * Identify any generic category collapses in the display pipeline
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all data
    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const locations = await base44.entities.LocationReference.list();
    
    // Active characters only
    const activeChars = characters.filter(c => 
      c.status !== 'deleted' && 
      c.status !== 'moved_away' && 
      c.character_type !== 'npc'
    );

    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    // Audit each active character
    const audit = activeChars.map(char => {
      const violations = [];

      // Check current_location_id
      if (char.current_location_id && locationMap[char.current_location_id]) {
        const loc = locationMap[char.current_location_id];
        if (!loc.name) violations.push('current_location has no name field');
      } else if (char.current_location_id && !locationMap[char.current_location_id]) {
        violations.push(`current_location_id ${char.current_location_id} NOT FOUND`);
      }

      // Check occupation_location_id
      if (char.occupation_location_id && !locationMap[char.occupation_location_id]) {
        violations.push(`occupation_location_id ${char.occupation_location_id} NOT FOUND`);
      }

      // Check education_location_id
      if (char.education_location_id && !locationMap[char.education_location_id]) {
        violations.push(`education_location_id ${char.education_location_id} NOT FOUND`);
      }

      // Detect generic activity keywords that could collapse locations
      const activity = (char.current_activity || '').toLowerCase();
      const genericKeywords = ['gym', 'school', 'work', 'restaurant', 'park', 'bar', 'club', 'hospital', 'store'];
      const hasGenericActivity = genericKeywords.some(k => activity.includes(k));

      return {
        id: char.id,
        name: char.name,
        currentLocationId: char.current_location_id,
        currentLocationName: char.current_location_id ? locationMap[char.current_location_id]?.name : null,
        occupationLocationId: char.occupation_location_id,
        occupationLocationName: char.occupation_location_id ? locationMap[char.occupation_location_id]?.name : null,
        educationLocationId: char.education_location_id,
        educationLocationName: char.education_location_id ? locationMap[char.education_location_id]?.name : null,
        currentActivity: char.current_activity,
        hasGenericActivityKeywords: hasGenericActivity,
        violations: violations.length > 0 ? violations : null
      };
    });

    // Find characters at risk of generic display
    const atRisk = audit.filter(a => {
      // At risk if they have a named location assigned but also generic activity keywords
      const hasNamedLocation = a.currentLocationName || a.occupationLocationName || a.educationLocationName;
      return hasNamedLocation && a.hasGenericActivityKeywords;
    });

    return Response.json({
      totalActiveCharacters: activeChars.length,
      totalLocationReferences: locations.length,
      charactersAtRiskOfGenericDisplay: atRisk.length,
      atRiskList: atRisk,
      fullAudit: audit
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});