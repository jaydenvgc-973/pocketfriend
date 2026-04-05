import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({}));
    const excludeCharacterIds = payload.excludeCharacterIds || [];

    // Get 1-3 random active characters (exclude recently invited)
    const allCharacters = await base44.entities.Character.filter({
      created_by: user.email,
      status: 'active',
    });

    const characters = allCharacters.filter(c => !excludeCharacterIds.includes(c.id));

    if (characters.length === 0) {
      return Response.json({ invitations: [] });
    }

    // Randomly select 1-3 characters
    const count = Math.floor(Math.random() * 3) + 1; // 1-3
    const selected = [];
    const used = new Set();

    for (let i = 0; i < count && selected.length < characters.length; i++) {
      let char;
      let attempts = 0;
      do {
        char = characters[Math.floor(Math.random() * characters.length)];
        attempts++;
      } while (used.has(char.id) && attempts < 10);
      
      if (!used.has(char.id)) {
        used.add(char.id);
        selected.push(char);
      }
    }

    // Get all locations
    const locations = await base44.entities.LocationReference.list();
    
    // Helper: check if location is open right now
    const isLocationOpen = (location) => {
      if (!location.operating_hours || location.operating_hours.length === 0) {
        return true; // No hours defined = always open
      }
      
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0 = Sunday
      const currentTime = now.getHours() * 60 + now.getMinutes();
      
      const todayHours = location.operating_hours.find(h => h.day_of_week === dayOfWeek);
      if (!todayHours) return false;
      
      const [openHour, openMin] = todayHours.open_time.split(':').map(Number);
      const [closeHour, closeMin] = todayHours.close_time.split(':').map(Number);
      const openTime = openHour * 60 + openMin;
      const closeTime = closeHour * 60 + closeMin;
      
      return currentTime >= openTime && currentTime < closeTime;
    };
    
    // Helper: check if character is asleep
    const isCharacterAsleep = (char) => {
      if (!char.sleep_start_time || !char.wake_up_time) return false;
      
      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();
      const [sleepHour, sleepMin] = char.sleep_start_time.split(':').map(Number);
      const [wakeHour, wakeMin] = char.wake_up_time.split(':').map(Number);
      const sleepTime = sleepHour * 60 + sleepMin;
      const wakeTime = wakeHour * 60 + wakeMin;
      
      // Handle overnight sleep
      if (sleepTime > wakeTime) {
        return currentTime >= sleepTime || currentTime < wakeTime;
      }
      return currentTime >= sleepTime && currentTime < wakeTime;
    };
    
    const invitations = selected
      .filter(char => !isCharacterAsleep(char)) // Skip if asleep
      .map(char => {
        const charHome = locations.find(l => l.id === char.current_home_location_id);
        const charWork = locations.find(l => l.id === char.occupation_location_id);
        
        // Social venues (places to "go out") that are open
        const socialVenues = locations.filter(l => 
          ['social', 'food_drink', 'gym', 'outdoor'].includes(l.category) &&
          isLocationOpen(l)
        );
        
        let inviteType, targetLocation;
        const rand = Math.random();
        
        // If character is at work (during work hours), invite to their workplace
        if (charWork && isLocationOpen(charWork)) {
          const [workStartHour, workStartMin] = (char.work_start_time || '09:00').split(':').map(Number);
          const [workEndHour, workEndMin] = (char.work_end_time || '17:00').split(':').map(Number);
          const now = new Date();
          const currentTime = now.getHours() * 60 + now.getMinutes();
          const workStart = workStartHour * 60 + workStartMin;
          const workEnd = workEndHour * 60 + workEndMin;
          
          if (currentTime >= workStart && currentTime < workEnd && rand < 0.4) {
            inviteType = 'goout';
            targetLocation = charWork;
          }
        }
        
        // Otherwise pick home or social venue
        if (!targetLocation) {
          if (rand < 0.35 && charHome) {
            inviteType = 'home';
            targetLocation = charHome;
          } else if (socialVenues.length > 0) {
            inviteType = 'goout';
            targetLocation = socialVenues[Math.floor(Math.random() * socialVenues.length)];
          } else if (charHome) {
            inviteType = 'home';
            targetLocation = charHome;
          } else {
            return null; // No valid location
          }
        }
        
        return {
          characterId: char.id,
          characterName: char.name,
          characterAvatar: char.avatar_url,
          inviteType,
          locationId: targetLocation.id,
          locationName: targetLocation.name,
          locationCategory: targetLocation.category,
        };
      })
      .filter(Boolean);

    return Response.json({ invitations });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});