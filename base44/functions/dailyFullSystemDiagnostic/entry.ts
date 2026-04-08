import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Use service role for scheduled/diagnostic operations
    const results = {
      timestamp: new Date().toISOString(),
      runs: [],
      summary: {}
    };

    const log = (label, data) => {
      results.runs.push({ label, data, at: new Date().toISOString() });
      console.log(`[DIAG] ${label}:`, JSON.stringify(data).slice(0, 300));
    };

    // ─── PHASE 1: Core System Health ───────────────────────────────────────────

    // 1a. Load all characters
    const characters = await base44.asServiceRole.entities.Character.list();
    log('characters_loaded', { count: characters.length });

    // 1b. Load all locations
    const locations = await base44.asServiceRole.entities.LocationReference.list();
    log('locations_loaded', { count: locations.length });

    // 1c. Load all conversations
    const conversations = await base44.asServiceRole.entities.Conversation.list();
    log('conversations_loaded', { count: conversations.length });

    // 1d. Load all memories
    const memories = await base44.asServiceRole.entities.CharacterMemory.list();
    log('memories_loaded', { count: memories.length });

    // 1e. Load all messages (capped)
    const messages = await base44.asServiceRole.entities.Message.list('-created_date', 500);
    log('messages_sample_loaded', { count: messages.length });

    // ─── PHASE 2: Page-level Diagnostic Checks ─────────────────────────────────

    // HOME PAGE DIAGNOSTIC
    const homeCheck = {
      characters_with_no_home: characters.filter(c => !c.current_home_location_id).map(c => c.name),
      characters_with_broken_home: characters.filter(c =>
        c.current_home_location_id && !locations.find(l => l.id === c.current_home_location_id)
      ).map(c => c.name),
      characters_with_no_avatar: characters.filter(c => !c.avatar_url && !c.image_avatar_url).map(c => c.name),
      characters_asleep_count: characters.filter(c => {
        if (!c.wake_up_time || !c.sleep_start_time) return false;
        const now = new Date();
        const hour = now.getHours();
        const sleepHour = parseInt(c.sleep_start_time.split(':')[0]);
        const wakeHour = parseInt(c.wake_up_time.split(':')[0]);
        if (sleepHour > wakeHour) return hour >= sleepHour || hour < wakeHour;
        return hour >= sleepHour && hour < wakeHour;
      }).length,
    };
    log('home_page_diagnostic', homeCheck);

    // TRAVEL PAGE DIAGNOSTIC
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));
    const travelCheck = {
      total_locations: locations.length,
      locations_with_no_category: locations.filter(l => !l.category).map(l => l.name),
      locations_with_broken_residents: locations
        .filter(l => l.resident_character_ids?.length > 0)
        .filter(l => l.resident_character_ids.some(id => !characters.find(c => c.id === id)))
        .map(l => l.name),
      characters_with_invalid_home_id: characters
        .filter(c => c.current_home_location_id && !locationMap[c.current_home_location_id])
        .map(c => ({ name: c.name, bad_id: c.current_home_location_id })),
      characters_with_invalid_work_id: characters
        .filter(c => c.current_work_location_id && !locationMap[c.current_work_location_id])
        .map(c => ({ name: c.name, bad_id: c.current_work_location_id })),
    };
    log('travel_page_diagnostic', travelCheck);

    // CREATE PAGE DIAGNOSTIC
    const createCheck = {
      duplicate_names: (() => {
        const names = characters.map(c => (c.name || '').toLowerCase().trim());
        return names.filter((n, i) => names.indexOf(n) !== i);
      })(),
      characters_missing_gender: characters.filter(c => !c.gender).map(c => c.name),
      characters_missing_personality: characters.filter(c => !c.personality_summary && !c.profile_summary).map(c => c.name),
      characters_not_finalized: characters.filter(c => !c.is_finalized).map(c => c.name),
    };
    log('create_page_diagnostic', createCheck);

    // LOCATIONS PAGE DIAGNOSTIC
    const locationsCheck = {
      homes_count: locations.filter(l => l.category === 'home').length,
      workplaces_count: locations.filter(l => l.category === 'workplace').length,
      locations_missing_name: locations.filter(l => !l.name).length,
      locations_with_worker_mismatches: locations
        .filter(l => (l.worker_character_ids || []).some(id => !characters.find(c => c.id === id)))
        .map(l => l.name),
      locations_with_no_images: locations.filter(l =>
        (!l.image_urls || l.image_urls.length === 0) &&
        (!l.zones || !l.zones.some(z => z.image_urls?.length > 0))
      ).map(l => l.name),
    };
    log('locations_page_diagnostic', locationsCheck);

    // MOMENTS PAGE DIAGNOSTIC
    const momentsCheck = {
      characters_with_memories: [...new Set(memories.map(m => m.character_id))].length,
      avg_memories_per_character: characters.length > 0 ? (memories.length / characters.length).toFixed(1) : 0,
      memories_missing_type: memories.filter(m => !m.memory_type).length,
      memories_with_orphaned_character: memories.filter(m => !characters.find(c => c.id === m.character_id)).length,
    };
    log('moments_page_diagnostic', momentsCheck);

    // SETTINGS PAGE DIAGNOSTIC
    const settingsCheck = {
      characters_with_no_voice: characters.filter(c => c.voice_enabled === false).map(c => c.name),
      characters_missing_schedule: characters.filter(c => !c.sleep_start_time || !c.wake_up_time).map(c => c.name),
      characters_with_invalid_status: characters.filter(c =>
        !['active', 'moved_away', 'deleted', 'soft_deleted', 'merged'].includes(c.status)
      ).map(c => c.name),
    };
    log('settings_page_diagnostic', settingsCheck);

    // ─── PHASE 3: Fix Stale Location References ─────────────────────────────────

    let staleLocationFixes = 0;
    const staleFixDetails = [];

    for (const char of characters) {
      const updates = {};

      if (char.current_home_location_id && !locationMap[char.current_home_location_id]) {
        updates.current_home_location_id = null;
        staleFixDetails.push({ character: char.name, field: 'current_home_location_id', bad_id: char.current_home_location_id });
      }
      if (char.current_work_location_id && !locationMap[char.current_work_location_id]) {
        updates.current_work_location_id = null;
        staleFixDetails.push({ character: char.name, field: 'current_work_location_id', bad_id: char.current_work_location_id });
      }
      if (char.current_school_location_id && !locationMap[char.current_school_location_id]) {
        updates.current_school_location_id = null;
        staleFixDetails.push({ character: char.name, field: 'current_school_location_id', bad_id: char.current_school_location_id });
      }
      if (char.occupation_location_id && !locationMap[char.occupation_location_id]) {
        updates.occupation_location_id = null;
        updates.occupation_location_name = null;
        staleFixDetails.push({ character: char.name, field: 'occupation_location_id', bad_id: char.occupation_location_id });
      }
      if (char.resolved_current_location_id && !locationMap[char.resolved_current_location_id]) {
        updates.resolved_current_location_id = null;
        updates.resolved_current_location_name = null;
        staleFixDetails.push({ character: char.name, field: 'resolved_current_location_id', bad_id: char.resolved_current_location_id });
      }

      if (Object.keys(updates).length > 0) {
        await base44.asServiceRole.entities.Character.update(char.id, updates);
        staleLocationFixes++;
      }
    }

    log('stale_location_fixes', { fixed: staleLocationFixes, details: staleFixDetails });

    // Fix stale location worker references
    let staleWorkerFixes = 0;
    for (const loc of locations) {
      const workerIds = loc.worker_character_ids || [];
      const validWorkerIds = workerIds.filter(id => characters.find(c => c.id === id));
      if (validWorkerIds.length !== workerIds.length) {
        await base44.asServiceRole.entities.LocationReference.update(loc.id, {
          worker_character_ids: validWorkerIds
        });
        staleWorkerFixes++;
      }
    }
    log('stale_worker_fixes', { fixed: staleWorkerFixes });

    // ─── PHASE 4: Fix Orphaned NPC Relationships ────────────────────────────────

    let orphanedRelFixes = 0;
    const characterNameMap = {};
    characters.forEach(c => {
      characterNameMap[(c.name || '').toLowerCase().trim()] = c.id;
      if (c.primary_name) characterNameMap[c.primary_name.toLowerCase().trim()] = c.id;
      (c.aliases || []).forEach(a => {
        if (a.text) characterNameMap[a.text.toLowerCase().trim()] = c.id;
      });
    });

    for (const char of characters) {
      const rels = char.fictional_relationships || [];
      let changed = false;
      const updatedRels = rels.map(rel => {
        if (!rel.related_character_id && rel.person_name) {
          const nameKey = rel.person_name.toLowerCase().trim();
          const matchId = characterNameMap[nameKey];
          if (matchId && matchId !== char.id) {
            changed = true;
            orphanedRelFixes++;
            return { ...rel, related_character_id: matchId };
          }
        }
        return rel;
      });

      if (changed) {
        await base44.asServiceRole.entities.Character.update(char.id, { fictional_relationships: updatedRels });
      }
    }

    log('orphaned_relationship_fixes', { fixed: orphanedRelFixes });

    // ─── PHASE 5: 10x Character Diagnostic Passes ──────────────────────────────

    const characterDiagnosticRuns = [];
    for (let run = 1; run <= 10; run++) {
      const freshChars = await base44.asServiceRole.entities.Character.list();
      const freshLocs = await base44.asServiceRole.entities.LocationReference.list();
      const freshLocMap = Object.fromEntries(freshLocs.map(l => [l.id, l]));

      const pass = {
        run,
        total: freshChars.length,
        active: freshChars.filter(c => c.status === 'active').length,
        with_home: freshChars.filter(c => c.current_home_location_id && freshLocMap[c.current_home_location_id]).length,
        broken_home_refs: freshChars.filter(c => c.current_home_location_id && !freshLocMap[c.current_home_location_id]).map(c => c.name),
        broken_work_refs: freshChars.filter(c => c.current_work_location_id && !freshLocMap[c.current_work_location_id]).map(c => c.name),
        broken_occupation_refs: freshChars.filter(c => c.occupation_location_id && !freshLocMap[c.occupation_location_id]).map(c => c.name),
        missing_resolved_location: freshChars.filter(c => c.status === 'active' && !c.resolved_current_location_id && !c.current_home_location_id).map(c => c.name),
        npc_count: freshChars.filter(c => c.character_type === 'npc' || c.character_type === 'family_npc').length,
        active_characters: freshChars.filter(c => c.character_type === 'active').length,
        orphaned_fictional_rels: freshChars.reduce((acc, c) => {
          const orphans = (c.fictional_relationships || []).filter(r => !r.related_character_id && r.person_name);
          return acc + orphans.length;
        }, 0),
      };

      characterDiagnosticRuns.push(pass);
      console.log(`[CHAR-DIAG RUN ${run}/10] active=${pass.active}, broken_homes=${pass.broken_home_refs.length}, broken_work=${pass.broken_work_refs.length}, broken_occupation=${pass.broken_occupation_refs.length}, orphaned_rels=${pass.orphaned_fictional_rels}`);
    }

    log('character_diagnostic_10x', { runs: characterDiagnosticRuns });

    // ─── PHASE 6: Final Summary ──────────────────────────────────────────────────

    const lastRun = characterDiagnosticRuns[9];
    results.summary = {
      status: 'completed',
      timestamp: new Date().toISOString(),
      total_characters: lastRun.total,
      active_characters: lastRun.active,
      total_locations: locations.length,
      total_memories: memories.length,
      total_conversations: conversations.length,
      stale_location_fixes_applied: staleLocationFixes,
      stale_worker_fixes_applied: staleWorkerFixes,
      orphaned_relationship_fixes_applied: orphanedRelFixes,
      final_broken_home_refs: lastRun.broken_home_refs,
      final_broken_work_refs: lastRun.broken_work_refs,
      final_broken_occupation_refs: lastRun.broken_occupation_refs,
      final_orphaned_rels: lastRun.orphaned_fictional_rels,
      home_page: homeCheck,
      travel_page: travelCheck,
      create_page: createCheck,
      locations_page: locationsCheck,
      moments_page: momentsCheck,
      settings_page: settingsCheck,
    };

    console.log('[DIAG COMPLETE]', JSON.stringify(results.summary, null, 2));

    return Response.json(results);
  } catch (error) {
    console.error('[DIAG ERROR]', error.message);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});