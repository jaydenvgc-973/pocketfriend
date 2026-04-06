import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * VERIFICATION: Simulate display for ALL at-risk characters
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const activeChars = characters.filter(c => 
      c.status !== 'deleted' && 
      c.status !== 'moved_away' && 
      c.character_type !== 'npc'
    );

    // Simulate display for each character
    const displaySimulation = activeChars.map(char => {
      // Resolve location names
      const workLoc = char.occupation_location_id ? locationMap[char.occupation_location_id] : null;
      const eduLoc = char.education_location_id ? locationMap[char.education_location_id] : null;
      
      // Simulate the display logic
      let displayLabel = 'available';
      let iconType = 'calm';
      
      // Rule: If at work, show work location name
      if (workLoc && char.occupation_location_id) {
        displayLabel = `at ${workLoc.name}`;
        iconType = 'work';
      }
      // Rule: If at school, show school location name
      else if (eduLoc && char.education_location_id) {
        displayLabel = `at ${eduLoc.name}`;
        iconType = 'school';
      }

      return {
        id: char.id,
        name: char.name,
        hasOccupation: !!char.occupation_location_id,
        occupationName: workLoc?.name || null,
        simulatedDisplay: displayLabel,
        iconType: iconType,
        willShowGeneric: displayLabel.match(/^at (gym|school|work|restaurant|park|bar|club|hospital|store)$/) ? true : false
      };
    });

    const violations = displaySimulation.filter(d => d.willShowGeneric);

    return Response.json({
      totalActiveCharacters: activeChars.length,
      displaySimulation: displaySimulation,
      violationCount: violations.length,
      violations: violations
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});