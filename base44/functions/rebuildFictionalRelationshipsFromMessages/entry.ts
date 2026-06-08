import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * rebuildFictionalRelationshipsFromMessages
 *
 * SCOPE: Legacy migration / recovery tool only.
 *
 * PURPOSE:
 *   Adds relationship entries derived from message history for characters
 *   that have NO existing fictional_relationships at all (empty or missing array).
 *   This is a one-time recovery path for characters whose relationship data
 *   was lost or never set — NOT a routine enrichment pass.
 *
 * HARD EXCLUSIONS (never modified by this function):
 *   1. npc_world_service characters (Vick Servicio) — their contact lists are
 *      intentionally managed and must never be derived from message parsing.
 *   2. Any character that already has fictional_relationships entries — the
 *      canonical list is authoritative; reconstruction does not override it.
 *   3. Characters with character_type: 'npc_fictitious' — they are contact
 *      targets, not relationship owners that need reconstruction.
 *
 * Message parsing is NOT authoritative for relationship data.
 * It is a last-resort recovery tool for genuinely empty lists only.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all characters — will be filtered strictly below
    const characters = await base44.asServiceRole.entities.Character.filter({
      created_by: user.email,
      status: 'active'
    });

    // ── HARD EXCLUSION FILTER ─────────────────────────────────────────────────
    // Characters that must NEVER be processed by message reconstruction:
    //   1. npc_world_service — intentionally managed contact lists (Vick Servicio et al.)
    //   2. Any character that already has fictional_relationships entries — canonical is authoritative.
    //   3. npc_fictitious — they are contact targets, not relationship owners.
    //
    // Only characters with character_type 'active_created_character' or 'npc_regular' that
    // have a genuinely empty fictional_relationships array are eligible for reconstruction.
    const eligibleCharacters = characters.filter(c => {
      // Exclude world-service characters — their lists are intentionally managed, never reconstructed
      if (c.character_type === 'npc_world_service' || c.is_world_service === true) {
        console.log(`[rebuildFictionalRelationshipsFromMessages] EXCLUDED (world_service): ${c.name} (${c.id})`);
        return false;
      }
      // Exclude fictitious NPCs — they are contact targets, not owners
      if (c.character_type === 'npc_fictitious') return false;
      // Exclude any character that already has canonical relationship data
      // Reconstruction is only a last-resort recovery for genuinely empty lists
      if (Array.isArray(c.fictional_relationships) && c.fictional_relationships.length > 0) {
        console.log(`[rebuildFictionalRelationshipsFromMessages] EXCLUDED (has_existing_rels=${c.fictional_relationships.length}): ${c.name} (${c.id})`);
        return false;
      }
      return true;
    });

    console.log(`[rebuildFictionalRelationshipsFromMessages] Total characters: ${characters.length} | Eligible for reconstruction: ${eligibleCharacters.length}`);

    if (eligibleCharacters.length === 0) {
      return Response.json({
        success: true,
        message: 'No characters require reconstruction — all eligible characters already have canonical relationship data.',
        charactersProcessed: 0,
        excluded: characters.length,
      });
    }

    // Get all messages
    const messages = await base44.asServiceRole.entities.Message.list();

    // Get all character memories
    const memories = await base44.asServiceRole.entities.CharacterMemory.list();

    // Map all character names to IDs for linking
    const charNameToId = {};
    characters.forEach(c => {
      charNameToId[c.name?.toLowerCase()] = c.id;
    });

    // For each ELIGIBLE character, find who they interacted with
    const characterNetworks = {};

    eligibleCharacters.forEach(char => {
      characterNetworks[char.id] = new Map(); // name -> relationship data
    });

    // Extract from messages: who messaged whom
    messages.forEach(msg => {
      if (msg.character_id && msg.character_name) {
        const sourceId = msg.character_id;
        
        // Parse message content for character mentions
        const content = msg.content?.toLowerCase() || '';
        
        // Find other character names mentioned
        characters.forEach(otherChar => {
          if (otherChar.id !== sourceId) {
            const otherNameLower = otherChar.name?.toLowerCase();
            if (otherNameLower && content.includes(otherNameLower)) {
              if (!characterNetworks[sourceId].has(otherChar.id)) {
                characterNetworks[sourceId].set(otherChar.id, {
                  person_name: otherChar.name,
                  related_character_id: otherChar.id,
                  relationship_type: 'acquaintance',
                  description: '',
                  friendship_level: 50,
                  trust_level: 50,
                  attraction_level: 0,
                  respect_level: 50
                });
              }
            }
          }
        });
      }
    });

    // Extract from memories: who characters know
    memories.forEach(mem => {
      if (mem.character_id && mem.memory_type === 'relationship') {
        const sourceId = mem.character_id;
        if (mem.related_character_id) {
          const relatedChar = characters.find(c => c.id === mem.related_character_id);
          if (relatedChar && relatedChar.id !== sourceId) {
            if (!characterNetworks[sourceId].has(mem.related_character_id)) {
              characterNetworks[sourceId].set(mem.related_character_id, {
                person_name: relatedChar.name,
                related_character_id: mem.related_character_id,
                relationship_type: 'friend',
                description: mem.memory_text || '',
                friendship_level: 75,
                trust_level: 60,
                attraction_level: 0,
                respect_level: 50
              });
            }
          }
        }
      }
    });

    // Apply updates to each ELIGIBLE character — MERGE only, never replace.
    // Only adds entries for characters not already in the canonical DB list.
    // Fetches fresh from DB immediately before write to prevent race conditions.
    let updatedCount = 0;
    for (const char of eligibleCharacters) {
      const network = characterNetworks[char.id];
      if (network.size === 0) continue;

      // Fresh read immediately before write — prevents race condition with concurrent writes
      const freshArr = await base44.asServiceRole.entities.Character.filter({ id: char.id }).catch(() => []);
      const freshChar = freshArr[0];
      if (!freshChar) continue;

      const currentRels = freshChar.fictional_relationships || [];
      const existingIds = new Set(currentRels.map(r => r.related_character_id).filter(Boolean));

      // Only add entries for characters not already in the canonical list
      const newEntries = Array.from(network.values()).filter(
        entry => entry.related_character_id && !existingIds.has(entry.related_character_id)
      );

      if (newEntries.length === 0) continue; // Nothing to add — canonical list is authoritative

      await base44.asServiceRole.entities.Character.update(char.id, {
        fictional_relationships: [...currentRels, ...newEntries],
      });
      updatedCount++;
    }

    return Response.json({
      success: true,
      message: `Reconstructed fictional_relationships for ${updatedCount} eligible characters (${characters.length - eligibleCharacters.length} excluded: world_service, fictitious, or already had canonical data).`,
      charactersProcessed: updatedCount,
      eligible: eligibleCharacters.length,
      excluded: characters.length - eligibleCharacters.length,
    });
  } catch (error) {
    console.error('Rebuild error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});