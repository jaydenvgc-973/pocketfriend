import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * restoreDeletedCharacterHomes
 * 
 * Recovers character homes that were mistakenly deleted by the system
 * when it was trying to remove unwanted generic locations.
 * 
 * These homes are valid, intended residences that should never have been removed.
 * Restoration is treated as correction of system error.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Characters whose homes were wrongly deleted
    const targetCharacterNames = [
      'Ethan', 'Nathan', 'James', 'Jonathan', 'Lila', 'Brian', 'Andre', 'Melody', 'Matt'
    ];

    // Fetch all characters for this user
    const allCharacters = await base44.asServiceRole.entities.Character.filter({
      created_by: user.email
    });

    // Map characters by name
    const charsByName = {};
    allCharacters.forEach(char => {
      charsByName[char.name?.toLowerCase()] = char;
    });

    // Fetch all existing locations
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter({
      created_by: user.email
    });

    const restored = [];
    const created = [];
    const alreadyHasHome = [];

    // For each target character, restore or create their home
    for (const charName of targetCharacterNames) {
      const character = charsByName[charName.toLowerCase()];
      
      if (!character) {
        console.log(`[restoreDeletedCharacterHomes] Character not found: ${charName}`);
        continue;
      }

      // Check if character already has a home
      if (character.home_location_id) {
        const existingHome = allLocations.find(l => l.id === character.home_location_id);
        if (existingHome) {
          alreadyHasHome.push({ character: charName, homeId: character.home_location_id, homeName: existingHome.name });
          continue;
        }
      }

      // Check if a home for this character already exists (even if not linked)
      const existingHome = allLocations.find(l => 
        (l.resident_character_ids?.includes(character.id) && l.category === 'home') ||
        (l.character_id === character.id && l.category === 'home')
      );

      if (existingHome) {
        // Home exists but isn't linked — link it
        await base44.asServiceRole.entities.Character.update(character.id, {
          home_location_id: existingHome.id
        });
        restored.push({
          character: charName,
          homeId: existingHome.id,
          homeName: existingHome.name,
          action: 'linked_existing',
        });
        continue;
      }

      // No home found — create new home for this character
      const homeName = `${charName}'s Home`;
      const newHome = await base44.asServiceRole.entities.LocationReference.create({
        name: homeName,
        location_type: 'character_specific',
        category: 'home',
        character_id: character.id,
        character_name: charName,
        resident_character_ids: [character.id],
        resident_character_names: [charName],
        description: `${charName}'s residence (restored after system deletion error)`,
        zones: [
          { zone_name: 'Living Room', image_urls: [] },
          { zone_name: 'Bedroom', image_urls: [] },
          { zone_name: 'Kitchen', image_urls: [] },
          { zone_name: 'Bathroom', image_urls: [] },
        ],
        bedroom_count: 1,
        rent_or_housing_cost: 1200,
        utility_costs: { electricity: 80, water: 40, gas: 50, internet: 60, other: 0 },
      });

      // Link home to character
      await base44.asServiceRole.entities.Character.update(character.id, {
        home_location_id: newHome.id
      });

      created.push({
        character: charName,
        homeId: newHome.id,
        homeName: homeName,
        action: 'created_new',
      });
    }

    // Verify all target characters now have homes
    const updatedChars = await base44.asServiceRole.entities.Character.filter({
      created_by: user.email
    });

    const verification = [];
    for (const charName of targetCharacterNames) {
      const char = updatedChars.find(c => c.name?.toLowerCase() === charName.toLowerCase());
      if (char) {
        verification.push({
          character: charName,
          hasHome: !!char.home_location_id,
          homeId: char.home_location_id,
        });
      }
    }

    return Response.json({
      success: true,
      restored: restored.length,
      created: created.length,
      alreadyHasHome: alreadyHasHome.length,
      restoreDetails: {
        linked: restored,
        created: created,
        alreadyHad: alreadyHasHome,
      },
      verification,
      summary: `Restored homes for ${targetCharacterNames.length} characters: ${restored.length} linked, ${created.length} newly created, ${alreadyHasHome.length} already had homes.`,
    });
  } catch (error) {
    console.error('[restoreDeletedCharacterHomes]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});