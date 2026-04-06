import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * VERIFY MELODY LOCATION COHESION
 * 
 * Tests the three critical systems together:
 * 1. CARD DISPLAY — does card show "at VGC Gym"?
 * 2. TRAVEL POPUP — would VGC Gym popup include Melody?
 * 3. OCCUPANCY REGISTRY — is Melody in VGC Gym's resident list?
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter({ created_by: user.email }, "-updated_date");
    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const melody = characters.find(c => c.name === 'Melody Jackson Perry');
    if (!melody) {
      return Response.json({ error: 'Melody not found' }, { status: 404 });
    }

    // === LAYER 1: CARD DISPLAY ===
    let cardLabel = 'available';
    let cardIcon = 'calm';
    
    if (melody.occupation_location_id && locationMap[melody.occupation_location_id]) {
      const workLoc = locationMap[melody.occupation_location_id];
      cardLabel = `at ${workLoc.name}`;
      cardIcon = 'work';
    } else if (melody.education_location_id && locationMap[melody.education_location_id]) {
      const eduLoc = locationMap[melody.education_location_id];
      cardLabel = `at ${eduLoc.name}`;
      cardIcon = 'school';
    } else if (melody.current_home_location_id && locationMap[melody.current_home_location_id]) {
      const homeLoc = locationMap[melody.current_home_location_id];
      cardLabel = `at ${homeLoc.name}`;
      cardIcon = 'home';
    }

    // === LAYER 2: TRAVEL POPUP ===
    let wouldAppearInPopup = false;
    let melodyLocationInPopup = null;

    if (melody.occupation_location_id && locationMap[melody.occupation_location_id]) {
      const workLoc = locationMap[melody.occupation_location_id];
      melodyLocationInPopup = workLoc.name;
      
      // Would Travel page show her there?
      // Check if she's in the residents list (which we registered her in)
      wouldAppearInPopup = (workLoc.resident_character_ids || []).includes(melody.id) ||
                          (workLoc.resident_character_names || []).includes(melody.name);
    }

    // === LAYER 3: OCCUPANCY REGISTRY ===
    let isRegisteredInLocation = false;
    let registeredIn = null;

    if (melody.occupation_location_id && locationMap[melody.occupation_location_id]) {
      const workLoc = locationMap[melody.occupation_location_id];
      isRegisteredInLocation = (workLoc.resident_character_ids || []).includes(melody.id) ||
                              (workLoc.resident_character_names || []).includes(melody.name);
      if (isRegisteredInLocation) {
        registeredIn = workLoc.name;
      }
    }

    // === COHESION CHECK ===
    const cohesive = 
      cardLabel.includes('VGC Gym') &&
      melodyLocationInPopup === 'VGC Gym' &&
      isRegisteredInLocation &&
      registeredIn === 'VGC Gym';

    return Response.json({
      timestamp: new Date().toISOString(),
      character: {
        id: melody.id,
        name: melody.name,
        occupationLocationId: melody.occupation_location_id,
        currentLocationId: melody.current_location_id,
        homeLocationId: melody.current_home_location_id
      },
      
      layer1_cardDisplay: {
        label: cardLabel,
        icon: cardIcon,
        exactMatch: cardLabel === 'at VGC Gym',
        isGenericCollapse: cardLabel === 'at gym'
      },

      layer2_travelPopupView: {
        wouldAppear: wouldAppearInPopup,
        expectedLocation: melodyLocationInPopup,
        isCorrect: melodyLocationInPopup === 'VGC Gym'
      },

      layer3_occupancyRegistry: {
        isRegistered: isRegisteredInLocation,
        registeredIn,
        isCorrect: registeredIn === 'VGC Gym'
      },

      cohesion: {
        allThreeMatch: cohesive,
        cardShowsVGCGym: cardLabel.includes('VGC Gym'),
        popupWouldShowMelody: melodyLocationInPopup === 'VGC Gym' && wouldAppearInPopup,
        occupancyHasMelody: isRegisteredInLocation && registeredIn === 'VGC Gym'
      },

      status: cohesive ? 'LOCATION_COHESION_VERIFIED' : 'COHESION_FAILURE'
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});