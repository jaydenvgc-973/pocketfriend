import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, messageContent } = await req.json();
    
    if (!characterId || !messageContent) {
      return Response.json({ error: 'Missing characterId or messageContent' }, { status: 400 });
    }

    const char = await base44.entities.Character.filter({ id: characterId });
    if (!char || char.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const character = char[0];
    
    // Get all locations to match against
    const locRes = await base44.functions.invoke('fetchAllLocationsForUser', {});
    const allLocations = locRes?.data?.locations || [];
    
    // Parse message for location keywords
    const msgLower = messageContent.toLowerCase();
    let detectedLocation = null;
    let detectedLocationName = null;

    for (const loc of allLocations) {
      const locNameLower = loc.name.toLowerCase();
      const keywords = (loc.keywords || []).map(k => k.toLowerCase());
      
      // Check if location name or keywords appear in message
      if (msgLower.includes(locNameLower) || keywords.some(kw => msgLower.includes(kw))) {
        // Also check for phrases like "at X", "I'm at X", "going to X"
        const atPattern = new RegExp(`\\b(at|at the|i'm at|i am at|at my|currently at|heading to|going to|here at)\\s+${locNameLower}`, 'i');
        if (atPattern.test(messageContent)) {
          detectedLocation = loc.id;
          detectedLocationName = loc.name;
          break;
        }
      }
    }

    // If location detected, update BOTH current_activity AND current_location_id
    if (detectedLocation && detectedLocationName !== character.current_activity) {
      await base44.entities.Character.update(characterId, {
        current_activity: detectedLocationName,
        current_location_id: detectedLocation
      });
      
      return Response.json({ 
        success: true, 
        updated: true,
        newLocation: detectedLocationName,
        message: `Updated ${character.name}'s location to ${detectedLocationName}`
      });
    }

    return Response.json({ 
      success: true, 
      updated: false,
      message: 'No location change detected'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});