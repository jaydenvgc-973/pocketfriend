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
    const stillBroken = [];

    for (const char of characters) {
      if (char.status !== 'active') continue;

      const activity = (char.current_activity || '').toLowerCase().trim();
      const currentLoc = char.current_location_id ? locationMap[char.current_location_id] : null;

      // FIX 1: Missing location for GYM activity
      if (activity.includes('gym') && !char.current_location_id) {
        const gymLoc = locations.find(l => l.category === 'gym');
        if (gymLoc) {
          await base44.entities.Character.update(char.id, { current_location_id: gymLoc.id });
          fixes.push({ character: char.name, fix: 'Assigned gym location', location: gymLoc.name });
        }
      }

      // FIX 2: Bar activity but location not in social/food_drink or missing bar keyword
      if (activity.includes('bar') && char.current_location_id && currentLoc) {
        const isSocialOrFood = currentLoc.category === 'social' || currentLoc.category === 'food_drink';
        const hasBarKeyword = currentLoc.name?.toLowerCase().includes('bar') || 
                             currentLoc.keywords?.some(k => k.toLowerCase().includes('bar'));
        
        if (!isSocialOrFood || !hasBarKeyword) {
          // Try to find correct bar location
          const correctBar = locations.find(l => 
            (l.category === 'social' || l.category === 'food_drink') &&
            (l.name?.toLowerCase().includes('bar') || l.keywords?.some(k => k.toLowerCase().includes('bar')))
          );
          if (correctBar && correctBar.id !== char.current_location_id) {
            await base44.entities.Character.update(char.id, { current_location_id: correctBar.id });
            fixes.push({ character: char.name, fix: 'Reassigned to correct bar location', location: correctBar.name });
          } else if (!isSocialOrFood || !hasBarKeyword) {
            stillBroken.push({ character: char.name, reason: 'Bar location exists but missing social/food_drink category or bar keyword' });
          }
        }
      }

      // FIX 3: Restaurant activity but missing location
      if (activity.includes('restaurant') && !char.current_location_id) {
        const restaurantLoc = locations.find(l => l.category === 'food_drink' && l.name?.toLowerCase().includes('restaurant'));
        if (restaurantLoc) {
          await base44.entities.Character.update(char.id, { current_location_id: restaurantLoc.id });
          fixes.push({ character: char.name, fix: 'Assigned restaurant location', location: restaurantLoc.name });
        }
      }

      // FIX 4: Club activity but missing location
      if (activity.includes('club') && !char.current_location_id) {
        const clubLoc = locations.find(l => l.category === 'social' && 
          (l.name?.toLowerCase().includes('club') || l.keywords?.some(k => k.toLowerCase().includes('club'))));
        if (clubLoc) {
          await base44.entities.Character.update(char.id, { current_location_id: clubLoc.id });
          fixes.push({ character: char.name, fix: 'Assigned club location', location: clubLoc.name });
        }
      }

      // FIX 5: Missing sleep schedule
      if (!char.wake_time || !char.sleep_time) {
        const defaultSchedule = {
          wake_time: '07:00',
          sleep_time: '23:00'
        };
        await base44.entities.Character.update(char.id, defaultSchedule);
        fixes.push({ character: char.name, fix: 'Set default sleep schedule' });
      }

      // FIX 6: Missing emotional state
      if (!char.emotional_state) {
        await base44.entities.Character.update(char.id, { emotional_state: 'calm' });
        fixes.push({ character: char.name, fix: 'Set default emotional state to calm' });
      }
    }

    return Response.json({
      fixesApplied: fixes.length,
      fixes: fixes,
      stillBrokenIssues: stillBroken.length,
      stillBroken: stillBroken,
      note: 'Check Home page to verify all character cards now display correctly'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});