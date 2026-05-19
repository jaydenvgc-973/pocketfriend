import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FIX CORRUPTED HOME LOCATION IDS
 *
 * The audit found that Larry, Vanessa, Marisol, Sarah, Stephanie have
 * current_home_location_id = VGC Towers ID, but they are also listed
 * as resident_family_members of Ethan's Family Home.
 *
 * This is data corruption. Their true home should be Ethan's Family Home.
 * This function corrects their home IDs.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const corruptedNames = [
      'Larry',
      'Vanessa', 
      'Marisol',
      'Sarah',
      'Stephanie',
    ];

    // Load all data
    const [characters, locations] = await Promise.all([
      base44.entities.Character.filter({ status: 'active' }, null, 500),
      base44.entities.LocationReference.filter({ owner_email: user.email }, null, 300),
    ]);

    const vgcTowers = locations.find(l => l.name === 'VGC Towers');
    const ethanHome = locations.find(l =>
      l.name === "Ethan's Family Home" || l.name === "Ethan Thompson's Home"
    );

    if (!ethanHome) {
      return Response.json({ error: "Ethan's Family Home not found" }, { status: 400 });
    }

    const fixes = [];

    for (const name of corruptedNames) {
      const char = characters.find(c =>
        c.name?.toLowerCase().trim() === name.toLowerCase().trim()
      );

      if (!char) {
        fixes.push({ name, found: false });
        continue;
      }

      // If already correct home, skip
      if (char.current_home_location_id === ethanHome.id) {
        fixes.push({ name, id: char.id, action: 'already_correct' });
        continue;
      }

      // Fix the home ID
      const now = new Date().toISOString();
      await base44.entities.Character.update(char.id, {
        current_home_location_id: ethanHome.id,
        resolved_current_location_id: ethanHome.id,
        resolved_current_location_name: ethanHome.name,
        resolved_presence_status: 'home',
        resolved_location_type: 'home',
        resolved_source_reason: 'fixed_corrupted_home_id',
        last_location_update_time: now,
      });

      fixes.push({
        name,
        id: char.id,
        action: 'fixed',
        from_home: vgcTowers?.name || 'VGC Towers',
        to_home: ethanHome.name,
      });
    }

    return Response.json({
      success: true,
      vgc_towers_id: vgcTowers?.id,
      ethan_home_id: ethanHome?.id,
      fixes,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});