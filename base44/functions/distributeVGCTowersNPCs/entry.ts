import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all VGC Towers NPCs (family members and fictitious relationships)
    const characters = await base44.entities.Character.filter({ created_by: user.email, status: 'active' });
    
    // Get all locations
    const locations = await base44.entities.LocationReference.list();
    
    // Get VGC Towers location to identify which NPCs live there
    const vgcTowers = locations.find(l => l.name === 'VGC Towers');
    if (!vgcTowers) {
      return Response.json({ error: 'VGC Towers location not found' }, { status: 400 });
    }

    // Identify VGC Towers NPCs (family members at VGC Towers)
    const vgcTowersNPCs = [];
    characters.forEach(char => {
      if (char.current_home_location_id === vgcTowers.id) {
        // This character lives at VGC Towers
        // Check if they have family members who are NPCs
        if (char.family_members && Array.isArray(char.family_members)) {
          char.family_members.forEach(fm => {
            if (fm.name) {
              vgcTowersNPCs.push({
                name: fm.name,
                sourceCharacterId: char.id,
                age: fm.age_at_creation,
                type: 'family_member'
              });
            }
          });
        }
        // Also check fictional relationships for NPCs at VGC Towers
        if (char.fictional_relationships && Array.isArray(char.fictional_relationships)) {
          char.fictional_relationships.forEach(rel => {
            if (!rel.related_character_id && rel.person_name) {
              // This is an unlinked NPC
              vgcTowersNPCs.push({
                name: rel.person_name,
                sourceCharacterId: char.id,
                age: null,
                type: 'npc_fictitious'
              });
            }
          });
        }
      }
    });

    if (vgcTowersNPCs.length === 0) {
      return Response.json({ 
        success: true, 
        message: 'No VGC Towers NPCs to distribute',
        distributed: 0
      });
    }

    // Get current time
    const now = new Date();
    const hour = now.getHours();
    const isMovementWindow = hour >= 10 && hour < 25; // 10 AM to 1 AM

    if (!isMovementWindow) {
      return Response.json({ 
        success: true, 
        message: 'Outside movement window (10 AM - 1 AM)',
        distributed: 0
      });
    }

    // Get valid locations for distribution (exclude VGC Towers and closed locations)
    const validLocations = locations.filter(loc => {
      if (loc.id === vgcTowers.id) return false;
      if (loc.location_type === 'character_specific') return false;
      
      // Check if location is open
      const isClosed = isLocationClosed(loc, now);
      return !isClosed;
    });

    if (validLocations.length === 0) {
      return Response.json({ 
        success: true, 
        message: 'No valid locations available',
        distributed: 0
      });
    }

    // Separate NPCs: 3 stay at VGC Towers, rest get distributed
    const stayAtHome = vgcTowersNPCs.slice(0, 3);
    const toDistribute = vgcTowersNPCs.slice(3);

    const distribution = [];

    // Distribute remaining NPCs to valid locations
    for (let i = 0; i < toDistribute.length; i++) {
      const npc = toDistribute[i];
      
      // Filter locations based on age
      const ageAppropriateLocations = validLocations.filter(loc => {
        // If no age, allow all locations
        if (!npc.age) return true;
        
        // Under 21: exclude bars and clubs
        if (npc.age < 21) {
          const barClubKeywords = ['bar', 'club', 'lounge', 'pub', 'tavern'];
          const nameLC = loc.name.toLowerCase();
          return !barClubKeywords.some(kw => nameLC.includes(kw));
        }
        
        return true;
      });

      if (ageAppropriateLocations.length === 0) continue;

      // Pick a random location for this NPC
      const selectedLocation = ageAppropriateLocations[i % ageAppropriateLocations.length];
      
      distribution.push({
        npcName: npc.name,
        sourceCharacterId: npc.sourceCharacterId,
        locationId: selectedLocation.id,
        locationName: selectedLocation.name,
        type: npc.type
      });
    }

    // Persist location changes to database
    for (const dist of distribution) {
      try {
        const sourceChar = characters.find(c => c.id === dist.sourceCharacterId);
        if (!sourceChar) continue;

        // Update fictional_relationships with new location for the NPC
        const updatedRels = (sourceChar.fictional_relationships || []).map(rel => {
          if (rel.person_name === dist.npcName && !rel.related_character_id) {
            return {
              ...rel,
              current_location_id: dist.locationId,
              current_location_name: dist.locationName,
              last_location_update_time: now.toISOString()
            };
          }
          return rel;
        });

        await base44.entities.Character.update(dist.sourceCharacterId, {
          fictional_relationships: updatedRels
        });
      } catch (err) {
        console.error(`Failed to update NPC location for ${dist.npcName}:`, err);
      }
    }

    // Log the distribution for debugging
    const result = {
      success: true,
      timestamp: now.toISOString(),
      totalVGCTowersNPCs: vgcTowersNPCs.length,
      stayingAtHome: stayAtHome.length,
      distributed: distribution.length,
      distribution: distribution,
      persisted: true
    };

    return Response.json(result);

  } catch (error) {
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});

/**
 * Check if a location is currently closed
 */
function isLocationClosed(location, currentTime = new Date()) {
  if (!location.operating_hours || location.operating_hours.length === 0) {
    return false; // Assume open if no hours defined
  }

  const dayOfWeek = currentTime.getDay();
  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

  const todayEntries = location.operating_hours.filter(h => h.day_of_week === dayOfWeek);
  const dayAgnosticEntries = location.operating_hours.filter(h => h.day_of_week == null);

  // Check day-specific hours first
  if (todayEntries.length > 0) {
    return !todayEntries.some(h => isInWindow(currentMinutes, h.open_time, h.close_time));
  }

  // Check day-agnostic hours
  if (dayAgnosticEntries.length > 0) {
    return !dayAgnosticEntries.some(h => isInWindow(currentMinutes, h.open_time, h.close_time));
  }

  // If specific day exists but no hours, location is closed
  if (location.operating_hours.some(h => h.day_of_week != null)) {
    return true;
  }

  return false;
}

/**
 * Check if a time falls within a window
 */
function isInWindow(currentMinutes, openStr, closeStr) {
  if (!openStr || !closeStr) return false;
  
  const [openH, openM] = openStr.split(':').map(Number);
  const [closeH, closeM] = closeStr.split(':').map(Number);
  
  const openMin = openH * 60 + openM;
  const closeMin = closeH * 60 + closeM;

  if (openMin <= closeMin) {
    return currentMinutes >= openMin && currentMinutes <= closeMin;
  }
  
  // Overnight window
  return currentMinutes >= openMin || currentMinutes <= closeMin;
}