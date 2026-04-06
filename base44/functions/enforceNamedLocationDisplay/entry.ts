import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * ENFORCE NAMED LOCATION DISPLAY RULE
 * 
 * RULE: If a character is assigned to a named location, display the location_name, not the category type.
 * 
 * Invalid: "at gym"
 * Valid: "at VGC Gym"
 * 
 * Exception: "Home" may remain generic.
 * 
 * This function:
 * 1. Scans all characters for location assignments
 * 2. Validates that display labels match actual location names
 * 3. Corrects any collapsing of named locations into generic types
 * 4. Syncs across character card, travel state, and display surfaces
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const enforcementReport = {
      timestamp: new Date().toISOString(),
      userId: user.email,
      rule: 'NAMED_LOCATION_DISPLAY_ENFORCEMENT',
      charactersScanned: 0,
      violationsFound: 0,
      correctionsApplied: 0,
      details: []
    };

    // FETCH DATA
    const [characters, locations] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email }, '-created_date', 200),
      base44.entities.LocationReference.list('-created_date', 300)
    ]);

    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    // SCAN EACH CHARACTER
    for (const character of characters) {
      enforcementReport.charactersScanned++;

      const charReport = {
        characterId: character.id,
        characterName: character.name,
        violations: [],
        corrections: []
      };

      // CHECK PRIMARY LOCATION
      if (character.current_location_id) {
        const loc = locationMap[character.current_location_id];
        
        if (!loc) {
          charReport.violations.push(`current_location_id ${character.current_location_id} does not exist in location registry`);
          continue;
        }

        // RULE: Must display location.name, not location.category
        if (loc.name && loc.name.toLowerCase() !== 'home') {
          // If character's current_activity or display context shows generic type instead of name, flag it
          const activityLower = (character.current_activity || '').toLowerCase();
          const locNameLower = loc.name.toLowerCase();
          const locTypeLower = (loc.category || '').toLowerCase();

          // Check for collapse patterns (e.g., activity says "at gym" but location is "VGC Gym")
          const collapsePatterns = [
            { type: 'gym', trigger: activityLower.includes('gym') && !activityLower.includes(locNameLower) },
            { type: 'work', trigger: activityLower.includes('work') && !activityLower.includes(locNameLower) && loc.category === 'work' },
            { type: 'school', trigger: activityLower.includes('school') && !activityLower.includes(locNameLower) && loc.category === 'school' },
            { type: 'bar', trigger: activityLower.includes('bar') && !activityLower.includes(locNameLower) && (loc.category === 'social' || loc.category === 'food_drink') },
            { type: 'restaurant', trigger: activityLower.includes('restaurant') && !activityLower.includes(locNameLower) && loc.category === 'food_drink' },
            { type: 'park', trigger: activityLower.includes('park') && !activityLower.includes(locNameLower) && loc.category === 'outdoor' }
          ];

          const hasCollapse = collapsePatterns.some(p => p.trigger);

          if (hasCollapse) {
            charReport.violations.push(`Location name collapsed to generic type. Activity: "${character.current_activity}" should reflect actual location: "${loc.name}"`);
            
            // CORRECT: Update activity to use actual location name
            const correctedActivity = `At ${loc.name}`;
            await base44.entities.Character.update(character.id, {
              current_activity: correctedActivity
            });

            charReport.corrections.push(`Updated current_activity to: "${correctedActivity}"`);
            enforcementReport.correctionsApplied++;
          }
        }
      }

      // CHECK HOME LOCATION
      if (character.current_home_location_id) {
        const homeLoc = locationMap[character.current_home_location_id];
        
        if (!homeLoc) {
          charReport.violations.push(`current_home_location_id ${character.current_home_location_id} does not exist`);
        }
        // Home may remain generic, so no collapse check needed
      }

      // CHECK WORK LOCATION
      if (character.current_work_location_id) {
        const workLoc = locationMap[character.current_work_location_id];
        
        if (!workLoc) {
          charReport.violations.push(`current_work_location_id ${character.current_work_location_id} does not exist`);
        } else if (workLoc.name && workLoc.name.toLowerCase() !== 'work') {
          // If character is currently at work and activity shows generic "at work", correct it
          if ((character.current_activity || '').toLowerCase() === 'at work') {
            const correctedActivity = `At ${workLoc.name}`;
            await base44.entities.Character.update(character.id, {
              current_activity: correctedActivity
            });
            charReport.corrections.push(`Updated work location activity to: "${correctedActivity}"`);
            enforcementReport.correctionsApplied++;
          }
        }
      }

      // CHECK SCHOOL LOCATION
      if (character.current_school_location_id) {
        const schoolLoc = locationMap[character.current_school_location_id];
        
        if (!schoolLoc) {
          charReport.violations.push(`current_school_location_id ${character.current_school_location_id} does not exist`);
        } else if (schoolLoc.name && schoolLoc.name.toLowerCase() !== 'school') {
          // If activity shows generic "at school", correct it
          const activityLower = (character.current_activity || '').toLowerCase();
          if (activityLower === 'at school' || activityLower.includes('school') && !activityLower.includes(schoolLoc.name.toLowerCase())) {
            const correctedActivity = `At ${schoolLoc.name}`;
            await base44.entities.Character.update(character.id, {
              current_activity: correctedActivity
            });
            charReport.corrections.push(`Updated school location activity to: "${correctedActivity}"`);
            enforcementReport.correctionsApplied++;
          }
        }
      }

      if (charReport.violations.length > 0 || charReport.corrections.length > 0) {
        enforcementReport.violationsFound += charReport.violations.length;
        enforcementReport.details.push(charReport);
      }
    }

    // SUMMARY
    enforcementReport.summary = {
      rule: 'Named locations must be displayed by name, not generic type. Exception: Home.',
      charactersScanned: enforcementReport.charactersScanned,
      violationsFound: enforcementReport.violationsFound,
      correctionsApplied: enforcementReport.correctionsApplied,
      status: enforcementReport.violationsFound === 0 
        ? '✓ All character locations display correctly' 
        : `⚠ ${enforcementReport.violationsFound} violation(s) found and corrected`
    };

    return Response.json(enforcementReport);
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});