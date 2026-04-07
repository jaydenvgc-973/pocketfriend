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
    const characters = await base44.entities.Character.filter({ 
      created_by: user.email, 
      status: 'active' 
    });

    const npcUpdateMap = {}; // { characterId: [{ relationshipIdx, newLocationId }] }
    let rotatedCount = 0;

    // Process each character's NPCs
    characters.forEach(char => {
      if (!char.fictional_relationships) return;
      
      char.fictional_relationships.forEach((rel, idx) => {
        if (!rel.related_character_id && rel.person_name) {
          // Check if this NPC is working right now
          const npcIsWorking = isNPCWorking(char, rel, now);
          
          if (npcIsWorking) {
            // Skip rotation if NPC is on shift (work schedule takes priority)
            return;
          }

          // Assign to a location in round-robin fashion
          const locationIdx = rotatedCount % validNPCLocations.length;
          const newLocation = validNPCLocations[locationIdx];
          
          if (!npcUpdateMap[char.id]) {
            npcUpdateMap[char.id] = [];
          }
          npcUpdateMap[char.id].push({
            relationshipIdx: idx,
            newLocationId: newLocation.id,
          });
          rotatedCount++;
        }
      });
    });

    if (rotatedCount === 0) {
      return Response.json({ message: 'No NPCs available to rotate (all working or no NPCs)' }, { status: 200 });
    }

    // Update characters with new NPC locations
    let updatedCount = 0;
    for (const [charId, updates] of Object.entries(npcUpdateMap)) {
      const char = characters.find(c => c.id === charId);
      if (!char || !char.fictional_relationships) continue;

      updates.forEach(upd => {
        if (char.fictional_relationships[upd.relationshipIdx]) {
          char.fictional_relationships[upd.relationshipIdx].current_location_id = upd.newLocationId;
        }
      });

      await base44.entities.Character.update(charId, {
        fictional_relationships: char.fictional_relationships,
      });
      updatedCount++;
    }

    return Response.json({ 
      success: true, 
      message: `Rotated ${rotatedCount} NPCs across ${validNPCLocations.length} locations`,
      charactersUpdated: updatedCount,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// Helper: Check if NPC is working based on owner's work schedule
function isNPCWorking(ownerChar, npcRelationship, now) {
  if (!ownerChar.work_start_time || !ownerChar.work_end_time) return false;
  
  const dayOfWeek = now.getDay();
  const workDays = ownerChar.work_days || [1, 2, 3, 4, 5]; // Default: Mon-Fri
  
  if (!workDays.includes(dayOfWeek)) return false;
  
  const [startHour, startMin] = ownerChar.work_start_time.split(':').map(Number);
  const [endHour, endMin] = ownerChar.work_end_time.split(':').map(Number);
  const currentMin = now.getHours() * 60 + now.getMinutes();
  const workStart = startHour * 60 + startMin;
  const workEnd = endHour * 60 + endMin;
  
  return currentMin >= workStart && currentMin <= workEnd;
}