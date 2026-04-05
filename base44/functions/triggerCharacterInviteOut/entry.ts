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

    // Get all locations and pick random ones
    const locations = await base44.entities.LocationReference.list();
    const invitations = selected.map(char => {
      // Character can invite to a location they know (home, work, or any random location)
      const charHome = locations.find(l => l.id === char.current_home_location_id);
      const charWork = locations.find(l => l.id === char.occupation_location_id);
      
      // Prefer home or work, otherwise random
      const inviteLocation = charHome || charWork || locations[Math.floor(Math.random() * locations.length)];
      
      // 50/50 chance: invite to location or to their home
      const inviteType = Math.random() > 0.5 ? 'location' : 'home';
      const targetLocation = inviteType === 'home' && charHome ? charHome : inviteLocation;

      return {
        characterId: char.id,
        characterName: char.name,
        characterAvatar: char.avatar_url,
        inviteType, // 'home' or 'location'
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