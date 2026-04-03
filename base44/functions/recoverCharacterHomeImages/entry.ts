import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * recoverCharacterHomeImages
 * 
 * Recovers image URLs from deleted home location records
 * for Ethan, Matt, and Nathan.
 * 
 * Searches through all location records (including soft-deleted)
 * to find image URLs that were attached to their homes,
 * then restores those images to the recovered home locations.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const targetCharacterNames = ['Ethan', 'Matt', 'Nathan'];

    // Fetch all characters
    const allCharacters = await base44.asServiceRole.entities.Character.filter({
      created_by: user.email
    });

    const charsByName = {};
    allCharacters.forEach(char => {
      charsByName[char.name?.toLowerCase()] = char;
    });

    // Fetch all locations (including soft-deleted)
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter({
      created_by: user.email
    });

    // Also try to search for deleted/archived locations by searching broadly
    // Look for any location records that might have these characters' names in them
    const imageRecovery = {};

    for (const charName of targetCharacterNames) {
      const character = charsByName[charName.toLowerCase()];
      if (!character) continue;

      imageRecovery[charName] = {
        characterId: character.id,
        characterName: charName,
        recoveredZones: [],
        imagesToRestore: [],
      };

      // Search all locations for ones that might belong to this character
      for (const location of allLocations) {
        // Check if location is connected to this character
        const isCharHome = 
          location.character_id === character.id ||
          location.resident_character_ids?.includes(character.id) ||
          location.owner_character_id === character.id ||
          location.character_name?.toLowerCase() === charName.toLowerCase() ||
          location.name?.toLowerCase().includes(charName.toLowerCase()) ||
          location.owner_character_name?.toLowerCase() === charName.toLowerCase();

        if (isCharHome && location.category === 'home' && location.zones?.length > 0) {
          // Found location with zones and images
          for (const zone of location.zones) {
            if (zone.image_urls?.length > 0) {
              imageRecovery[charName].recoveredZones.push({
                zoneName: zone.zone_name,
                imageCount: zone.image_urls.length,
                images: zone.image_urls,
              });
              imageRecovery[charName].imagesToRestore.push(...zone.image_urls);
            }
          }
        }
      }
    }

    // Now restore the recovered images to the characters' current homes
    const restored = [];

    for (const charName of targetCharacterNames) {
      const character = charsByName[charName.toLowerCase()];
      if (!character || !character.home_location_id) continue;

      const recovery = imageRecovery[charName];
      if (recovery.imagesToRestore.length === 0) continue;

      // Fetch the home location
      const homeLocations = await base44.asServiceRole.entities.LocationReference.filter({
        id: character.home_location_id
      });
      
      if (homeLocations.length === 0) continue;
      const home = homeLocations[0];

      // Restore images to zones
      const updatedZones = (home.zones || []).map(zone => {
        // If this zone didn't have images, add them
        if (!zone.image_urls?.length) {
          // Assign images from recovered zones with matching or similar names
          const matchingRecoveredZone = recovery.recoveredZones.find(rz => 
            rz.zoneName.toLowerCase() === zone.zone_name.toLowerCase()
          );
          
          if (matchingRecoveredZone) {
            return {
              ...zone,
              image_urls: matchingRecoveredZone.images,
            };
          }
        }
        return zone;
      });

      // If we still have unassigned images, distribute them to empty zones
      const assignedImages = new Set();
      updatedZones.forEach(z => {
        (z.image_urls || []).forEach(img => assignedImages.add(img));
      });

      const unassignedImages = recovery.imagesToRestore.filter(img => !assignedImages.has(img));
      
      if (unassignedImages.length > 0) {
        // Find zones without images and add them
        for (let i = 0; i < updatedZones.length && unassignedImages.length > 0; i++) {
          if (!updatedZones[i].image_urls?.length) {
            updatedZones[i].image_urls = [unassignedImages.shift()];
          }
        }
      }

      // Update the home location with restored images
      await base44.asServiceRole.entities.LocationReference.update(home.id, {
        zones: updatedZones
      });

      restored.push({
        character: charName,
        homeId: home.id,
        homeName: home.name,
        imagesRestored: recovery.imagesToRestore.length,
        zonesUpdated: recovery.recoveredZones.length,
      });
    }

    return Response.json({
      success: true,
      recovered: imageRecovery,
      restored,
      summary: `Recovered and restored images for ${restored.length} character homes: ${restored.map(r => `${r.character} (${r.imagesRestored} images)`).join(', ')}`,
    });
  } catch (error) {
    console.error('[recoverCharacterHomeImages]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});