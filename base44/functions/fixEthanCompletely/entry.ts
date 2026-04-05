import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const chars = await base44.entities.Character.filter({ created_by: user.email });
    const ethan = chars.find(c => c.name && c.name.toLowerCase().includes('ethan'));

    if (!ethan) {
      return Response.json({ error: 'Ethan not found' }, { status: 404 });
    }

    const fixes = [];

    // Fix 1: Remove Ethan from extra homes (keep only his primary home)
    const locations = await base44.entities.LocationReference.list();
    const ethanHomes = locations.filter(l => 
      l.resident_character_ids?.includes(ethan.id) || 
      l.resident_character_names?.includes(ethan.name)
    );

    // Keep only the primary home, remove from others
    const primaryHome = ethan.current_home_location_id;
    for (const home of ethanHomes) {
      if (home.id !== primaryHome) {
        const updatedResidents = (home.resident_character_ids || []).filter(id => id !== ethan.id);
        const updatedNames = (home.resident_character_names || []).filter(name => name !== ethan.name);
        await base44.entities.LocationReference.update(home.id, {
          resident_character_ids: updatedResidents,
          resident_character_names: updatedNames,
        });
        fixes.push(`Removed from duplicate home: ${home.name}`);
      }
    }

    // Fix 2: Add profile_summary if missing
    if (!ethan.profile_summary) {
      const summary = "Ethan is a charismatic, ambitious young man with a passion for personal growth. He's completing certifications and working at Anderson's Bar while maintaining strong relationships with those he cares about.";
      await base44.entities.Character.update(ethan.id, {
        profile_summary: summary,
      });
      fixes.push('Added profile_summary');
    }

    // Fix 3: Add backstory if missing
    if (!ethan.backstory) {
      const backstory = "Ethan grew up in a close-knit family and learned early on the value of hard work and ambition. He's been focused on building a successful life, working at Anderson's Bar while pursuing professional certifications. He values genuine connections and is known for his warmth and humor.";
      await base44.entities.Character.update(ethan.id, {
        backstory: backstory,
      });
      fixes.push('Added backstory');
    }

    // Fix 4: Add aliases if missing
    if (!ethan.aliases || ethan.aliases.length === 0) {
      const aliases = [
        {
          text: 'Ethan',
          normalized: 'ethan',
          type: 'short_name',
          user_confirmed: true,
        },
        {
          text: 'Thompson',
          normalized: 'thompson',
          type: 'family_role',
          user_confirmed: true,
        },
      ];
      await base44.entities.Character.update(ethan.id, {
        aliases: aliases,
      });
      fixes.push('Added aliases');
    }

    // Verify all fixes
    const verify = await base44.entities.Character.filter({ id: ethan.id });
    const updated = verify[0];
    const verifyHomes = locations.filter(l => 
      l.resident_character_ids?.includes(updated.id) || 
      l.resident_character_names?.includes(updated.name)
    );

    return Response.json({
      timestamp: new Date().toISOString(),
      character: updated.name,
      fixes,
      verification: {
        homeCount: verifyHomes.length,
        hasProfileSummary: !!updated.profile_summary,
        hasBackstory: !!updated.backstory,
        aliasCount: (updated.aliases || []).length,
      },
      status: 'FIXED',
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});