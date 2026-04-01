import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// This function creates or ensures the NPC Hub location exists.
// It does NOT create Character records for NPCs or family members —
// those already exist within fictional_relationships and family_members arrays
// on real characters, and don't need duplicate Character entities.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Create or fetch NPC Hub location
    const existingHubs = await base44.asServiceRole.entities.LocationReference.filter(
      { created_by: user.email, name: 'NPC Hub' }
    );

    let npcHub;
    if (existingHubs.length > 0) {
      npcHub = existingHubs[0];
      console.log('[NPC-HUB] Using existing NPC Hub:', npcHub.id);
    } else {
      npcHub = await base44.asServiceRole.entities.LocationReference.create({
        name: 'NPC Hub',
        location_type: 'global',
        category: 'generic',
        description: 'Central location where NPCs and fictional characters reside. These are people who exist in the world but are referenced through character relationships, not as separate character records.',
        is_default_generic: false,
        owner_is_npc: true,
        owner_npc_name: 'The World',
        owner_role: 'keeper',
        resident_character_ids: [],
        resident_character_names: [],
        zones: [
          { zone_name: 'Main Area', image_urls: [] },
        ],
      });
      console.log('[NPC-HUB] Created new NPC Hub:', npcHub.id);
    }

    return Response.json({
      success: true,
      npcHubId: npcHub.id,
      npcHubName: npcHub.name,
      message: 'NPC Hub ready. NPCs are managed through character relationship arrays, not as separate Character records.',
    });
  } catch (error) {
    console.error('[createNpcHubAndPlaceFamilies]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});