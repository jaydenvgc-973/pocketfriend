import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    
    const fixes = [];

    // FIX 1: Matt Lopez has old broken relationship IDs pointing to deleted characters
    // Remove those old ones (Mace, Leah, Mia with wrong IDs)
    const matt = characters.find(c => c.name === 'Matt Lopez');
    if (matt) {
      const mattRels = matt.fictional_relationships || [];
      // Keep only relationships that have valid related_character_id pointing to existing characters
      const validRels = mattRels.filter(rel => {
        if (!rel.related_character_id) return false;
        const targetChar = characters.find(c => c.id === rel.related_character_id);
        return !!targetChar;
      });

      await base44.entities.Character.update(matt.id, {
        fictional_relationships: validRels
      });
      fixes.push({
        character: 'Matt Lopez',
        action: 'Removed broken relationships pointing to non-existent characters',
        count: mattRels.length - validRels.length
      });
    }

    // FIX 2: Ava has Mia Chen with missing related_character_id
    // Find the newly created Mia Chen and link her
    const ava = characters.find(c => c.name === 'Ava Dei Park');
    const miaChen = characters.find(c => c.name === 'Mia Chen');
    const leahPark = characters.find(c => c.name === 'Leah Park');
    const jordanLi = characters.find(c => c.name === 'Jordan Li');

    if (ava && miaChen) {
      const avaRels = ava.fictional_relationships || [];
      // Remove old broken Mia entry
      const updatedRels = avaRels.filter(r => r.person_name !== 'Mia Chen');
      // Add correct one with valid ID
      updatedRels.push({
        person_name: 'Mia Chen',
        relationship_type: 'friend',
        related_character_id: miaChen.id,
        description: 'Friend',
        current_status: 'close'
      });

      if (leahPark) {
        updatedRels.push({
          person_name: 'Leah Park',
          relationship_type: 'friend',
          related_character_id: leahPark.id,
          description: 'Friend',
          current_status: 'close'
        });
      }

      if (jordanLi) {
        updatedRels.push({
          person_name: 'Jordan Li',
          relationship_type: 'friend',
          related_character_id: jordanLi.id,
          description: 'Friend',
          current_status: 'close'
        });
      }

      await base44.entities.Character.update(ava.id, {
        fictional_relationships: updatedRels
      });

      fixes.push({
        character: 'Ava Dei Park',
        action: 'Fixed relationship links for Mia Chen, Leah Park, Jordan Li',
        count: 3
      });
    }

    // FIX 3: Matt should have proper link to newly created Carlos Mendez
    if (matt) {
      const carlos = characters.find(c => c.name === 'Carlos Mendez');
      const mattRels = matt.fictional_relationships || [];
      
      // Check if Carlos is already there
      const hasCarlos = mattRels.some(r => r.person_name === 'Carlos Mendez' && r.related_character_id === carlos?.id);
      
      if (!hasCarlos && carlos) {
        mattRels.push({
          person_name: 'Carlos Mendez',
          relationship_type: 'best_friend',
          related_character_id: carlos.id,
          description: 'Best friend',
          current_status: 'close'
        });

        await base44.entities.Character.update(matt.id, {
          fictional_relationships: mattRels
        });

        fixes.push({
          character: 'Matt Lopez',
          action: 'Added proper link to Carlos Mendez',
          count: 1
        });
      }
    }

    return Response.json({
      fixes_applied: fixes,
      total_fixes: fixes.length,
      next_step: 'Run verification diagnostic'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});