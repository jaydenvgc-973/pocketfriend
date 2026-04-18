import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email }, '-created_date', 100);
    const locations = await base44.entities.LocationReference.list('-created_date', 200);
    
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));
    const fixes = [];
    const unresolved = [];

    // Generic categories to check
    const genericCategories = {
      gym: ['gym'],
      bar: ['food_drink', 'social'],
      restaurant: ['food_drink'],
      club: ['social']
    };

    for (const char of characters) {
      if (char.status !== 'active') continue;

      const activity = (char.current_activity || '').toLowerCase().trim();
      const currentLoc = char.current_location_id ? locationMap[char.current_location_id] : null;

      // Check if current location is generic
      const isCurrentLocGeneric = currentLoc && currentLoc.is_default_generic === true;

      // 1. If character is at a generic location, attempt to find specific match
      if (isCurrentLocGeneric && currentLoc) {
        const applicableCategories = Object.entries(genericCategories)
          .filter(([keyword]) => activity.includes(keyword))
          .flatMap(([, cats]) => cats);

        let specificLoc = null;
        if (applicableCategories.length > 0) {
          specificLoc = locations.find(l => 
            !l.is_default_generic && 
            applicableCategories.includes(l.category) &&
            l.id !== char.current_location_id
          );
        }

        if (specificLoc) {
          // Found a specific location to upgrade to
          await base44.entities.Character.update(char.id, { 
            current_location_id: specificLoc.id 
          });
          fixes.push({
            characterId: char.id,
            characterName: char.name,
            action: 'upgraded_from_generic',
            fromLocation: currentLoc.name,
            toLocation: specificLoc.name,
            category: specificLoc.category
          });
        } else {
          // No specific match found, flag as unresolved
          unresolved.push({
            characterId: char.id,
            characterName: char.name,
            issue: 'at_generic_location',
            currentLocation: currentLoc.name,
            activity: char.current_activity,
            category: currentLoc.category
          });
        }
      }

      // 2. Check for "rabbit hole" locations in activity
      // Look for specific place names that might not have LocationReferences
      const realWorldPatterns = [
        /(?:at|in|near)\s+([A-Z][a-zA-Z\s&'-]+(?:café|cafe|bar|pub|gym|restaurant|diner|lounge|club|park|mall|store|shop|office|bank|hospital|clinic|school))/gi,
        /(?:visiting|going to|working at|studying at)\s+([A-Z][a-zA-Z\s&'-]+)/gi
      ];

      let foundRabbitHole = false;
      for (const pattern of realWorldPatterns) {
        const matches = activity.matchAll(pattern);
        for (const match of matches) {
          const placeName = match[1]?.trim();
          if (placeName) {
            // Check if this place exists as a LocationReference
            const existingLoc = locations.find(l => 
              l.name && l.name.toLowerCase().includes(placeName.toLowerCase())
            );

            if (!existingLoc && char.current_location_id) {
              // This looks like a rabbit hole location
              foundRabbitHole = true;
              unresolved.push({
                characterId: char.id,
                characterName: char.name,
                issue: 'rabbit_hole_location',
                mentionedPlace: placeName,
                activity: char.current_activity,
                currentLocationId: char.current_location_id,
                recommendation: `Create LocationReference for "${placeName}"`
              });
            }
          }
        }
      }
    }

    return Response.json({
      summary: {
        totalCharacters: characters.length,
        activeCharacters: characters.filter(c => c.status === 'active').length,
        fixesApplied: fixes.length,
        unresolvedIssues: unresolved.length
      },
      fixes,
      unresolved,
      nextSteps: unresolved.length > 0 ? 'Create specific LocationReferences for unresolved characters or assign them to existing locations manually.' : 'All character locations have been resolved to specific places.'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});