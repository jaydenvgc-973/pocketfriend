import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all user characters
    const characters = await base44.entities.Character.filter({ created_by: user.email }, '-created_date', 100);
    const locations = await base44.entities.LocationReference.list('-created_date', 200);
    
    const issues = [];
    const fixes = [];

    // Check each character
    for (const char of characters) {
      if (char.status !== 'active') continue;

      const activity = (char.current_activity || '').toLowerCase().trim();
      
      // List of generic location keywords
      const genericLocationKeywords = [
        { keyword: 'gym', category: 'gym' },
        { keyword: 'bar', category: 'food_drink' },
        { keyword: 'club', category: 'social' },
        { keyword: 'mall', category: 'social' },
        { keyword: 'park', category: 'outdoor' },
        { keyword: 'restaurant', category: 'food_drink' },
        { keyword: 'coffee', category: 'food_drink' },
        { keyword: 'movie', category: 'social' },
        { keyword: 'work', category: 'work' },
      ];

      // Check if activity contains generic keywords
      const matchedGeneric = genericLocationKeywords.find(g => activity.includes(g.keyword));
      
      // If no current_location_id but activity suggests a location, log issue
      if (matchedGeneric && !char.current_location_id) {
        issues.push({
          characterId: char.id,
          characterName: char.name,
          currentActivity: char.current_activity,
          hasCurrentLocationId: !!char.current_location_id,
          genericKeywordDetected: matchedGeneric.keyword,
          category: matchedGeneric.category
        });

        // Try to find and assign a matching location
        let targetLocation = null;
        if (matchedGeneric.keyword === 'gym') {
          targetLocation = locations.find(l => l.category === 'gym');
        } else if (matchedGeneric.keyword === 'work' && char.current_work_location_id) {
          targetLocation = locations.find(l => l.id === char.current_work_location_id);
        } else {
          targetLocation = locations.find(l => l.category === matchedGeneric.category);
        }

        if (targetLocation) {
          await base44.entities.Character.update(char.id, {
            current_location_id: targetLocation.id
          });
          fixes.push({
            characterName: char.name,
            previousActivity: char.current_activity,
            assignedLocation: targetLocation.name,
            locationId: targetLocation.id
          });
        }
      }
    }

    return Response.json({
      totalCharacters: characters.length,
      activeCharacters: characters.filter(c => c.status === 'active').length,
      issuesFound: issues.length,
      issueDetails: issues,
      fixesApplied: fixes.length,
      fixesAppliedDetails: fixes
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});