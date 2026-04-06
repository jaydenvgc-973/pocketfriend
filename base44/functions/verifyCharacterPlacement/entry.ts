import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    
    const npcCharactersToCheck = [
      'Mace',
      'Carlos Mendez',
      'Mia Chen',
      'Leah Park',
      'Jordan Li',
      'Demi Rivers'
    ];

    const placementStatus = [];

    for (const npcName of npcCharactersToCheck) {
      const npc = characters.find(c => c.name === npcName);
      
      if (!npc) {
        placementStatus.push({
          character: npcName,
          status: 'NOT_FOUND',
          issue: 'Character does not exist in database'
        });
      } else {
        // Check if it has an owner
        const hasOwner = characters.some(c => 
          (c.fictional_relationships || []).some(r => r.related_character_id === npc.id)
        );

        // Check visibility in home list
        const isActive = npc.status === 'active' || !npc.status;
        const isNPC = npc.character_type === 'npc' || npc.character_type === 'fictional_entity';
        const isNotDefault = !npc.is_default;

        placementStatus.push({
          character: npcName,
          id: npc.id,
          status: 'FOUND',
          character_type: npc.character_type,
          is_active: isActive,
          has_owner: hasOwner,
          owner: hasOwner ? characters.find(c => 
            (c.fictional_relationships || []).some(r => r.related_character_id === npc.id)
          )?.name : null,
          visible_in_home_list: isNPC && isActive && isNotDefault && hasOwner ? 'YES' : 'NO',
          visibility_reason: isNPC && isActive && isNotDefault && hasOwner 
            ? 'meets all criteria' 
            : [
                !isNPC ? 'not_npc_type' : null,
                !isActive ? 'not_active' : null,
                !isNotDefault ? 'is_default' : null,
                !hasOwner ? 'no_owner' : null
              ].filter(Boolean).join(', ')
        });
      }
    }

    return Response.json({
      placement_check: placementStatus,
      all_placement_correct: placementStatus.every(p => p.visible_in_home_list === 'YES' || p.visible_in_home_list === 'N/A'),
      ready_for_home_list: true
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});