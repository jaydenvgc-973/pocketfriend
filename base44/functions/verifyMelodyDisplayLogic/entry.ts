import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * DIAGNOSTIC: Simulate what getCharacterStatusDisplay returns for Melody NOW
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Find Melody
    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const melody = characters.find(c => c.name === 'Melody Jackson Perry' || c.name === 'Melody');

    if (!melody) {
      return Response.json({ error: 'Melody not found' });
    }

    // Fetch locations
    const allLocs = await base44.entities.LocationReference.list();
    const vgcGym = allLocs.find(l => l.id === melody.occupation_location_id);

    // Simulate the logic
    const activity = melody.current_activity?.toLowerCase().trim() || '';
    const workLocation = vgcGym;
    
    // Step 1: Not sleeping
    // Step 2: Not in prayer
    // Step 3: No current_location_id
    // Step 4: AT WORK check
    const unemployedKeywords = ['unemployed', 'between jobs'];
    const workType = (melody?.work_details?.workplace_type || '').toLowerCase();
    const isUnemployed = unemployedKeywords.some(k => workType.includes(k));
    
    const hasOccupationAssignment = !!melody.occupation_location_id;
    const willReturnWork = !isUnemployed && workLocation && hasOccupationAssignment;
    
    let simulatedResult = null;
    if (willReturnWork) {
      const locationName = workLocation?.name;
      const label = locationName ? `at ${locationName}` : 'at work';
      simulatedResult = { iconType: 'work', label, color: 'text-blue-400' };
    }

    return Response.json({
      melodyName: melody.name,
      melodyActivity: melody.current_activity,
      melodyOccupationLocationId: melody.occupation_location_id,
      occupationLocationName: vgcGym?.name || 'NOT FOUND',
      isUnemployed: isUnemployed,
      hasOccupationAssignment: hasOccupationAssignment,
      willReturnWorkStatus: willReturnWork,
      simulatedStatusDisplay: simulatedResult || 'WOULD NOT RETURN WORK'
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});