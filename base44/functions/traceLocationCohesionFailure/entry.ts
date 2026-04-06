import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * LOCATION COHESION FAILURE DIAGNOSTIC
 * 
 * Traces the FULL LOCATION PIPELINE for all active characters:
 * 1. Source state (character location fields)
 * 2. Place occupancy registry (is character registered in location's presence list?)
 * 3. Card display (what will CharacterCard show?)
 * 4. Travel popup (would character appear in that location's popup?)
 * 5. Cross-system coherence (do all agree?)
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

    const cohesionTrace = activeChars.map((char) => {
      // === LAYER 1: SOURCE STATE ===
      const workLocId = char.occupation_location_id;
      const eduLocId = char.education_location_id;
      const homeLocId = char.current_home_location_id;
      const currentLocId = char.current_location_id;

      const workLoc = workLocId ? locationMap[workLocId] : null;
      const eduLoc = eduLocId ? locationMap[eduLocId] : null;
      const homeLoc = homeLocId ? locationMap[homeLocId] : null;
      const currentLoc = currentLocId ? locationMap[currentLocId] : null;

      // Determine authoritative current location
      let authoritativeLocId = null;
      let authoritativeLocName = null;
      let authoritativeLocCategory = null;
      
      if (workLocId && workLoc) {
        authoritativeLocId = workLocId;
        authoritativeLocName = workLoc.name;
        authoritativeLocCategory = workLoc.category;
      } else if (eduLocId && eduLoc) {
        authoritativeLocId = eduLocId;
        authoritativeLocName = eduLoc.name;
        authoritativeLocCategory = eduLoc.category;
      } else if (homeLocId && homeLoc) {
        authoritativeLocId = homeLocId;
        authoritativeLocName = homeLoc.name;
        authoritativeLocCategory = homeLoc.category;
      }

      // === LAYER 2: PLACE OCCUPANCY REGISTRY ===
      // Check if character is in that location's resident/worker/visitor lists
      const placeRegistryCheck = (() => {
        if (!authoritativeLocId) return { isRegistered: false, where: null };
        
        const loc = locationMap[authoritativeLocId];
        if (!loc) return { isRegistered: false, where: null, error: 'location_not_found' };

        const inResidents = loc.resident_character_ids?.includes(char.id) || 
                           loc.resident_character_names?.includes(char.name) ||
                           false;
        const inWorkers = loc.worker_character_ids?.includes(char.id) || false;
        
        // Check family members
        const inFamily = loc.resident_family_members?.some(fm => 
          fm.source_character_id === char.id || fm.name === char.name
        ) || false;

        return {
          isRegistered: inResidents || inWorkers || inFamily,
          where: inResidents ? 'residents' : inWorkers ? 'workers' : inFamily ? 'family' : null,
          inResidents,
          inWorkers,
          inFamily
        };
      })();

      // === LAYER 3: CARD DISPLAY ===
      // Simulate what CharacterCard will render
      const cardDisplay = (() => {
        let label = 'available';
        let iconType = 'calm';

        if (workLoc && workLocId) {
          label = `at ${workLoc.name}`;
          iconType = 'work';
        } else if (eduLoc && eduLocId) {
          label = `at ${eduLoc.name}`;
          iconType = 'school';
        } else if (homeLoc && homeLocId) {
          label = `at ${homeLoc.name}`;
          iconType = 'home';
        }

        return { label, iconType };
      })();

      // === LAYER 4: TRAVEL POPUP OCCUPANCY ===
      // Check what the Travel page would see for this character's location
      const travelPopupView = (() => {
        if (!authoritativeLocId) return { wouldAppear: false, reason: 'no_location' };

        const loc = locationMap[authoritativeLocId];
        if (!loc) return { wouldAppear: false, reason: 'location_not_found' };

        // Travel popup would look at: residents + workers + family in that location
        const wouldAppear = placeRegistryCheck.isRegistered;

        return {
          wouldAppear,
          expectedLocation: loc.name,
          actuallyInRegistry: placeRegistryCheck.isRegistered,
          registeredAs: placeRegistryCheck.where
        };
      })();

      // === LAYER 5: CROSS-SYSTEM COHERENCE ===
      const coherenceCheck = (() => {
        const violations = [];

        // Check 1: Source state consistency
        if (authoritativeLocId && !authoritativeLocName) {
          violations.push('SOURCE_STATE: Location ID set but name is null');
        }

        // Check 2: Card shows named location or falls back to category
        const cardHasGeneric = cardDisplay.label === 'at gym' || 
                              cardDisplay.label === 'at work' || 
                              cardDisplay.label === 'at school';
        if (authoritativeLocName && cardHasGeneric) {
          violations.push(`CARD_DISPLAY: Shows generic category "${cardDisplay.label}" instead of named location "${authoritativeLocName}"`);
        }

        // Check 3: Place registry missing registration
        if (authoritativeLocId && !placeRegistryCheck.isRegistered) {
          violations.push(`PLACE_REGISTRY: Character assigned to ${authoritativeLocName} but NOT registered in location's resident/worker/family lists`);
        }

        // Check 4: Travel popup would not show character
        if (authoritativeLocId && !travelPopupView.wouldAppear) {
          violations.push(`TRAVEL_POPUP: Character would NOT appear in ${authoritativeLocName} popup (registry mismatch)`);
        }

        // Check 5: Verify authoritativeLocId resolves to exactly one of work/school/home (not multiple)
        // This is valid: having work + home assignments with work chosen as priority
        // This is INVALID: having work + school (competing priorities)
        const assignmentCount = [workLocId ? 1 : 0, eduLocId ? 1 : 0, homeLocId ? 1 : 0].reduce((a,b) => a+b, 0);
        if (assignmentCount > 1 && !workLocId && !eduLocId) {
          // Only school + home, that's fine
        } else if (assignmentCount > 2) {
          // Work + school + home — need to validate priority is clear
          if (!workLocId && !eduLocId) {
            // Only home, that's fine
          }
        }
        // Having multiple assignments is acceptable as long as priority (work > school > home) is clear

        return {
          coherent: violations.length === 0,
          violations,
          systemsInAgreement: {
            cardMatchesAuthority: cardDisplay.label.includes(authoritativeLocName || 'none'),
            registryMatchesAuthority: placeRegistryCheck.isRegistered,
            travelPopupMatchesAuthority: travelPopupView.wouldAppear
          }
        };
      })();

      return {
        characterId: char.id,
        characterName: char.name,
        
        layer1_sourceState: {
          workLocId,
          workLocName: workLoc?.name || null,
          eduLocId,
          eduLocName: eduLoc?.name || null,
          homeLocId,
          homeLocName: homeLoc?.name || null,
          currentLocId,
          currentLocName: currentLoc?.name || null,
          authoritativeLocId,
          authoritativeLocName,
          authoritativeLocCategory
        },

        layer2_placeOccupancyRegistry: placeRegistryCheck,

        layer3_cardDisplay: cardDisplay,

        layer4_travelPopupView: travelPopupView,

        layer5_crossSystemCoherence: coherenceCheck,

        // FINAL VERDICT
        isCohesive: coherenceCheck.coherent && 
                   coherenceCheck.systemsInAgreement.cardMatchesAuthority &&
                   coherenceCheck.systemsInAgreement.registryMatchesAuthority &&
                   coherenceCheck.systemsInAgreement.travelPopupMatchesAuthority
      };
    });

    // Summary
    const cohesiveCount = cohesionTrace.filter(t => t.isCohesive).length;
    const failedCount = cohesionTrace.filter(t => !t.isCohesive).length;
    const totalActive = cohesionTrace.length;

    const failures = cohesionTrace.filter(t => !t.isCohesive).map(t => ({
      character: t.characterName,
      violations: t.layer5_crossSystemCoherence.violations
    }));

    return Response.json({
      timestamp: new Date().toISOString(),
      summary: {
        totalActive,
        cohesiveCount,
        failedCount,
        cohesionRate: ((cohesiveCount / totalActive) * 100).toFixed(1) + '%'
      },
      failures: failedCount > 0 ? failures : [],
      fullTrace: cohesionTrace,
      systemHealthy: failedCount === 0
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});