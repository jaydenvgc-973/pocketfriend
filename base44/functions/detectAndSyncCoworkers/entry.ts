import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Detects coworkers who share work locations and schedules.
 * Creates or updates fictional_relationships with work-specific context.
 * Runs periodically (scheduled automation).
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Fetch all active characters
    const characters = await base44.entities.Character.filter({ status: "active" });
    
    // Group by work location
    const locationMap = {};
    characters.forEach(char => {
      if (!char.occupation_location_id) return;
      const locId = char.occupation_location_id;
      if (!locationMap[locId]) locationMap[locId] = [];
      locationMap[locId].push(char);
    });
    
    let relationshipsCreated = 0;
    let relationshipsUpdated = 0;
    
    // For each location, find coworkers with overlapping shifts
    for (const [locationId, coworkers] of Object.entries(locationMap)) {
      if (coworkers.length < 2) continue; // Need at least 2 people at a location
      
      // Check all pairs for shift overlap
      for (let i = 0; i < coworkers.length; i++) {
        for (let j = i + 1; j < coworkers.length; j++) {
          const char1 = coworkers[i];
          const char2 = coworkers[j];
          
          // Check if they have overlapping work days
          const days1 = new Set(char1.work_days || []);
          const days2 = new Set(char2.work_days || []);
          const overlap = [...days1].some(d => days2.has(d));
          
          if (!overlap) continue; // No overlapping work days
          
          // They're coworkers — create/update bidirectional relationships
          await syncCoworkerRelationship(base44, char1, char2, locationId);
          await syncCoworkerRelationship(base44, char2, char1, locationId);
          
          relationshipsUpdated += 2;
        }
      }
    }
    
    return Response.json({
      success: true,
      relationshipsUpdated,
      locationsChecked: Object.keys(locationMap).length,
    });
  } catch (error) {
    console.error('Coworker sync failed:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Creates or updates a relationship between two coworkers.
 * Increments respect & friendship based on shared work.
 */
async function syncCoworkerRelationship(base44, sourceChar, targetChar, locationId) {
  const relationships = sourceChar.fictional_relationships || [];
  
  // Check if relationship already exists
  let existing = relationships.find(r => r.related_character_id === targetChar.id);
  
  if (existing) {
    // Update existing relationship — increment respect & friendship
    const newRespect = Math.min(100, (existing.respect_level || 50) + 2);
    const newFriendship = Math.min(100, (existing.friendship_level || 50) + 1);
    
    existing.respect_level = newRespect;
    existing.friendship_level = newFriendship;
    existing.shared_work_locations = [...new Set([...(existing.shared_work_locations || []), locationId])];
    
    // Update the description with work context
    if (!existing.description || !existing.description.includes('coworker')) {
      existing.description = `We work together at ${existing.work_location_name || 'the same place'}. The more time we spend working together, the better we understand each other.`;
    }
  } else {
    // Create new coworker relationship
    existing = {
      related_character_id: targetChar.id,
      person_name: targetChar.name,
      relationship_type: "Co-worker",
      description: `We work together. The more shifts we share, the more we'll know about each other.`,
      respect_level: 50,
      friendship_level: 50,
      romantic_level: 0,
      attraction_level: 0,
      chosen_family_level: 0,
      work_location_id: locationId,
      shared_work_locations: [locationId],
      avatar_url: targetChar.avatar_url || null,
    };
    relationships.push(existing);
  }
  
  // Update source character
  await base44.entities.Character.update(sourceChar.id, {
    fictional_relationships: relationships
  }).catch(err => {
    console.error(`Failed to update ${sourceChar.name}'s relationships:`, err);
  });
}