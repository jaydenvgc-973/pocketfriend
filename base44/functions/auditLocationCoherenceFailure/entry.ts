import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * AUDIT LOCATION COHERENCE FAILURE
 * 
 * For each active character, verify all three location systems match:
 * 1. CHARACTER CARD (what card display shows)
 * 2. TRAVEL POPUP (what Travel page location list shows)
 * 3. PLACE OCCUPANCY (what location occupants registry shows)
 * 
 * If all three don't match, the location system is broken.
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

    const audit = {
      totalCharactersAudited: 0,
      coherenceFailures: [],
      coherencePasses: [],
      issues: {
        cardShowsGenericNotNamed: [],
        travelPopupMissesCharacter: [],
        occupancyNotRegistered: [],
        multiplePresenceRegistrations: [],
        cardTravelMismatch: [],
        cardOccupancyMismatch: [],
        travelOccupancyMismatch: []
      }
    };

    for (const char of characters) {
      if (char.status === 'deleted') continue;
      audit.totalCharactersAudited++;

      // 1. CARD TRUTH — what should the card display?
      const cardLocation = getCardLocationTruth(char, locationMap);

      // 2. TRAVEL POPUP TRUTH — is character registered in this location's occupancy?
      const travelPopupPresence = getLocationPopulationTruth(char, locations);

      // 3. PLACE OCCUPANCY TRUTH — is character in the actual place occupants list?
      const occupancyRegistered = isCharacterInLocationOccupancy(char, locationMap);

      const coherent = 
        cardLocation.id === travelPopupPresence.id &&
        travelPopupPresence.id === occupancyRegistered.id &&
        cardLocation.id !== null;

      if (coherent) {
        audit.coherencePasses.push({
          characterId: char.id,
          characterName: char.name,
          unifiedLocation: cardLocation.name,
          locationId: cardLocation.id
        });
      } else {
        const failure = {
          characterId: char.id,
          characterName: char.name,
          currentLocationId: char.current_location_id,
          currentHomeLocationId: char.current_home_location_id,
          card: {
            locationId: cardLocation.id,
            locationName: cardLocation.name,
            displayLabel: cardLocation.displayLabel,
            source: cardLocation.source
          },
          travelPopup: {
            locationId: travelPopupPresence.id,
            locationName: travelPopupPresence.name,
            isRegistered: travelPopupPresence.isRegistered,
            source: travelPopupPresence.source
          },
          occupancy: {
            locationId: occupancyRegistered.id,
            locationName: occupancyRegistered.name,
            isInList: occupancyRegistered.isInList,
            source: occupancyRegistered.source
          },
          mismatchType: identifyMismatchType(cardLocation, travelPopupPresence, occupancyRegistered)
        };

        audit.coherenceFailures.push(failure);

        // Categorize the specific failure
        if (cardLocation.displayLabel === 'generic' && cardLocation.id !== travelPopupPresence.id) {
          audit.issues.cardShowsGenericNotNamed.push(char.name);
        }
        if (!travelPopupPresence.isRegistered) {
          audit.issues.travelPopupMissesCharacter.push(char.name);
        }
        if (!occupancyRegistered.isInList) {
          audit.issues.occupancyNotRegistered.push(char.name);
        }
        if (cardLocation.id !== travelPopupPresence.id) {
          audit.issues.cardTravelMismatch.push(`${char.name}: card=${cardLocation.id} travel=${travelPopupPresence.id}`);
        }
        if (cardLocation.id !== occupancyRegistered.id) {
          audit.issues.cardOccupancyMismatch.push(`${char.name}: card=${cardLocation.id} occupancy=${occupancyRegistered.id}`);
        }
        if (travelPopupPresence.id !== occupancyRegistered.id) {
          audit.issues.travelOccupancyMismatch.push(`${char.name}: travel=${travelPopupPresence.id} occupancy=${occupancyRegistered.id}`);
        }
      }
    }

    return Response.json(audit);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function getCardLocationTruth(character, locationMap) {
  // What SHOULD the card display?
  // This is the "card truth" source
  
  const currentLoc = locationMap[character.current_location_id];
  if (currentLoc && currentLoc.name) {
    return {
      id: currentLoc.id,
      name: currentLoc.name,
      displayLabel: 'named',
      source: 'current_location_id'
    };
  }

  const homeLoc = locationMap[character.current_home_location_id];
  if (homeLoc && homeLoc.name) {
    return {
      id: homeLoc.id,
      name: homeLoc.name,
      displayLabel: 'named',
      source: 'current_home_location_id'
    };
  }

  return {
    id: null,
    name: 'Unknown',
    displayLabel: 'generic',
    source: 'none'
  };
}

function getLocationPopulationTruth(character, locations) {
  // Is the character actually registered in the location's occupancy?
  
  const currentLoc = locations.find(l => l.id === character.current_location_id);
  if (currentLoc) {
    const isInResidents = currentLoc.resident_character_ids?.includes(character.id);
    const isInWorkers = currentLoc.worker_character_ids?.includes(character.id);
    const isInFamily = currentLoc.resident_family_members?.some(m => 
      m.name.toLowerCase() === character.name.toLowerCase()
    );

    return {
      id: currentLoc.id,
      name: currentLoc.name,
      isRegistered: isInResidents || isInWorkers || isInFamily,
      source: 'location_occupancy_lists'
    };
  }

  return {
    id: null,
    name: 'Unknown',
    isRegistered: false,
    source: 'none'
  };
}

function isCharacterInLocationOccupancy(character, locationMap) {
  // Check if character is actually listed in any location's occupancy
  
  const loc = locationMap[character.current_location_id];
  if (!loc) {
    return {
      id: null,
      name: 'Unknown',
      isInList: false,
      source: 'none'
    };
  }

  const inResidents = loc.resident_character_ids?.includes(character.id);
  const inWorkers = loc.worker_character_ids?.includes(character.id);
  const inFamily = loc.resident_family_members?.some(m => 
    m.name.toLowerCase() === character.name.toLowerCase()
  );

  return {
    id: loc.id,
    name: loc.name,
    isInList: inResidents || inWorkers || inFamily,
    source: 'location_occupancy'
  };
}

function identifyMismatchType(cardLoc, travelLoc, occupancyLoc) {
  const types = [];
  
  if (cardLoc.id !== travelLoc.id) types.push('CARD_VS_TRAVEL');
  if (cardLoc.id !== occupancyLoc.id) types.push('CARD_VS_OCCUPANCY');
  if (travelLoc.id !== occupancyLoc.id) types.push('TRAVEL_VS_OCCUPANCY');
  if (!travelLoc.isRegistered) types.push('NOT_REGISTERED_IN_LOCATION');
  if (!occupancyLoc.isInList) types.push('NOT_IN_OCCUPANCY_LIST');
  
  return types.join(' + ');
}