import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * REBUILD: Character Home Assignments
 * 
 * Rebuilds correct home location assignments for all characters.
 * Identifies characters with wrong homes and reassigns them to their actual residence.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter(
      { created_by: user.email },
      "-updated_date"
    );
    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const report = {
      charactersProcessed: 0,
      homeAssignmentsFixed: 0,
      fixes: []
    };

    for (const char of characters) {
      if (char.status === 'deleted') continue;
      report.charactersProcessed++;

      const currentHome = locationMap[char.current_home_location_id];
      
      // Determine correct home for this character
      let correctHome = null;

      // 1. Check if character is explicitly listed as resident in a home
      const homeAsResident = locations.find(l => 
        l.resident_character_ids?.includes(char.id) && l.category === 'home'
      );
      if (homeAsResident) {
        correctHome = homeAsResident;
      }

      // 2. Check if character is listed as a family member in a home
      if (!correctHome) {
        const homeAsFamilyMember = locations.find(l => 
          l.resident_family_members?.some(m => m.name.toLowerCase() === char.name.toLowerCase()) &&
          l.category === 'home'
        );
        if (homeAsFamilyMember) {
          correctHome = homeAsFamilyMember;
        }
      }

      // 3. Check if character is related to another character who lives somewhere
      if (!correctHome && char.family_members && char.family_members.length > 0) {
        for (const familyMember of char.family_members) {
          const relatedChar = characters.find(c => 
            c.name.toLowerCase() === familyMember.name.toLowerCase()
          );
          if (relatedChar && relatedChar.current_home_location_id) {
            const relatedHome = locationMap[relatedChar.current_home_location_id];
            if (relatedHome && relatedHome.category === 'home') {
              correctHome = relatedHome;
              break;
            }
          }
        }
      }

      // 4. If character-specific location exists for them, use it
      if (!correctHome) {
        const characterSpecific = locations.find(l => 
          l.location_type === 'character_specific' && 
          l.character_id === char.id
        );
        if (characterSpecific) {
          correctHome = characterSpecific;
        }
      }

      // 5. If still no home, assign them to a generic available home (but NOT Matt Lopez's)
      if (!correctHome) {
        const availableHome = locations.find(l => 
          l.category === 'home' && 
          l.name?.toLowerCase() !== 'matt lopez' &&
          !l.name?.toLowerCase().includes('matt') &&
          l.location_type !== 'character_specific'
        );
        if (availableHome) {
          correctHome = availableHome;
        }
      }

      // If current home is wrong, fix it
      if (correctHome && correctHome.id !== char.current_home_location_id) {
        await base44.entities.Character.update(char.id, {
          current_home_location_id: correctHome.id
        });

        report.homeAssignmentsFixed++;
        report.fixes.push({
          characterId: char.id,
          characterName: char.name,
          oldHomeId: char.current_home_location_id,
          oldHomeName: currentHome?.name || 'Unknown',
          newHomeId: correctHome.id,
          newHomeName: correctHome.name,
          reason: 'CORRECTED_FROM_INVALID_HOME'
        });
      }
    }

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});