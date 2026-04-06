import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * FULL PIPELINE TRACE: For every active character, trace what SHOULD be displayed vs what EXISTS
 * 1. Source data (location IDs, names)
 * 2. Location resolution (what the helper would return)
 * 3. UI binding (what would render)
 * 4. Generic collapse detection (forbidden patterns)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const activeChars = characters.filter(c => 
      c.status !== 'deleted' && 
      c.status !== 'moved_away' && 
      c.character_type !== 'npc'
    );

    const audit = activeChars.map(char => {
      // === LAYER 1: SOURCE DATA ===
      const workLocId = char.occupation_location_id;
      const eduLocId = char.education_location_id;
      const homeLocId = char.current_home_location_id;
      const currentLocId = char.current_location_id;

      const workLoc = workLocId ? locationMap[workLocId] : null;
      const eduLoc = eduLocId ? locationMap[eduLocId] : null;
      const homeLoc = homeLocId ? locationMap[homeLocId] : null;
      const currentLoc = currentLocId ? locationMap[currentLocId] : null;

      // === LAYER 2: LOCATION RESOLUTION (simulate getCharacterStatusDisplay) ===
      // Priority 1: At work
      const shouldShowWork = workLoc && workLocId;
      const workDisplayLabel = shouldShowWork ? `at ${workLoc.name}` : null;

      // Priority 2: At school
      const shouldShowSchool = eduLoc && eduLocId && !shouldShowWork;
      const schoolDisplayLabel = shouldShowSchool ? `at ${eduLoc.name}` : null;

      // Priority 3: At home
      const homeDisplayLabel = homeLoc ? `at ${homeLoc.name}` : 'at home';

      // === LAYER 3: FINAL DISPLAY (what SHOULD render) ===
      let finalDisplayLabel = 'available';
      let finalIconType = 'calm';

      if (shouldShowWork && workLoc.name) {
        finalDisplayLabel = `at ${workLoc.name}`;
        finalIconType = 'work';
      } else if (shouldShowSchool && eduLoc.name) {
        finalDisplayLabel = `at ${eduLoc.name}`;
        finalIconType = 'school';
      } else if (homeLoc) {
        finalDisplayLabel = `at ${homeLoc.name}`;
        finalIconType = 'home';
      }

      // === LAYER 4: GENERIC COLLAPSE DETECTION ===
      const forbiddenPatterns = [
        'at gym', 'at school', 'at work', 'at restaurant', 'at park', 
        'at bar', 'at club', 'at hospital', 'at store', 'in class'
      ];
      const isGenericCollapse = forbiddenPatterns.some(pattern => 
        finalDisplayLabel.toLowerCase() === pattern
      );

      // === LAYER 5: VIOLATION DETECTION ===
      const violations = [];
      if (shouldShowWork && !workLoc.name) {
        violations.push('CRITICAL: Work location ID set but location has no name');
      }
      if (shouldShowSchool && !eduLoc.name) {
        violations.push('CRITICAL: School location ID set but location has no name');
      }
      if (isGenericCollapse) {
        violations.push(`VIOLATION: Display shows generic pattern "${finalDisplayLabel}" when named location exists`);
      }

      return {
        id: char.id,
        name: char.name,
        activity: char.current_activity,
        sourceData: {
          workLocId,
          workLocName: workLoc?.name || null,
          eduLocId,
          eduLocName: eduLoc?.name || null,
          homeLocId,
          homeLocName: homeLoc?.name || null,
          currentLocId,
          currentLocName: currentLoc?.name || null
        },
        resolution: {
          shouldShowWork,
          shouldShowSchool,
          hasHome: !!homeLoc
        },
        displayLabel: finalDisplayLabel,
        iconType: finalIconType,
        isGenericCollapse,
        violations,
        isValid: violations.length === 0
      };
    });

    const violations = audit.filter(a => !a.isValid);
    const validCount = audit.filter(a => a.isValid).length;

    return Response.json({
      totalActive: activeChars.length,
      validCount,
      violationCount: violations.length,
      violations,
      fullAudit: audit
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});