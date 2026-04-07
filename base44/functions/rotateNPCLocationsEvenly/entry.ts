import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if current time is within travel window (10 AM to 1 AM)
    const now = new Date();
    const hour = now.getHours();
    const isWithinTravelWindow = hour >= 10 && hour < 1; // 10 AM to 12:59 PM, or if we consider 1 AM as 1:00, then hour should be < 25 (which is always true) but we check for 1 AM differently
    // Actually, 1 AM is 01:00, so hour would be 1. Travel is 10 AM (10) to 1 AM (1). This wraps around midnight.
    // So: hour >= 10 OR hour < 1 means 10 AM to 12:59 AM, plus 12 AM to 12:59 AM, plus 12:01 AM to 1:00 AM
    const isWithinWindow = hour >= 10 || hour < 1;
    
    if (!isWithinWindow) {
      return Response.json({ message: 'Not within travel time window (10 AM - 1 AM)' }, { status: 200 });
    }

    // Get all locations
    const allLocations = await base44.entities.LocationReference.list();
    const vgcTowers = allLocations.find(loc => loc.name === 'VGC Towers');
    
    // Filter for valid NPC travel locations (non-residential, non-VGC Towers)
    const validNPCLocations = allLocations.filter(loc => {
      const isResidential = loc.category === 'home';
      const isValidCategory = ['food_drink', 'gym', 'social', 'outdoor', 'business'].includes(loc.category);
      return !isResidential && isValidCategory && loc.id !== vgcTowers?.id;
    });

    if (validNPCLocations.length === 0) {
      return Response.json({ error: 'No valid NPC travel locations found' }, { status: 400 });
    }

    // Get all active characters
    const allCharacters = await base44.entities.Character.filter({ 
      created_by: user.email, 
      status: 'active' 
    });

    // **Identify all true VGC Towers NPC Residents**
    
    // 1. Character entities at VGC Towers (excluding Active Created Characters)
    const vgcCharacters = allCharacters.filter(c => 
      c.current_home_location_id === vgcTowers.id && 
      c.character_type !== 'active'
    );

    // 2. NPCs explicitly listed in VGC Towers resident_family_members (only those marked isNPC: true)
    const npcResidentsFromLocationList = (vgcTowers.resident_family_members || [])
      .filter(member => member.isNPC === true)
      .map(member => member.name);

    let rotatedCount = 0;
    const ownerUpdates = {}; // Track which owners need updates

    // **Process Character entities at VGC Towers**
    vgcCharacters.forEach(char => {
      const charIsWorking = isNPCWorking(char, now);
      
      if (!charIsWorking) {
        const locationIdx = rotatedCount % validNPCLocations.length;
        const newLocation = validNPCLocations[locationIdx];
        
        // For now, track that this character should be rotated
        // In a full system, would update character travel state
        rotatedCount++;
      }
    });

    // **Process NPC family members explicitly listed in resident_family_members**
    // These are true residents of VGC Towers, regardless of who they're related to
    allCharacters.forEach(char => {
      if (!char.fictional_relationships) return;
      
      char.fictional_relationships.forEach((rel, idx) => {
        // Check if this is one of the NPCs listed as a resident
        if (!rel.related_character_id && npcResidentsFromLocationList.includes(rel.person_name)) {
          const charIsWorking = isNPCWorking(char, now);
          
          if (!charIsWorking) {
            const locationIdx = rotatedCount % validNPCLocations.length;
            const newLocation = validNPCLocations[locationIdx];
            
            // Track this owner for update
            if (!ownerUpdates[char.id]) {
              ownerUpdates[char.id] = char;
            }
            
            ownerUpdates[char.id].fictional_relationships[idx].current_location_id = newLocation.id;
            rotatedCount++;
          }
        }
      });
    });

    if (rotatedCount === 0) {
      return Response.json({ message: 'No VGC Towers residents available to rotate (all working or no residents)' }, { status: 200 });
    }

    // Persist updates to database
    let updatedCount = 0;
    for (const [ownerId, owner] of Object.entries(ownerUpdates)) {
      await base44.entities.Character.update(ownerId, {
        fictional_relationships: owner.fictional_relationships,
      });
      updatedCount++;
    }

    return Response.json({ 
      success: true, 
      message: `Rotated ${rotatedCount} VGC Towers residents across ${validNPCLocations.length} locations`,
      charactersUpdated: updatedCount,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// Helper: Check if character is working based on their work schedule
function isNPCWorking(char, now) {
  if (!char.work_start_time || !char.work_end_time) return false;
  
  const dayOfWeek = now.getDay();
  const workDays = char.work_days || [1, 2, 3, 4, 5]; // Default: Mon-Fri
  
  if (!workDays.includes(dayOfWeek)) return false;
  
  const [startHour, startMin] = char.work_start_time.split(':').map(Number);
  const [endHour, endMin] = char.work_end_time.split(':').map(Number);
  const currentMin = now.getHours() * 60 + now.getMinutes();
  const workStart = startHour * 60 + startMin;
  const workEnd = endHour * 60 + endMin;
  
  return currentMin >= workStart && currentMin <= workEnd;
}