import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * addNPCRelationships
 *
 * Creates real NPC Character records for named people and links them
 * to the specified active characters via fictional_relationships.
 *
 * Each NPC gets a full Character entity — never a name-only label.
 * Calls ensureUserVGCTowers ONCE upfront, then creates NPCs inline (no nested function chains).
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ── STEP 1: Get user's VGC Towers once ───────────────────────────────────
    const [vgcByCreated, vgcByOwner] = await Promise.all([
      base44.entities.LocationReference.filter({ created_by: user.email, name: 'VGC Towers', scope: { $ne: 'shared' } }),
      base44.entities.LocationReference.filter({ owner_email: user.email, name: 'VGC Towers', scope: { $ne: 'shared' } }),
    ]);
    const seenVGC = new Set();
    const vgcInstances = [...vgcByCreated, ...vgcByOwner].filter(l => {
      if (seenVGC.has(l.id)) return false;
      seenVGC.add(l.id);
      return true;
    });
    const vgcTowersId = vgcInstances[0]?.id || null;

    // ── STEP 2: Get all characters for this user ──────────────────────────────
    const [charsByCreated, charsByOwner] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email }),
      base44.entities.Character.filter({ owner_email: user.email }),
    ]);
    const seenChars = new Set();
    const characters = [...charsByCreated, ...charsByOwner].filter(c => {
      if (seenChars.has(c.id)) return false;
      seenChars.add(c.id);
      return c.status !== 'deleted' && c.status !== 'soft_deleted';
    });

    // ── STEP 3: Define relationships to ensure ────────────────────────────────
    const relationships = {
      'Ava Dei Park': ['Mia Chen', 'Leah Park', 'Jordan Li'],
      'Matt Lopez': ['Carlos Mendez'],
      'Ethan Nathan Thompson': ['Mace'],
      'Jonathan Anthony  Smith': ['Demi Rivers'],
    };

    const results = {};

    for (const [charName, npcNames] of Object.entries(relationships)) {
      const character = characters.find(c => c.name === charName);
      if (!character) {
        results[charName] = { status: 'not_found' };
        continue;
      }

      // ── BOUNDARY CHECK — Test Character Safety Addendum ──────────────────
      // The target character is the one receiving NPC relationship links. If
      // it is classified as a test character, skip ALL relationship writes for
      // it — the NPCs created here have is_test_character=false, so linking
      // them to a test target would create test-to-non-test contamination.
      // This is an inline condition within the existing write-owning function.
      if (character.is_test_character === true) {
        console.warn(`[addNPCRelationships] BLOCKED test-character relationship links: "${charName}" (test=true)`);
        results[charName] = { status: 'skipped_test_character' };
        continue;
      }

      const currentRels = character.fictional_relationships || [];
      const existingIds = new Set(currentRels.filter(r => r.related_character_id).map(r => r.related_character_id));
      const existingNameSet = new Set(currentRels.map(r => r.person_name?.toLowerCase()));

      const added = [];
      const skipped = [];
      const newRels = [...currentRels];

      for (const npcName of npcNames) {
        if (existingNameSet.has(npcName.toLowerCase())) {
          skipped.push(npcName);
          continue;
        }

        // Check if a Character record already exists for this NPC under this user
        const existingNPC = characters.find(c => {
          if (existingIds.has(c.id)) return false;
          if (!['npc_fictitious', 'npc_fictitious_person', 'npc_regular', 'npc_family_member'].includes(c.character_type)) return false;
          return c.name?.toLowerCase() === npcName.toLowerCase();
        });

        let npcId = existingNPC?.id || null;

        // If no existing Character, create one inline
        if (!npcId) {
          const now = new Date().toISOString();
          try {
            const newNPC = await base44.entities.Character.create({
              name: npcName,
              primary_name: npcName,
              display_name: npcName,
              character_type: 'npc_fictitious',
              status: 'active',
              owner_email: user.email,
              owner_user_id: user.id,
              created_by_role: user.role || 'user',
              data_scope: 'private_user',
              visibility_scope: 'shared_npc',
              is_active_character: false,
              exclude_from_homepage: true,
              exclude_from_roster: false,
              is_test_character: false,
              diagnostic_only: false,
              travel_status: 'not_traveling',
              location_status: 'home',
              location_visibility_state: 'visible',
              last_location_update_time: now,
              ...(vgcTowersId ? {
                current_home_location_id: vgcTowersId,
                resolved_current_location_id: vgcTowersId,
                resolved_current_location_name: 'VGC Towers',
                resolved_location_type: 'home',
                resolved_presence_status: 'home',
                resolved_source_reason: 'npc_created',
                resolved_last_updated_at: now,
              } : {}),
            });
            npcId = newNPC.id;

            // Add to VGC Towers resident list
            if (vgcTowersId) {
              const vgcLoc = vgcInstances[0];
              if (vgcLoc) {
                const residentIds = Array.from(new Set([...(vgcLoc.resident_character_ids || []), npcId]));
                const residentNames = Array.from(new Set([...(vgcLoc.resident_character_names || []), npcName]));
                await base44.entities.LocationReference.update(vgcTowersId, {
                  resident_character_ids: residentIds,
                  resident_character_names: residentNames,
                });
                // Keep local VGC ref in sync so subsequent iterations see the updated list
                vgcInstances[0].resident_character_ids = residentIds;
                vgcInstances[0].resident_character_names = residentNames;
              }
            }
          } catch (createErr) {
            console.error(`[addNPCRelationships] Failed to create NPC "${npcName}":`, createErr.message);
            continue;
          }
        }

        // Add relationship entry with real related_character_id
        newRels.push({
          person_name: npcName,
          related_character_id: npcId,
          relationship_type: 'acquaintance',
          description: '',
          current_status: 'active',
          emotional_impact: 'neutral',
          last_interaction_summary: '',
          history_summary: '',
          avatar_url: null,
          user_respect_level: 50,
          friendship_level: 50,
          romantic_level: 0,
          attraction_level: 0,
          chosen_family_level: 0,
        });
        existingNameSet.add(npcName.toLowerCase());
        existingIds.add(npcId);
        added.push(npcName);
      }

      // Save updated fictional_relationships back to the character
      if (added.length > 0) {
        await base44.entities.Character.update(character.id, { fictional_relationships: newRels });
      }

      results[charName] = { status: 'processed', added, skipped };
    }

    return Response.json({ success: true, results });
  } catch (error) {
    console.error('[addNPCRelationships]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});