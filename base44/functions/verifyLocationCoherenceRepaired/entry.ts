import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * VERIFY LOCATION COHERENCE AFTER REPAIR
 * 
 * Checks whether locations are now properly registered and coherent:
 * 1. Card displays correct named location
 * 2. Character is registered in that location's occupancy
 * 3. Travel popup would show character in that location
 * 4. Single location is authoritative based on priority
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter({ created_by: user.email }, "-updated_date");
    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const activeChars = characters.filter(c => 
      c.status !== 'deleted' && 
      c.status !== 'moved_away' && 
      c.character_type !== 'npc'
    );

    const coherenceVerification = activeChars.map((char) => {
      // Priority: work > school > home
      let authLocId = null;
      let authLocName = null;
      let authPriority = null;
      
      if (char.occupation_location_id && locationMap[char.occupation_location_id]) {
        authLocId = char.occupation_location_id;
        authLocName = locationMap[authLocId].name;
        authPriority = 'work';
      } else if (char.education_location_id && locationMap[char.education_location_id]) {
        authLocId = char.education_location_id;
        authLocName = locationMap[authLocId].name;
        authPriority = 'school';
      } else if (char.current_home_location_id && locationMap[char.current_home_location_id]) {
        authLocId = char.current_home_location_id;
        authLocName = locationMap[authLocId].name;
        authPriority = 'home';
      }

      // Verify CURRENT_LOCATION is set
      const currentLocId = char.current_location_id;
      const currentLoc = currentLocId ? locationMap[currentLocId] : null;

      // Check card display
      const cardLabel = (() => {
        if (char.occupation_location_id && locationMap[char.occupation_location_id]) {
          return `at ${locationMap[char.occupation_location_id].name}`;
        } else if (char.education_location_id && locationMap[char.education_location_id]) {
          return `at ${locationMap[char.education_location_id].name}`;
        } else if (char.current_home_location_id && locationMap[char.current_home_location_id]) {
          return `at ${locationMap[char.current_home_location_id].name}`;
        }
        return 'available';
      })();

      // Check place occupancy registry
      const registryStatus = (() => {
        if (!authLocId) return { registered: false, location: null };
        
        const loc = locationMap[authLocId];
        if (!loc) return { registered: false, location: authLocName, error: 'location_not_found' };

        const inResidents = loc.resident_character_ids?.includes(char.id);
        const inWorkers = loc.worker_character_ids?.includes(char.id);

        return {
          registered: inResidents || inWorkers,
          location: authLocName,
          inResidents,
          inWorkers
        };
      })();

      // Check if travel popup would show character
      const travelPopupWillShowChar = registryStatus.registered;

      // Violations
      const violations = [];
      
      if (authLocId && !currentLocId) {
        violations.push('CURRENT_LOCATION_NOT_SET: Authoritative location exists but current_location_id is empty');
      }
      
      if (authLocId && currentLocId && currentLocId !== authLocId) {
        violations.push(`CURRENT_LOCATION_MISMATCH: current_location_id (${locationMap[currentLocId]?.name}) != authoritative (${authLocName})`);
      }

      if (authLocId && !registryStatus.registered) {
        violations.push(`NOT_REGISTERED: Character not in ${authLocName} occupancy list`);
      }

      if (cardLabel.includes('available') && authLocId) {
        violations.push(`CARD_DISPLAY: Shows 'available' instead of '${cardLabel}'`);
      }

      return {
        characterId: char.id,
        characterName: char.name,
        authoritativeLocation: {
          id: authLocId,
          name: authLocName,
          priority: authPriority
        },
        currentLocationField: {
          id: currentLocId,
          name: currentLoc?.name || null
        },
        cardDisplayWillShow: cardLabel,
        placeOccupancyStatus: registryStatus,
        travelPopupWillShow: travelPopupWillShowChar,
        violations,
        isCoherent: violations.length === 0 && travelPopupWillShowChar && cardLabel !== 'available'
      };
    });

    // Summary
    const coherentCount = coherenceVerification.filter(v => v.isCoherent).length;
    const failedCount = coherenceVerification.filter(v => !v.isCoherent).length;
    const failures = coherenceVerification.filter(v => !v.isCoherent).map(v => ({
      character: v.characterName,
      violations: v.violations
    }));

    return Response.json({
      timestamp: new Date().toISOString(),
      summary: {
        totalActive: coherenceVerification.length,
        coherentCount,
        failedCount,
        coherenceRate: ((coherentCount / coherenceVerification.length) * 100).toFixed(1) + '%'
      },
      failures: failedCount > 0 ? failures : [],
      detail: coherenceVerification,
      healthStatus: failedCount === 0 ? 'HEALTHY' : 'REPAIRS_NEEDED'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});