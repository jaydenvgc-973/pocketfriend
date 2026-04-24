import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Trace Image Generation Truth Source
 * 
 * This function traces exactly where each data point comes from during image generation:
 * - Character avatars (which field?)
 * - Family member avatars (where are they stored?)
 * - Location/zone images (which zone? which location?)
 * - Who's selected vs who's actually rendered
 * - Age/identity enforcement (is it happening?)
 */

async function traceCharacterAvatarSource(character) {
  const sources = {
    avatar_url: character.avatar_url || null,
    image_avatar_url: character.image_avatar_url || null,
    reference_image_urls: character.reference_image_urls || [],
    generated_avatar_urls: character.generated_avatar_urls || [],
  };

  // Determine primary avatar source
  let primary = null;
  if (character.avatar_url) {
    primary = { source: 'avatar_url', value: character.avatar_url };
  } else if (character.image_avatar_url) {
    primary = { source: 'image_avatar_url', value: character.image_avatar_url };
  } else if (character.reference_image_urls?.length > 0) {
    primary = { source: 'reference_image_urls[0]', value: character.reference_image_urls[0] };
  } else if (character.generated_avatar_urls?.length > 0) {
    primary = { source: 'generated_avatar_urls[0]', value: character.generated_avatar_urls[0] };
  }

  return {
    characterId: character.id,
    characterName: character.name,
    characterType: character.character_type,
    sources,
    primaryAvatarSource: primary,
    hasAvatar: !!primary,
    age: character.age,
  };
}

async function traceFamilyMemberAvatarSource(familyMember, sourceCharacter) {
  // Family members can have avatars in multiple places:
  // 1. family_members array on the character
  // 2. fictional_relationships array (if linked)

  const sources = {
    family_members_photo_url: familyMember.photo_url || null,
    fictional_relationships_avatar: null, // Would need to look up
  };

  // If we have the source character, check their family_members array
  let familyRecord = null;
  if (sourceCharacter && sourceCharacter.family_members) {
    familyRecord = sourceCharacter.family_members.find(fm => 
      fm.name?.trim().toLowerCase() === familyMember.name?.trim().toLowerCase()
    );
  }

  return {
    familyMemberName: familyMember.name,
    sourceCharacterName: sourceCharacter?.name,
    photo_url: familyRecord?.photo_url || familyMember.photo_url || null,
    relationship_type: familyMember.relationship_type,
    hasAvatar: !!(familyRecord?.photo_url || familyMember.photo_url),
  };
}

async function traceZoneImageSource(location, selectedZoneName) {
  const zones = location.zones || [];
  
  // Find the selected zone
  const selectedZone = zones.find(z => z.zone_name === selectedZoneName) || zones[0];
  
  if (!selectedZone) {
    return {
      error: 'NO_ZONE_FOUND',
      locationName: location.name,
      selectedZoneName,
      availableZones: zones.map(z => z.zone_name),
    };
  }

  // Check all image sources (active zone first, then other zones, then location default)
  const sources = {
    selectedZoneImages: selectedZone?.image_urls || [],
    otherZoneImages: zones
      .filter(z => z.zone_name !== selectedZoneName)
      .flatMap(z => z.image_urls || []),
    locationDefaultImages: location.image_urls || [],
  };

  return {
    locationName: location.name,
    selectedZone: selectedZoneName,
    sources,
    primaryZoneImageCount: sources.selectedZoneImages.length,
    hasZoneImages: sources.selectedZoneImages.length > 0,
    crossZoneContamination: sources.selectedZoneImages.length === 0 && sources.otherZoneImages.length > 0,
  };
}

Deno.serve(async (req) => {
  const body = await req.json();
  const { characterId, locationId, selectedZone } = body;

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`TRACE: Image Generation Truth Source`);
    console.log(`Character: ${characterId} | Location: ${locationId} | Zone: ${selectedZone}`);
    console.log(`${'='.repeat(80)}\n`);

    const results = {
      character: null,
      familyMembers: [],
      location: null,
      zoneImages: null,
    };

    // Trace character avatar source
    if (characterId) {
      const character = await base44.entities.Character.filter({ 
        created_by: user.email, 
        id: characterId 
      });
      if (character.length > 0) {
        results.character = await traceCharacterAvatarSource(character[0]);
        console.log(`✅ CHARACTER AVATAR SOURCE`);
        console.log(`   Name: ${character[0].name}`);
        console.log(`   Primary Source: ${results.character.primaryAvatarSource?.source || 'NONE'}`);
        console.log(`   Age: ${character[0].age || 'UNSET'}`);

        // Trace family members if this character has them
        if (character[0].family_members?.length > 0) {
          console.log(`\n✅ FAMILY MEMBER AVATAR SOURCES`);
          for (const fm of character[0].family_members) {
            const fmTrace = await traceFamilyMemberAvatarSource(fm, character[0]);
            results.familyMembers.push(fmTrace);
            console.log(`   ${fm.name}: ${fmTrace.photo_url ? '✅ HAS AVATAR' : '❌ NO AVATAR'}`);
          }
        }
      }
    }

    // Trace zone image source
    if (locationId) {
      const location = await base44.entities.LocationReference.filter({ 
        created_by: user.email, 
        id: locationId 
      });
      if (location.length > 0) {
        results.location = location[0];
        results.zoneImages = await traceZoneImageSource(location[0], selectedZone || 'Kitchen');
        
        console.log(`\n✅ ZONE IMAGE SOURCE`);
        console.log(`   Location: ${location[0].name}`);
        console.log(`   Selected Zone: ${selectedZone || 'Kitchen'}`);
        console.log(`   Zone Images Available: ${results.zoneImages.primaryZoneImageCount}`);
        console.log(`   Cross-Zone Contamination: ${results.zoneImages.crossZoneContamination ? '⚠️ YES' : '✅ NO'}`);
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`TRACE COMPLETE`);
    console.log(`${'='.repeat(80)}\n`);

    return Response.json(results);
  } catch (error) {
    console.error('Trace failed:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});