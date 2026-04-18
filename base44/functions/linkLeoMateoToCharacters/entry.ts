import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const leoId = '69e2ac3276e99598733d00f4';
    const mateoId = '69e2adcd435862dcccb898a0';

    // Get all characters for the account to find their existing relationships
    const allChars = await base44.asServiceRole.entities.Character.filter({
      owner_email: 'adobevgc@gmail.com'
    });

    // Find Alden Spencer (Leo's friend from the old neighborhood - already found in earlier audit)
    const aldenChar = allChars.find(c => c.name === 'Alden Spencer');
    
    // Find Ken (Mateo's romantic interest - already found in earlier audit)
    const kenChar = allChars.find(c => c.name === 'Ken');

    const updates = [];

    // Add Leo to Alden's fictional_relationships if not already there
    if (aldenChar) {
      const aldenRels = aldenChar.fictional_relationships || [];
      const leoAlreadyLinked = aldenRels.some(r => r.related_character_id === leoId);
      
      if (!leoAlreadyLinked) {
        aldenRels.push({
          person_name: 'Leo Dent',
          related_character_id: leoId,
          relationship_type: 'Friend',
          description: "Leo's friend from the old neighborhood who didn't stick around",
          current_status: 'Known but distant',
          emotional_impact: 'Nostalgic memories',
          friendship_level: 60,
          user_respect_level: 50,
          romantic_level: 0,
          attraction_level: 0,
          chosen_family_level: 0,
        });
        
        await base44.asServiceRole.entities.Character.update(aldenChar.id, {
          fictional_relationships: aldenRels
        });
        updates.push(`Added Leo to Alden Spencer's fictional_relationships`);
      }
    }

    // Add Mateo to Ken's fictional_relationships if not already there
    if (kenChar) {
      const kenRels = kenChar.fictional_relationships || [];
      const mateoAlreadyLinked = kenRels.some(r => r.related_character_id === mateoId);
      
      if (!mateoAlreadyLinked) {
        kenRels.push({
          person_name: 'Mateo',
          related_character_id: mateoId,
          relationship_type: 'Romantic Interest',
          description: 'Mateo is someone Ken met on a dating app, indicating a romantic or potential romantic connection',
          current_status: 'Active connection',
          emotional_impact: 'Exciting prospect',
          friendship_level: 40,
          user_respect_level: 50,
          romantic_level: 70,
          attraction_level: 75,
          chosen_family_level: 0,
        });
        
        await base44.asServiceRole.entities.Character.update(kenChar.id, {
          fictional_relationships: kenRels
        });
        updates.push(`Added Mateo to Ken's fictional_relationships`);
      }
    }

    return Response.json({
      success: true,
      updates_applied: updates,
      alden_found: !!aldenChar,
      ken_found: !!kenChar,
      message: 'Leo and Mateo linked to their respective characters',
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});