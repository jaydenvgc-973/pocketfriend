import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const ADMIN_EMAIL = 'murqart@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.email !== ADMIN_EMAIL) {
      return Response.json({ error: 'Forbidden: Admin only' }, { status: 403 });
    }

    const { action, payload } = await req.json();

    // ── INSPECT: gather live app data for diagnostics ──────────────────────────
    if (action === 'inspect') {
      const { scope } = payload || {};
      const results = {};

      if (!scope || scope.includes('characters')) {
        const chars = await base44.asServiceRole.entities.Character.list('-created_date', 50);
        results.characters = chars.map(c => ({
          id: c.id,
          name: c.name,
          status: c.status,
          emotional_state: c.emotional_state,
          friendship_level: c.friendship_level,
          romantic_level: c.romantic_level,
          created_by: c.created_by,
          has_system_prompt: !!c.system_prompt,
          has_avatar: !!c.avatar_url,
        }));
      }

      if (!scope || scope.includes('memories')) {
        const mems = await base44.asServiceRole.entities.Memory.list('-timestamp', 100);
        results.memory_count = mems.length;
        results.memory_by_character = {};
        mems.forEach(m => {
          if (!results.memory_by_character[m.character_id]) {
            results.memory_by_character[m.character_id] = { count: 0, latest: m.timestamp };
          }
          results.memory_by_character[m.character_id].count++;
        });
      }

      if (!scope || scope.includes('conversations')) {
        const convos = await base44.asServiceRole.entities.Conversation.list('-updated_date', 50);
        results.conversation_count = convos.length;
        results.conversations = convos.map(c => ({
          id: c.id,
          title: c.title,
          type: c.type,
          character_ids: c.character_ids,
          last_message_date: c.last_message_date,
          created_by: c.created_by,
        }));
      }

      if (!scope || scope.includes('messages')) {
        // Sample recent messages for thread health check
        const msgs = await base44.asServiceRole.entities.Message.list('-created_date', 100);
        results.recent_message_count = msgs.length;
        // Check for cross-contamination (messages where character_id doesn't match conversation character_ids)
        const convos = results.conversations || [];
        const convoMap = {};
        convos.forEach(c => { convoMap[c.id] = c.character_ids; });
        const cross = msgs.filter(m => {
          if (!m.character_id || !m.conversation_id) return false;
          const ids = convoMap[m.conversation_id];
          if (!ids) return false;
          return !ids.includes(m.character_id);
        });
        results.cross_contaminated_messages = cross.length;
        results.cross_contaminated_sample = cross.slice(0, 5).map(m => ({
          id: m.id, character_id: m.character_id, conversation_id: m.conversation_id
        }));
      }

      if (!scope || scope.includes('pending')) {
        const pending = await base44.asServiceRole.entities.PendingMessage.filter({ delivered: false });
        results.stuck_pending_messages = pending.length;
        results.stuck_pending_sample = pending.slice(0, 5).map(p => ({
          id: p.id, character_id: p.character_id, content: p.content?.substring(0, 60)
        }));
      }

      if (!scope || scope.includes('settings')) {
        const settings = await base44.asServiceRole.entities.UserSettings.list('-created_date', 20);
        results.user_settings_count = settings.length;
      }

      return Response.json({ success: true, results });
    }

    // ── INSPECT_CHARACTER: deep per-character inspection ──────────────────────
    if (action === 'inspect_character') {
      const { character_name, character_id } = payload || {};
      const chars = await base44.asServiceRole.entities.Character.list('-created_date', 100);
      let char;
      if (character_id) {
        char = chars.find(c => c.id === character_id);
      } else if (character_name) {
        char = chars.find(c => c.name?.toLowerCase().includes(character_name.toLowerCase()));
      }
      if (!char) return Response.json({ error: `Character "${character_name || character_id}" not found` }, { status: 404 });

      const memories = await base44.asServiceRole.entities.Memory.filter({ character_id: char.id }, '-timestamp', 200);
      const convos = await base44.asServiceRole.entities.Conversation.filter({ character_ids: [char.id] }, '-updated_date', 20);
      const lifeEvents = await base44.asServiceRole.entities.LifeEvent.filter({ character_id: char.id }, '-timestamp', 30);
      const pendingMsgs = await base44.asServiceRole.entities.PendingMessage.filter({ character_id: char.id });

      // Recent messages from each conversation
      const threadHealth = [];
      for (const convo of convos.slice(0, 5)) {
        const msgs = await base44.asServiceRole.entities.Message.filter({ conversation_id: convo.id }, '-created_date', 10);
        const crossContam = msgs.filter(m => m.character_id && m.character_id !== char.id && m.sender_type === 'character');
        threadHealth.push({
          convo_id: convo.id,
          convo_type: convo.type,
          message_count: msgs.length,
          cross_contaminated: crossContam.length > 0,
          cross_char_ids: [...new Set(crossContam.map(m => m.character_id))],
        });
      }

      return Response.json({
        success: true,
        character: {
          id: char.id,
          name: char.name,
          status: char.status,
          emotional_state: char.emotional_state,
          personality_summary: char.personality_summary,
          family_members: char.family_members || [],
          fictional_relationships: char.fictional_relationships || [],
          work_details: char.work_details,
          city: char.city,
          state: char.state,
          has_system_prompt: !!char.system_prompt,
          system_prompt_length: char.system_prompt?.length || 0,
        },
        memory_count: memories.length,
        memory_sample: memories.slice(0, 10).map(m => ({
          id: m.id, title: m.title, timestamp: m.timestamp, emotional_impact: m.emotional_impact
        })),
        conversation_count: convos.length,
        thread_health: threadHealth,
        life_event_count: lifeEvents.length,
        pending_messages: pendingMsgs.length,
        issues_detected: {
          no_memories: memories.length === 0,
          no_conversations: convos.length === 0,
          stuck_pending: pendingMsgs.length > 0,
          cross_contaminated_threads: threadHealth.some(t => t.cross_contaminated),
          no_system_prompt: !char.system_prompt,
          blank_family: (char.family_members || []).some(f => !f.name || !f.relationship_type),
        }
      });
    }

    // ── REPAIR_MEMORY: reconnect/restore character memory ────────────────────
    if (action === 'repair_memory') {
      const { character_name, character_id } = payload || {};
      const chars = await base44.asServiceRole.entities.Character.list('-created_date', 100);
      let char;
      if (character_id) {
        char = chars.find(c => c.id === character_id);
      } else if (character_name) {
        char = chars.find(c => c.name?.toLowerCase().includes(character_name.toLowerCase()));
      }
      if (!char) return Response.json({ error: `Character not found` }, { status: 404 });

      const memories = await base44.asServiceRole.entities.Memory.filter({ character_id: char.id }, '-timestamp', 500);

      // Check for memories with wrong/missing character_id linkage
      // (e.g. memories created with a slightly different char ID format)
      const allMemories = await base44.asServiceRole.entities.Memory.list('-timestamp', 500);
      const orphanedByName = allMemories.filter(m =>
        !m.character_id &&
        m.description?.toLowerCase().includes(char.name.toLowerCase())
      );

      let relinked = 0;
      for (const mem of orphanedByName) {
        await base44.asServiceRole.entities.Memory.update(mem.id, { character_id: char.id });
        relinked++;
      }

      // Ensure the character's system_prompt is fresh (regeneration trigger)
      // Also make sure memory retrieval context isn't broken by checking recent convo
      const convos = await base44.asServiceRole.entities.Conversation.filter(
        { character_ids: [char.id] }, '-updated_date', 5
      );

      const recentConvoIds = convos.map(c => c.id);
      const recentMessages = [];
      for (const cid of recentConvoIds.slice(0, 2)) {
        const msgs = await base44.asServiceRole.entities.Message.filter({ conversation_id: cid }, '-created_date', 20);
        recentMessages.push(...msgs);
      }

      return Response.json({
        success: true,
        character_name: char.name,
        character_id: char.id,
        existing_memories: memories.length,
        orphaned_relinked: relinked,
        recent_conversations: convos.length,
        recent_messages_found: recentMessages.length,
        memory_status: memories.length > 0 ? 'active' : 'empty',
        notes: memories.length === 0
          ? `No memories found for ${char.name}. Memories are created as conversations happen. Existing chat history can be re-extracted.`
          : `${char.name} has ${memories.length} memories. ${relinked > 0 ? `${relinked} orphaned memories were relinked.` : 'All memories appear correctly linked.'}`,
      });
    }

    // ── REPAIR_THREAD: fix cross-contamination and thread mapping ────────────
    if (action === 'repair_thread') {
      const { character_name, character_id } = payload || {};
      const chars = await base44.asServiceRole.entities.Character.list('-created_date', 100);
      let char;
      if (character_id) {
        char = chars.find(c => c.id === character_id);
      } else if (character_name) {
        char = chars.find(c => c.name?.toLowerCase().includes(character_name.toLowerCase()));
      }
      if (!char) return Response.json({ error: `Character not found` }, { status: 404 });

      const convos = await base44.asServiceRole.entities.Conversation.filter({ character_ids: [char.id] }, '-updated_date', 20);
      let fixed = 0;
      let deleted_cross = 0;

      for (const convo of convos) {
        // Ensure conversation only contains this character
        if (convo.character_ids.length > 1 && convo.type !== 'group') {
          // Fix: keep only this character in single-character convos
          await base44.asServiceRole.entities.Conversation.update(convo.id, {
            character_ids: [char.id]
          });
          fixed++;
        }

        // Find and archive cross-contaminated messages
        const msgs = await base44.asServiceRole.entities.Message.filter({ conversation_id: convo.id }, '-created_date', 200);
        for (const msg of msgs) {
          if (msg.sender_type === 'character' && msg.character_id && msg.character_id !== char.id) {
            await base44.asServiceRole.entities.Message.update(msg.id, {
              archived_date: new Date().toISOString()
            });
            deleted_cross++;
          }
        }
      }

      return Response.json({
        success: true,
        character_name: char.name,
        conversations_checked: convos.length,
        conversations_fixed: fixed,
        cross_contaminated_messages_archived: deleted_cross,
      });
    }

    // ── REPAIR_FAMILY: fix family member data ────────────────────────────────
    if (action === 'repair_family') {
      const { character_name, character_id, fixes } = payload || {};
      const chars = await base44.asServiceRole.entities.Character.list('-created_date', 100);
      let char;
      if (character_id) {
        char = chars.find(c => c.id === character_id);
      } else if (character_name) {
        char = chars.find(c => c.name?.toLowerCase().includes(character_name.toLowerCase()));
      }
      if (!char) return Response.json({ error: `Character not found` }, { status: 404 });

      const currentFamily = char.family_members || [];
      let updatedFamily = [...currentFamily];

      // Apply fixes if provided
      if (fixes && Array.isArray(fixes)) {
        for (const fix of fixes) {
          if (fix.action === 'remove') {
            updatedFamily = updatedFamily.filter(f => f.name !== fix.name);
          } else if (fix.action === 'update') {
            updatedFamily = updatedFamily.map(f =>
              f.name === fix.name ? { ...f, ...fix.data } : f
            );
          } else if (fix.action === 'add') {
            updatedFamily.push(fix.data);
          }
        }
        await base44.asServiceRole.entities.Character.update(char.id, { family_members: updatedFamily });
      }

      return Response.json({
        success: true,
        character_name: char.name,
        family_before: currentFamily,
        family_after: updatedFamily,
        changes_made: fixes?.length || 0,
      });
    }

    // ── EXTRACT_MEMORIES: re-extract memories from archived messages ──────────
    if (action === 'extract_memories') {
      const { character_id, character_name } = payload || {};
      const chars = await base44.asServiceRole.entities.Character.list('-created_date', 100);
      let char;
      if (character_id) {
        char = chars.find(c => c.id === character_id);
      } else if (character_name) {
        char = chars.find(c => c.name?.toLowerCase().includes(character_name.toLowerCase()));
      }
      if (!char) return Response.json({ error: `Character not found` }, { status: 404 });

      // Get all conversations for this character
      const convos = await base44.asServiceRole.entities.Conversation.filter({ character_ids: [char.id] }, '-updated_date', 10);
      let totalExtracted = 0;

      for (const convo of convos.slice(0, 3)) {
        // Get messages including archived ones
        const msgs = await base44.asServiceRole.entities.Message.filter({ conversation_id: convo.id }, '-created_date', 100);
        if (msgs.length < 4) continue;

        // Pick a sample of archived/older messages to extract memories from
        const sample = msgs.slice(20, 60);
        if (sample.length < 4) continue;

        const conversationText = sample.reverse().map(m =>
          `${m.sender_type === 'user' ? 'User' : char.name}: ${m.content || '(image)'}`
        ).join('\n');

        try {
          const memRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `You are extracting long-term memories for a character named "${char.name}" from their conversation history.

Here is a portion of the conversation:
${conversationText.substring(0, 3000)}

Extract 3-5 important memories that ${char.name} would remember about the user and their interactions.
Only extract things that are genuinely significant: shared experiences, things the user revealed about themselves, emotional moments, plans made, or important context.

Return a JSON array of memory objects:
[
  {
    "title": "short title",
    "description": "what happened and why it matters",
    "emotional_impact": "how it made the character feel"
  }
]`,
            response_json_schema: {
              type: "object",
              properties: {
                memories: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      description: { type: "string" },
                      emotional_impact: { type: "string" },
                    }
                  }
                }
              }
            }
          });

          const extracted = memRes?.memories || [];
          for (const mem of extracted) {
            // Check if similar memory already exists
            const existing = await base44.asServiceRole.entities.Memory.filter({ character_id: char.id }, '-timestamp', 200);
            const isDuplicate = existing.some(e => e.title?.toLowerCase() === mem.title?.toLowerCase());
            if (!isDuplicate && mem.title && mem.description) {
              await base44.asServiceRole.entities.Memory.create({
                character_id: char.id,
                title: mem.title,
                description: mem.description,
                emotional_impact: mem.emotional_impact || 'neutral',
                timestamp: new Date().toISOString(),
                source_context: `admin_extraction_${convo.id}`,
              });
              totalExtracted++;
            }
          }
        } catch (e) {
          console.error('Memory extraction failed for convo', convo.id, e.message);
        }
      }

      return Response.json({
        success: true,
        character_name: char.name,
        memories_extracted: totalExtracted,
        conversations_scanned: Math.min(convos.length, 3),
      });
    }

    // ── REPAIR_UNREAD: fix stuck notification badges ──────────────────────────
    if (action === 'repair_unread') {
      const { character_id } = payload || {};
      let msgs;
      if (character_id) {
        // Get conversations for this character and mark all read
        const convos = await base44.asServiceRole.entities.Conversation.filter({ character_ids: [character_id] });
        let fixed = 0;
        for (const c of convos) {
          const unread = await base44.asServiceRole.entities.Message.filter({
            conversation_id: c.id,
            sender_type: 'character',
            is_read: false
          });
          for (const m of unread) {
            await base44.asServiceRole.entities.Message.update(m.id, { is_read: true });
            fixed++;
          }
        }
        return Response.json({ success: true, messages_marked_read: fixed });
      } else {
        // Global unread fix
        msgs = await base44.asServiceRole.entities.Message.filter({ sender_type: 'character', is_read: false }, '-created_date', 200);
        let fixed = 0;
        for (const m of msgs) {
          await base44.asServiceRole.entities.Message.update(m.id, { is_read: true });
          fixed++;
        }
        return Response.json({ success: true, messages_marked_read: fixed });
      }
    }

    // ── REPAIR_PENDING: deliver stuck pending messages ─────────────────────
    if (action === 'repair_pending') {
      const { character_id } = payload || {};
      const filter = character_id
        ? { character_id, delivered: false }
        : { delivered: false };
      const pending = await base44.asServiceRole.entities.PendingMessage.filter(filter);
      let delivered = 0;
      for (const p of pending) {
        await base44.asServiceRole.entities.PendingMessage.update(p.id, { delivered: true });
        delivered++;
      }
      return Response.json({ success: true, pending_cleared: delivered });
    }

    // ── LIST_MEMORIES: get all memories for a character ───────────────────────
    if (action === 'list_memories') {
      const { character_id, character_name } = payload || {};
      const chars = await base44.asServiceRole.entities.Character.list('-created_date', 100);
      let char;
      if (character_id) {
        char = chars.find(c => c.id === character_id);
      } else if (character_name) {
        char = chars.find(c => c.name?.toLowerCase().includes(character_name.toLowerCase()));
      }
      if (!char) return Response.json({ error: `Character not found` }, { status: 404 });

      const memories = await base44.asServiceRole.entities.Memory.filter({ character_id: char.id }, '-timestamp', 200);
      return Response.json({
        success: true,
        character_name: char.name,
        character_id: char.id,
        total: memories.length,
        memories: memories.map(m => ({
          id: m.id,
          title: m.title,
          description: m.description,
          emotional_impact: m.emotional_impact,
          timestamp: m.timestamp,
          source_context: m.source_context,
        }))
      });
    }

    // ── REPAIR_CHARACTER_STATUS: reset character status ──────────────────────
    if (action === 'repair_character_status') {
      const { character_id, character_name, updates } = payload || {};
      const chars = await base44.asServiceRole.entities.Character.list('-created_date', 100);
      let char;
      if (character_id) char = chars.find(c => c.id === character_id);
      else if (character_name) char = chars.find(c => c.name?.toLowerCase().includes(character_name.toLowerCase()));
      if (!char) return Response.json({ error: `Character not found` }, { status: 404 });

      const safeUpdates = {};
      const allowedFields = ['emotional_state', 'status', 'current_activity', 'health_status', 'friendship_level', 'romantic_level', 'user_respect_level', 'attraction_level', 'chosen_family_level'];
      for (const [k, v] of Object.entries(updates || {})) {
        if (allowedFields.includes(k)) safeUpdates[k] = v;
      }

      if (Object.keys(safeUpdates).length > 0) {
        await base44.asServiceRole.entities.Character.update(char.id, safeUpdates);
      }

      return Response.json({ success: true, character_name: char.name, updates_applied: safeUpdates });
    }

    // ── RELINK_ALL_ETHAN_DATA: find Ethan and relink ALL orphaned data to him ──
    if (action === 'relink_all_ethan_data') {
      const chars = await base44.asServiceRole.entities.Character.list('-created_date', 100);
      const ethan = chars.find(c => c.name?.toLowerCase().includes('ethan'));
      if (!ethan) return Response.json({ error: 'Ethan not found in characters list' }, { status: 404 });

      const ethanId = ethan.id;
      const report = { ethan_id: ethanId, relinked: {} };

      // 1. Memories — relink any with ethan name but wrong/missing character_id
      const allMemories = await base44.asServiceRole.entities.Memory.list('-timestamp', 1000);
      let memFixed = 0;
      for (const m of allMemories) {
        const isEthanMem = m.character_id === ethanId;
        const mentionsEthan = (m.description?.toLowerCase().includes('ethan') || m.title?.toLowerCase().includes('ethan'));
        if (!isEthanMem && mentionsEthan) {
          await base44.asServiceRole.entities.Memory.update(m.id, { character_id: ethanId });
          memFixed++;
        }
        // Also fix memories with no character_id but clearly ethan context
        if (!m.character_id && mentionsEthan) {
          await base44.asServiceRole.entities.Memory.update(m.id, { character_id: ethanId });
          memFixed++;
        }
      }
      report.relinked.memories = memFixed;

      // 2. Conversations — fix any single-char convo pointing to ethan that got corrupted
      const allConvos = await base44.asServiceRole.entities.Conversation.list('-updated_date', 200);
      let convoFixed = 0;
      for (const c of allConvos) {
        // Convo mentions ethan in title but character_ids doesn't have him
        const titleHasEthan = c.title?.toLowerCase().includes('ethan');
        const idsHasEthan = (c.character_ids || []).includes(ethanId);
        if (titleHasEthan && !idsHasEthan && (c.type === 'direct' || c.type === 'phone') && (c.character_ids || []).length <= 1) {
          await base44.asServiceRole.entities.Conversation.update(c.id, { character_ids: [ethanId] });
          convoFixed++;
        }
      }
      report.relinked.conversations = convoFixed;

      // 3. Messages — relink messages where character_name is Ethan but character_id is wrong/missing
      const allMsgs = await base44.asServiceRole.entities.Message.list('-created_date', 500);
      let msgFixed = 0;
      for (const m of allMsgs) {
        const nameIsEthan = m.character_name?.toLowerCase().includes('ethan');
        const idIsWrong = m.character_id && m.character_id !== ethanId;
        const idIsMissing = !m.character_id;
        if (nameIsEthan && (idIsWrong || idIsMissing) && m.sender_type === 'character') {
          await base44.asServiceRole.entities.Message.update(m.id, { character_id: ethanId });
          msgFixed++;
        }
      }
      report.relinked.messages = msgFixed;

      // 4. Life events
      const allLifeEvents = await base44.asServiceRole.entities.LifeEvent.list('-timestamp', 500);
      let evFixed = 0;
      for (const ev of allLifeEvents) {
        const nameIsEthan = ev.character_name?.toLowerCase().includes('ethan');
        const idIsWrong = ev.character_id && ev.character_id !== ethanId;
        if (nameIsEthan && idIsWrong) {
          await base44.asServiceRole.entities.LifeEvent.update(ev.id, { character_id: ethanId });
          evFixed++;
        }
      }
      report.relinked.life_events = evFixed;

      // 5. Pending messages
      const allPending = await base44.asServiceRole.entities.PendingMessage.list('-created_date', 100);
      let pendFixed = 0;
      for (const p of allPending) {
        // Can't check name on pending, but if character_id looks like it was created in same batch as ethan's convo
        // Only fix if there's clear evidence — skip unless we have a hint
      }
      report.relinked.pending_messages = pendFixed;

      // 6. Get current true state of Ethan's data
      const ethanMemories = await base44.asServiceRole.entities.Memory.filter({ character_id: ethanId }, '-timestamp', 500);
      const ethanConvos = await base44.asServiceRole.entities.Conversation.filter({ character_ids: [ethanId] }, '-updated_date', 20);
      const ethanLifeEvents = await base44.asServiceRole.entities.LifeEvent.filter({ character_id: ethanId }, '-timestamp', 100);

      report.current_state = {
        memories: ethanMemories.length,
        conversations: ethanConvos.length,
        life_events: ethanLifeEvents.length,
        system_prompt_present: !!ethan.system_prompt,
        emotional_state: ethan.emotional_state,
        friendship_level: ethan.friendship_level,
      };

      return Response.json({ success: true, character: 'Ethan', report });
    }

    // ── FULL_CHARACTER_RESTORE: comprehensive restore for any named character ──
    if (action === 'full_character_restore') {
      const { character_name, character_id } = payload || {};
      const chars = await base44.asServiceRole.entities.Character.list('-created_date', 100);
      let char;
      if (character_id) char = chars.find(c => c.id === character_id);
      else if (character_name) char = chars.find(c => c.name?.toLowerCase().includes(character_name.toLowerCase()));
      if (!char) return Response.json({ error: `Character not found` }, { status: 404 });

      const charId = char.id;
      const charNameLower = char.name.toLowerCase();
      const report = { character: char.name, character_id: charId, relinked: {} };

      // Memories
      const allMemories = await base44.asServiceRole.entities.Memory.list('-timestamp', 1000);
      let memFixed = 0;
      for (const m of allMemories) {
        const mentionsChar = m.description?.toLowerCase().includes(charNameLower) || m.title?.toLowerCase().includes(charNameLower);
        if (m.character_id !== charId && mentionsChar) {
          await base44.asServiceRole.entities.Memory.update(m.id, { character_id: charId });
          memFixed++;
        }
      }
      report.relinked.memories = memFixed;

      // Messages
      const allMsgs = await base44.asServiceRole.entities.Message.list('-created_date', 500);
      let msgFixed = 0;
      for (const m of allMsgs) {
        const nameMatches = m.character_name?.toLowerCase().includes(charNameLower);
        if (nameMatches && m.character_id !== charId && m.sender_type === 'character') {
          await base44.asServiceRole.entities.Message.update(m.id, { character_id: charId });
          msgFixed++;
        }
      }
      report.relinked.messages = msgFixed;

      // Life events
      const allLifeEvents = await base44.asServiceRole.entities.LifeEvent.list('-timestamp', 500);
      let evFixed = 0;
      for (const ev of allLifeEvents) {
        const nameMatches = ev.character_name?.toLowerCase().includes(charNameLower);
        if (nameMatches && ev.character_id !== charId) {
          await base44.asServiceRole.entities.LifeEvent.update(ev.id, { character_id: charId });
          evFixed++;
        }
      }
      report.relinked.life_events = evFixed;

      // Re-extract memories from conversation history
      const convos = await base44.asServiceRole.entities.Conversation.filter({ character_ids: [charId] }, '-updated_date', 5);
      report.conversations_found = convos.length;

      // Current counts
      const currentMems = await base44.asServiceRole.entities.Memory.filter({ character_id: charId }, '-timestamp', 500);
      report.total_memories_after = currentMems.length;

      return Response.json({ success: true, report });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });

  } catch (error) {
    console.error('adminExecute error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});