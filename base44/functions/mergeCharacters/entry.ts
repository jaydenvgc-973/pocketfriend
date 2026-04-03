import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * mergeCharacters - COMPLETE MERGE WITH FULL DATA CONSOLIDATION
 * 
 * Merge multiple characters into ONE primary character:
 * - Consolidates ALL memory, relationships, family, schedules, locations
 * - Remaps ALL dependent records (conversations, messages, etc.)
 * - DELETES all secondary characters after consolidation
 * - Creates CharacterAlias entries for merged names
 * - Creates CharacterMergeAudit
 * 
 * RESULT: Only ONE character remains with ALL consolidated data.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterIds, primaryCharacterId, conflictResolutions = {} } = await req.json();
    if (!characterIds || !Array.isArray(characterIds) || characterIds.length < 2) {
      return Response.json({ error: 'At least 2 characterIds required' }, { status: 400 });
    }

    // ─────────────────────────────────────────────────────────
    // FETCH ALL CHARACTERS & DATA
    // ─────────────────────────────────────────────────────────
    const chars = await Promise.all(
      characterIds.map(id => base44.asServiceRole.entities.Character.get(id))
    );

    const missingIds = chars.map((c, i) => c ? null : characterIds[i]).filter(Boolean);
    if (missingIds.length > 0) {
      return Response.json({ error: `Characters not found: ${missingIds.join(', ')}` }, { status: 404 });
    }

    // SELECT PRIMARY (always preserve active > created > other)
    let primary = primaryCharacterId 
      ? chars.find(c => c.id === primaryCharacterId)
      : recommendPrimary(chars);

    if (!primary) {
      return Response.json({ error: 'Invalid primary character ID' }, { status: 400 });
    }

    const secondaryIds = characterIds.filter(id => id !== primary.id);
    const secondaryChars = chars.filter(c => c.id !== primary.id);
    const oldNames = chars.map(c => c.name);

    // ─────────────────────────────────────────────────────────
    // CONSOLIDATE ALL DATA INTO PRIMARY
    // ─────────────────────────────────────────────────────────

    // Merge memory: combine all memories from secondaries
    const primaryMemories = (primary.fictional_relationships || []);
    const secondaryMemories = secondaryChars.flatMap(c => c.fictional_relationships || []);
    const mergedMemories = [...primaryMemories];
    
    for (const secMem of secondaryMemories) {
      const exists = mergedMemories.some(m => 
        m.person_name?.toLowerCase() === secMem.person_name?.toLowerCase()
      );
      if (!exists) {
        mergedMemories.push(secMem);
      }
    }

    // Merge family members
    const primaryFamily = (primary.family_members || []);
    const secondaryFamily = secondaryChars.flatMap(c => c.family_members || []);
    const mergedFamily = [...primaryFamily];
    
    for (const secFam of secondaryFamily) {
      const exists = mergedFamily.some(f => 
        f.name?.toLowerCase() === secFam.name?.toLowerCase()
      );
      if (!exists) {
        mergedFamily.push(secFam);
      }
    }

    // Merge life events
    const primaryEvents = (primary.departed_characters || []);
    const secondaryEvents = secondaryChars.flatMap(c => c.departed_characters || []);
    const mergedEvents = [...primaryEvents];
    
    for (const secEv of secondaryEvents) {
      const exists = mergedEvents.some(e => 
        e.name?.toLowerCase() === secEv.name?.toLowerCase()
      );
      if (!exists) {
        mergedEvents.push(secEv);
      }
    }

    // Merge songs heard
    const primarySongs = (primary.songs_heard || []);
    const secondarySongs = secondaryChars.flatMap(c => c.songs_heard || []);
    const songIds = new Set(primarySongs.map(s => s.spotify_id));
    const mergedSongs = [...primarySongs];
    
    for (const song of secondarySongs) {
      if (!songIds.has(song.spotify_id)) {
        mergedSongs.push(song);
        songIds.add(song.spotify_id);
      }
    }

    // Merge videos watched
    const primaryVideos = (primary.videos_watched || []);
    const secondaryVideos = secondaryChars.flatMap(c => c.videos_watched || []);
    const videoLinks = new Set(primaryVideos.map(v => v.link));
    const mergedVideos = [...primaryVideos];
    
    for (const video of secondaryVideos) {
      if (!videoLinks.has(video.link)) {
        mergedVideos.push(video);
        videoLinks.add(video.link);
      }
    }

    // Merge life goals
    const primaryGoals = (primary.future_life_goals || []);
    const secondaryGoals = secondaryChars.flatMap(c => c.future_life_goals || []);
    const mergedGoals = [...primaryGoals];
    
    for (const goal of secondaryGoals) {
      const exists = mergedGoals.some(g => 
        g.description?.toLowerCase() === goal.description?.toLowerCase()
      );
      if (!exists) {
        mergedGoals.push(goal);
      }
    }

    // Update primary with consolidated data
    await base44.asServiceRole.entities.Character.update(primary.id, {
      fictional_relationships: mergedMemories,
      family_members: mergedFamily,
      departed_characters: mergedEvents,
      songs_heard: mergedSongs,
      videos_watched: mergedVideos,
      future_life_goals: mergedGoals,
      name: conflictResolutions.display_name || primary.name,
    });

    // ─────────────────────────────────────────────────────────
    // REMAP ALL DEPENDENT RECORDS
    // ─────────────────────────────────────────────────────────

    // Remap conversations
    const convos = await base44.asServiceRole.entities.Conversation.filter({});
    for (const convo of convos) {
      const charIds = convo.character_ids || [];
      const updatedIds = charIds.map(id => 
        secondaryIds.includes(id) ? primary.id : id
      ).filter((v, i, a) => a.indexOf(v) === i);

      if (JSON.stringify(updatedIds) !== JSON.stringify(charIds)) {
        await base44.asServiceRole.entities.Conversation.update(convo.id, {
          character_ids: updatedIds,
        });
      }
    }

    // Remap messages
    const messages = await base44.asServiceRole.entities.Message.filter({});
    for (const msg of messages) {
      let needsUpdate = false;
      const updates = {};

      if (msg.character_id && secondaryIds.includes(msg.character_id)) {
        updates.character_id = primary.id;
        needsUpdate = true;
      }

      if (msg.played_as_character_id && secondaryIds.includes(msg.played_as_character_id)) {
        updates.played_as_character_id = primary.id;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await base44.asServiceRole.entities.Message.update(msg.id, updates);
      }
    }

    // Remap memories
    const memories = await base44.asServiceRole.entities.Memory.filter({});
    for (const mem of memories) {
      if (mem.character_id && secondaryIds.includes(mem.character_id)) {
        await base44.asServiceRole.entities.Memory.update(mem.id, {
          character_id: primary.id,
        });
      }
    }

    // Remap relationship states
    const relStates = await base44.asServiceRole.entities.RelationshipState.filter({});
    for (const rel of relStates) {
      if (rel.character_id && secondaryIds.includes(rel.character_id)) {
        await base44.asServiceRole.entities.RelationshipState.update(rel.id, {
          character_id: primary.id,
        });
      }
    }

    // Remap life events
    const lifeEvents = await base44.asServiceRole.entities.LifeEvent.filter({});
    for (const ev of lifeEvents) {
      if (ev.character_id && secondaryIds.includes(ev.character_id)) {
        await base44.asServiceRole.entities.LifeEvent.update(ev.id, {
          character_id: primary.id,
          character_name: primary.name,
        });
      }
    }

    // Remap pending messages
    const pendingMsgs = await base44.asServiceRole.entities.PendingMessage.filter({});
    for (const pm of pendingMsgs) {
      if (pm.character_id && secondaryIds.includes(pm.character_id)) {
        await base44.asServiceRole.entities.PendingMessage.update(pm.id, {
          character_id: primary.id,
        });
      }
    }

    // Remap scheduled events
    const schedEvents = await base44.asServiceRole.entities.ScheduledEvent.filter({});
    for (const se of schedEvents) {
      const charIds = se.character_ids || [];
      const updated = charIds.map(id => 
        secondaryIds.includes(id) ? primary.id : id
      ).filter((v, i, a) => a.indexOf(v) === i);

      if (JSON.stringify(updated) !== JSON.stringify(charIds)) {
        await base44.asServiceRole.entities.ScheduledEvent.update(se.id, {
          character_ids: updated,
          primary_character_id: primary.id,
        });
      }
    }

    // Remap autonomy events
    const autonomyEvents = await base44.asServiceRole.entities.CharacterAutonomyEvent.filter({});
    for (const ae of autonomyEvents) {
      if (ae.character_id && secondaryIds.includes(ae.character_id)) {
        await base44.asServiceRole.entities.CharacterAutonomyEvent.update(ae.id, {
          character_id: primary.id,
        });
      }
    }

    // ─────────────────────────────────────────────────────────
    // CREATE ALIASES FOR MERGED NAMES
    // ─────────────────────────────────────────────────────────
    for (const char of chars) {
      if (char.id !== primary.id) {
        await base44.asServiceRole.entities.CharacterAlias.create({
          character_id: primary.id,
          alias_name: char.name,
          source_type: 'merge',
          prior_primary: true,
        });
      }
    }

    // ─────────────────────────────────────────────────────────
    // CREATE MERGE AUDIT
    // ─────────────────────────────────────────────────────────
    await base44.asServiceRole.entities.CharacterMergeAudit.create({
      primary_character_id: primary.id,
      merged_character_ids: secondaryIds,
      old_names: oldNames,
      final_display_name: conflictResolutions.display_name || primary.name,
      conflict_resolution_snapshot: conflictResolutions,
    });

    // ─────────────────────────────────────────────────────────
    // DELETE SECONDARY CHARACTERS (permanent removal after consolidation)
    // ─────────────────────────────────────────────────────────
    for (const secondaryId of secondaryIds) {
      await base44.asServiceRole.entities.Character.delete(secondaryId);
    }

    return Response.json({
      success: true,
      primary_character_id: primary.id,
      primary_character_name: conflictResolutions.display_name || primary.name,
      merged_character_ids: secondaryIds,
      merged_names: oldNames.filter(n => n !== primary.name),
      message: `Merged ${secondaryIds.length} character(s) into "${conflictResolutions.display_name || primary.name}". All history consolidated. Secondary characters removed.`,
    });
  } catch (error) {
    console.error('[mergeCharacters]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * recommendPrimary
 * 
 * Identity priority when selecting which character remains after merge:
 * 1. Active Character (highest priority - always preserved over NPCs/fictional)
 * 2. Created Character (user-owned)
 * 3. Protected/Default
 * 4. Most recently updated
 * 
 * This ensures active versions are never replaced by NPC duplicates.
 */
function recommendPrimary(chars) {
  // Priority 1: Active character (never merge away active versions)
  let candidate = chars.find(c => c.is_active_character && c.character_type === 'active');
  if (candidate) return candidate;

  // Priority 2: User-created character
  candidate = chars.find(c => c.character_type === 'user_created');
  if (candidate) return candidate;

  // Priority 3: Protected or default (system-managed)
  candidate = chars.find(c => c.is_protected || c.is_default);
  if (candidate) return candidate;

  // Priority 4: Most recently updated
  return chars.reduce((latest, c) => {
    const latestTime = new Date(latest.updated_date || 0);
    const cTime = new Date(c.updated_date || 0);
    return cTime > latestTime ? c : latest;
  });
}