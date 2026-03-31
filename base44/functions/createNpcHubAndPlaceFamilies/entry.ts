import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ── STEP 1: Create or fetch NPC Hub location ─────────────────────────────
    let npcHub = null;
    const existingHubs = await base44.asServiceRole.entities.LocationReference.filter(
      { created_by: user.email, name: 'NPC Hub' }
    );

    if (existingHubs.length > 0) {
      npcHub = existingHubs[0];
      console.log('[NPC-HUB] Using existing NPC Hub');
    } else {
      npcHub = await base44.asServiceRole.entities.LocationReference.create({
        name: 'NPC Hub',
        location_type: 'global',
        category: 'other',
        description: 'Central location where NPCs, fictional characters, and non-playable family members reside. Characters can be moved to live with active characters as needed.',
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

    const results = {
      npcHub: {
        id: npcHub.id,
        name: npcHub.name,
        initialResidents: npcHub.resident_character_ids?.length || 0,
      },
      familyMembersPlaced: 0,
      fictionCharactersPlaced: 0,
      errors: [],
    };

    // ── STEP 2: For each character, place non-playable family members in hub ──
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email, status: 'active' }
    );

    for (const char of allChars) {
      // Extract family member names from family_members array
      if (char.family_members && Array.isArray(char.family_members) && char.family_members.length > 0) {
        for (const member of char.family_members) {
          if (!member.name?.trim()) continue;

          // Check if this family member already exists as a character
          const existingFamilyChar = await base44.asServiceRole.entities.Character.filter({
            created_by: user.email,
            name: member.name,
          }).catch(() => []);

          if (existingFamilyChar.length === 0) {
            // Create a minimal non-playable character for this family member
            try {
              const familyCharacter = await base44.asServiceRole.entities.Character.create({
                name: member.name,
                nickname_for_user: member.name,
                gender: 'other',
                age_range: 'adult',
                status: 'active',
                is_finalized: true,
                background: `Non-playable family member of ${char.name}. Relationship: ${member.relationship_type || 'family'}.`,
                personality_summary: `Family member related to ${char.name}.`,
                system_prompt: `You are ${member.name}, a non-playable character in this world. You are ${member.relationship_type || 'family'} of ${char.name}. You exist in the world but are not controlled by the user. Respond naturally when the user or other characters interact with you.`,
              });

              // Add to NPC Hub as resident
              const updatedHub = await base44.asServiceRole.entities.LocationReference.get(npcHub.id);
              const newResidents = Array.from(new Set([
                ...(updatedHub.resident_character_ids || []),
                familyCharacter.id,
              ]));
              const newResidentNames = Array.from(new Set([
                ...(updatedHub.resident_character_names || []),
                familyCharacter.name,
              ]));

              await base44.asServiceRole.entities.LocationReference.update(npcHub.id, {
                resident_character_ids: newResidents,
                resident_character_names: newResidentNames,
              });

              // Create financial record for family member
              await base44.asServiceRole.entities.CharacterFinancial.create({
                character_id: familyCharacter.id,
                character_name: familyCharacter.name,
                home_location_id: npcHub.id,
                home_location_name: npcHub.name,
                is_homeless: false,
                total_income: 0,
                total_expenses: 0,
                current_balance: 0,
                income_sources: [],
                expense_sources: [],
                last_updated: new Date().toISOString(),
              }).catch(() => {});

              results.familyMembersPlaced++;
            } catch (err) {
              results.errors.push({
                type: 'family_member_creation',
                characterName: char.name,
                familyMemberName: member.name,
                error: err.message,
              });
            }
          }
        }
      }

      // Place fictional relationships (known NPCs) in hub if not already assigned a home
      if (char.fictional_relationships && Array.isArray(char.fictional_relationships)) {
        for (const rel of char.fictional_relationships) {
          if (!rel.person_name?.trim()) continue;

          // Check if this fictional character exists
          const existingFictional = await base44.asServiceRole.entities.Character.filter({
            created_by: user.email,
            name: rel.person_name,
          }).catch(() => []);

          if (existingFictional.length === 0) {
            // Create minimal non-playable character
            try {
              const fictionalChar = await base44.asServiceRole.entities.Character.create({
                name: rel.person_name,
                nickname_for_user: rel.person_name,
                gender: 'other',
                age_range: 'adult',
                status: 'active',
                is_finalized: true,
                background: `${rel.relationship_type || 'acquaintance'} of ${char.name}. ${rel.description || ''}`,
                personality_summary: rel.description || `A character in the world known to ${char.name}.`,
                system_prompt: `You are ${rel.person_name}, a non-playable character. You know ${char.name} as a ${rel.relationship_type || 'acquaintance'}. Respond naturally when interacting with the user or other characters.`,
              });

              // Add to NPC Hub
              const updatedHub = await base44.asServiceRole.entities.LocationReference.get(npcHub.id);
              const newResidents = Array.from(new Set([
                ...(updatedHub.resident_character_ids || []),
                fictionalChar.id,
              ]));
              const newResidentNames = Array.from(new Set([
                ...(updatedHub.resident_character_names || []),
                fictionalChar.name,
              ]));

              await base44.asServiceRole.entities.LocationReference.update(npcHub.id, {
                resident_character_ids: newResidents,
                resident_character_names: newResidentNames,
              });

              // Create financial record
              await base44.asServiceRole.entities.CharacterFinancial.create({
                character_id: fictionalChar.id,
                character_name: fictionalChar.name,
                home_location_id: npcHub.id,
                home_location_name: npcHub.name,
                is_homeless: false,
                total_income: 0,
                total_expenses: 0,
                current_balance: 0,
                income_sources: [],
                expense_sources: [],
                last_updated: new Date().toISOString(),
              }).catch(() => {});

              results.fictionCharactersPlaced++;
            } catch (err) {
              results.errors.push({
                type: 'fictional_character_creation',
                characterName: char.name,
                fictionalName: rel.person_name,
                error: err.message,
              });
            }
          }
        }
      }
    }

    return Response.json({
      success: true,
      results,
      npcHubId: npcHub.id,
      npcHubName: npcHub.name,
    });
  } catch (error) {
    console.error('[createNpcHubAndPlaceFamilies]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});