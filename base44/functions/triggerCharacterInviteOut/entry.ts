import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get 1-3 random active characters
    const characters = await base44.entities.Character.filter({
      created_by: user.email,
      status: 'active',
    });

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
    
    const invitations = selected.map(char => {
      const charHome = locations.find(l => l.id === char.current_home_location_id);
      const charWork = locations.find(l => l.id === char.occupation_location_id);
      
      // Social venues (places to "go out")
      const socialVenues = locations.filter(l => 
        ['social', 'food_drink', 'gym', 'outdoor'].includes(l.category)
      );
      
      // Decide invite type based on character preference
      const rand = Math.random();
      let inviteType, targetLocation;
      
      if (rand < 0.4 && charHome) {
        // 40%: invite to their home
        inviteType = 'home';
        targetLocation = charHome;
      } else if (rand < 0.7 && charWork) {
        // 30%: invite to their workplace (meet them there)
        inviteType = 'goout';
        targetLocation = charWork;
      } else {
        // 30%: invite to a social venue
        inviteType = 'goout';
        targetLocation = socialVenues.length > 0 
          ? socialVenues[Math.floor(Math.random() * socialVenues.length)]
          : locations[Math.floor(Math.random() * locations.length)];
      }

      return {
        characterId: char.id,
        characterName: char.name,
        characterAvatar: char.avatar_url,
        inviteType, // 'home' or 'goout'
        locationId: targetLocation.id,
        locationName: targetLocation.name,
        locationCategory: targetLocation.category,
      };
    });

    return Response.json({ invitations });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});