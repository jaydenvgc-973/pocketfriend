import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch ALL locations
    const locations = await base44.entities.LocationReference.list();
    const locationMap = {};
    locations.forEach(loc => {
      locationMap[loc.name.toLowerCase()] = loc.id;
    });

    // Fetch all characters
    const allChars = await base44.entities.Character.list();
    
    // Find the correct characters (they may have full names)
    const charMap = {};
    allChars.forEach(c => {
      // Store by name, both exact and first word
      charMap[c.name.toLowerCase()] = c;
      const firstName = c.name.split(' ')[0].toLowerCase();
      if (!charMap[firstName]) charMap[firstName] = c;
    });

    // Character search name -> location name mapping
    const updates = {
      'matt': 'Default Home',
      'melody': 'Default Home',
      'andre': 'Default Home',
      'brian': 'Park',
      'lila': 'VGC Medical Center',
      'nathan': 'Hospital',
      'james': "Anderson's Bar",
      'jonathan': "Anderson's Bar",
      'ava': 'coffee shop',
    };

    const results = [];
    const failedLocations = new Set();
    
    // Update each character
    for (const [charSearch, locName] of Object.entries(updates)) {
      const char = charMap[charSearch];
      
      // Try to find location by various matching strategies
      let locId = null;
      const locSearchLower = locName.toLowerCase();
      
      // Exact match
      if (locationMap[locSearchLower]) {
        locId = locationMap[locSearchLower];
      } else {
        // Fuzzy match: try substring matching
        const match = Object.entries(locationMap).find(([name]) => 
          name.includes(locSearchLower) || locSearchLower.includes(name)
        );
        if (match) locId = match[1];
      }
      
      if (char && locId) {
        await base44.entities.Character.update(char.id, {
          current_location_id: locId,
        });
        results.push({ 
          character: char.name, 
          location: locName, 
          status: 'UPDATED',
          charId: char.id,
          locId: locId
        });
      } else {
        if (!locId) failedLocations.add(locName);
        results.push({ 
          character: charSearch, 
          location: locName, 
          status: char ? 'LOCATION NOT FOUND' : 'CHARACTER NOT FOUND',
        });
      }
    }

    return Response.json({
      success: true,
      updated: results.filter(r => r.status === 'UPDATED').length,
      results,
      failedLocations: Array.from(failedLocations),
      allLocations: Object.keys(locationMap).sort(),
      message: 'Batch fix completed.',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});