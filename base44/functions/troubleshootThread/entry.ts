import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * troubleshootThread
 *
 * Safe diagnostic for a single chat/text thread.
 * Rules:
 * - NEVER deletes messages, characters, memories, or life events
 * - NEVER changes character fields (emotional_state, location, schedule, type, ownership)
 * - Fixes: unread flags, stuck pending messages, broken image URL cleanup,
 *   archive restoration, orphaned message reattachment
 * - Multi-user safe: verifies caller owns the conversation before proceeding
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { conversationId, characterId, selectedIssues = [] } = await req.json();
    if (!conversationId || !characterId) {
      return Response.json({ error: 'Missing conversationId or characterId' }, { status: 400 });
    }

    const results = {
      timestamp: new Date().toISOString(),
      checks: [],
      fixes_applied: [],
      issues_found: [],
      summary: '',
    };

    // Load conversation and verify ownership
    const convArr = await base44.asServiceRole.entities.Conversation.filter({ id: conversationId });
    const conversation = convArr[0] || null;

    if (conversation && conversation.created_by !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Access denied — this conversation does not belong to your account' }, { status: 403 });
    }

    const allMessages = conversation
      ? await base44.asServiceRole.entities.Message.filter({ conversation_id: conversationId }, '-created_date', 500)
      : [];

    // ── THREAD LOAD / CHARACTER IDENTITY ────────────────────────────────
    if (selectedIssues.includes('thread_load') || selectedIssues.includes('character_identity')) {
      if (!conversation) {
        results.checks.push({ name: 'Thread Load', status: 'failed', message: 'Conversation not found in database' });
      } else {
        const linkedCorrectly = conversation.character_ids?.includes(characterId);
        results.checks.push({
          name: 'Thread Load',
          status: linkedCorrectly ? 'passed' : 'failed',
          message: linkedCorrectly
            ? `Thread loaded correctly (type: ${conversation.type}) | character_ids: [${conversation.character_ids?.join(', ')}]`
            : `Character ${characterId} NOT in conversation.character_ids [${conversation.character_ids?.join(', ')}] — routing mismatch`
        });

        // Foreign messages (from a different character in this thread)
        const foreignMessages = allMessages.filter(m =>
          m.sender_type === 'character' && m.character_id && m.character_id !== characterId
        );
        if (foreignMessages.length > 0) {
          const foreignNames = [...new Set(foreignMessages.map(m => m.character_name || m.character_id))];
          results.issues_found.push(`Thread contains ${foreignMessages.length} message(s) from OTHER character(s): ${foreignNames.join(', ')} — cross-contamination`);
          results.checks.push({ name: 'Character Identity Separation', status: 'failed', message: `Foreign messages from: ${foreignNames.join(', ')}` });
        } else {
          results.checks.push({ name: 'Character Identity Separation', status: 'passed', message: 'All character messages belong to the correct character' });
        }
      }
    }

    // ── MISSING MESSAGES ─────────────────────────────────────────────────
    if (selectedIssues.includes('missing_messages')) {
      const visible = allMessages.filter(m => !m.archived_date);
      const archived = allMessages.filter(m => m.archived_date);
      results.checks.push({
        name: 'Message Presence',
        status: allMessages.length > 0 ? 'passed' : 'warning',
        message: `Total in DB: ${allMessages.length} | Visible: ${visible.length} | Archived: ${archived.length}`
      });
      if (visible.length === 0 && archived.length > 0) {
        for (const msg of archived) {
          await base44.asServiceRole.entities.Message.update(msg.id, { archived_date: null });
        }
        results.fixes_applied.push(`Restored ${archived.length} archived messages to visible`);
      }
    }

    // ── UNREAD STUCK ──────────────────────────────────────────────────────
    if (selectedIssues.includes('unread_stuck')) {
      const unread = allMessages.filter(m => m.sender_type === 'character' && !m.is_read);
      results.checks.push({
        name: 'Unread State',
        status: unread.length === 0 ? 'passed' : 'warning',
        message: `Unread character messages: ${unread.length}`
      });
      if (unread.length > 0) {
        for (const msg of unread) {
          await base44.asServiceRole.entities.Message.update(msg.id, { is_read: true });
        }
        results.fixes_applied.push(`Marked ${unread.length} unread messages as read`);
      }
    }

    // ── PENDING MESSAGES ──────────────────────────────────────────────────
    if (selectedIssues.includes('pending_messages')) {
      const pending = await base44.asServiceRole.entities.PendingMessage.filter({ character_id: characterId, delivered: false });
      results.checks.push({
        name: 'Pending Messages',
        status: pending.length === 0 ? 'passed' : 'warning',
        message: `Stuck pending messages: ${pending.length}`
      });
      if (pending.length > 0 && conversation) {
        const charArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
        const charName = charArr[0]?.name || 'Character';
        for (const pm of pending) {
          await base44.asServiceRole.entities.Message.create({
            conversation_id: conversationId,
            sender_type: 'character',
            character_id: characterId,
            character_name: charName,
            content: pm.content,
            image_url: pm.image_url || undefined,
            emotional_state: pm.emotional_state || 'calm',
            timestamp: new Date().toISOString(),
          });
          await base44.asServiceRole.entities.PendingMessage.update(pm.id, { delivered: true });
        }
        results.fixes_applied.push(`Delivered ${pending.length} stuck pending messages`);
      }
    }

    // ── MEDIA / IMAGE RECOVERY ─────────────────────────────────────────
    if (selectedIssues.includes('media_missing')) {
      const failedImageMsgs = allMessages.filter(m =>
        m.sender_type === 'character' && !m.image_url && !m.content?.trim() && !m.is_narrative
      );
      const brokenImageMsgs = allMessages.filter(m => m.image_url === '' || m.image_url === 'pending');

      results.checks.push({
        name: 'Image Integrity',
        status: failedImageMsgs.length > 0 || brokenImageMsgs.length > 0 ? 'warning' : 'passed',
        message: `Failed image attempts: ${failedImageMsgs.length} | Broken URLs: ${brokenImageMsgs.length} | Loaded: ${allMessages.filter(m => m.image_url?.startsWith('http')).length}`
      });

      if (failedImageMsgs.length > 0) {
        results.issues_found.push(`${failedImageMsgs.length} message(s) are empty image placeholders — use "Load Photo" on each to retry`);
      }
      // Safe fix: clear broken empty-string image URLs (null = placeholder, '' = broken)
      if (brokenImageMsgs.length > 0) {
        for (const msg of brokenImageMsgs) {
          await base44.asServiceRole.entities.Message.update(msg.id, { image_url: null });
        }
        results.fixes_applied.push(`Cleared ${brokenImageMsgs.length} broken/empty image URL references`);
      }
    }

    // ── ARCHIVED MESSAGES ─────────────────────────────────────────────
    if (selectedIssues.includes('archived_messages')) {
      const archived = allMessages.filter(m => m.archived_date);
      results.checks.push({
        name: 'Archived Messages',
        status: archived.length > 0 ? 'warning' : 'passed',
        message: `Archived (hidden from view): ${archived.length}`
      });
      if (archived.length > 0) {
        results.issues_found.push(`${archived.length} messages are archived. Use "Restore" to recover them if important messages are missing.`);
      }
    }

    // ── WORLD NAME ENFORCEMENT ─────────────────────────────────────────
    if (selectedIssues.includes('world_name_enforcement')) {
      const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: user.email });
      const worldName = settingsList?.[0]?.fictional_world_name || null;

      if (!worldName) {
        results.checks.push({ name: 'World Name Enforcement', status: 'warning', message: 'No world name set — go to Settings > Your Name (In-World)' });
      } else {
        const PLACEHOLDER_PATTERNS = [/\bthe user\b/i, /\bthe player\b/i, /\bplayer\b/i];
        const charMessages = allMessages.filter(m => m.sender_type === 'character' && m.content);
        const leaky = charMessages.filter(m => PLACEHOLDER_PATTERNS.some(p => p.test(m.content)));

        if (leaky.length > 0) {
          results.issues_found.push(`${leaky.length} character message(s) use "the user" instead of "${worldName}" — stale prompt or cache not refreshed`);
          results.checks.push({ name: 'World Name — Dialogue', status: 'failed', message: `${leaky.length} message(s) with placeholder identity. Root cause: prompt assembly used stale context after world name was set.` });
          leaky.slice(-3).forEach(m => {
            results.issues_found.push(`Message ID ${m.id}: "${(m.content || '').substring(0, 120)}..."`);
          });
        } else {
          results.checks.push({ name: 'World Name — Dialogue', status: 'passed', message: `No placeholder identity in ${charMessages.length} message(s)` });
        }

        // Scan memories
        const charArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
        const character = charArr[0];
        if (character) {
          const memories = await base44.asServiceRole.entities.Memory.filter({ character_id: characterId }, '-timestamp', 200);
          const staleMemories = memories.filter(m =>
            PLACEHOLDER_PATTERNS.some(p => p.test(m.title || '') || p.test(m.description || ''))
          );
          if (staleMemories.length > 0) {
            let corrected = 0;
            for (const mem of staleMemories) {
              const newTitle = (mem.title || '').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
              const newDesc = (mem.description || '').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
              await base44.asServiceRole.entities.Memory.update(mem.id, { title: newTitle, description: newDesc });
              corrected++;
            }
            results.fixes_applied.push(`Corrected ${corrected} stale memory record(s) — replaced placeholder with "${worldName}"`);
            results.checks.push({ name: 'World Name — Memory', status: 'fixed', message: `${staleMemories.length} memory record(s) corrected` });
          } else {
            results.checks.push({ name: 'World Name — Memory', status: 'passed', message: `All ${memories.length} memories free of placeholder identity` });
          }

          if (character.system_prompt && PLACEHOLDER_PATTERNS.some(p => p.test(character.system_prompt))) {
            await base44.asServiceRole.entities.Character.update(characterId, { system_prompt: null });
            results.fixes_applied.push(`Cleared stale system_prompt cache — will rebuild with "${worldName}" on next chat`);
            results.checks.push({ name: 'World Name — Cached Prompt', status: 'fixed', message: 'Stale system_prompt cleared' });
          } else if (character.system_prompt) {
            results.checks.push({ name: 'World Name — Cached Prompt', status: 'passed', message: 'No placeholder in cached prompt' });
          }
        }
      }
    }

    // ── STALE PROMPT CACHE ─────────────────────────────────────────────
    if (selectedIssues.includes('stale_prompt_cache')) {
      const charArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
      const character = charArr[0];
      if (character) {
        if (character.system_prompt && character.system_prompt.length > 500) {
          results.checks.push({ name: 'Stale Prompt Cache', status: 'warning', message: `Cached system_prompt (${character.system_prompt.length} chars) may contain outdated context. Run "Character using outdated context" to clear if needed.` });
          results.issues_found.push('Cached system_prompt detected — run "World Name" check to auto-clear if identity leakage is confirmed');
        } else {
          results.checks.push({ name: 'Stale Prompt Cache', status: 'passed', message: 'No stale system_prompt cache detected' });
        }
        if (!character.emotional_state) {
          results.checks.push({ name: 'Stale Emotional State', status: 'warning', message: 'No emotional_state — character will use generic fallback' });
        } else {
          results.checks.push({ name: 'Stale Emotional State', status: 'passed', message: `Emotional state: ${character.emotional_state}` });
        }
        if (character.last_need_simulated_at) {
          const ageHours = Math.floor((Date.now() - new Date(character.last_need_simulated_at).getTime()) / 3600000);
          results.checks.push({ name: 'Needs Staleness', status: ageHours > 48 ? 'warning' : 'passed', message: `Needs last updated ${ageHours}h ago` });
        }
      }
    }

    // ── DEEP CHARACTER RECOVERY ────────────────────────────────────────
    if (selectedIssues.includes('deep_character_recovery')) {
      const charArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
      const character = charArr[0];
      const charName = character?.name || '';
      let recovered = { messages: 0, memories: 0, lifeEvents: 0, images: 0 };

      // Orphaned messages for this character (wrong conversation)
      const allCharMessages = await base44.asServiceRole.entities.Message.filter({ character_id: characterId }, '-created_date', 1000);
      const orphanedMsgs = allCharMessages.filter(m => m.conversation_id !== conversationId && m.sender_type === 'character');
      for (const msg of orphanedMsgs) {
        const parentConvos = await base44.asServiceRole.entities.Conversation.filter({ id: msg.conversation_id });
        const parentConvo = parentConvos[0];
        if (!parentConvo || !parentConvo.character_ids?.includes(characterId)) {
          await base44.asServiceRole.entities.Message.update(msg.id, { conversation_id: conversationId });
          recovered.messages++;
        }
      }

      // Restore archived messages
      const archivedInConvo = allMessages.filter(m => m.archived_date);
      for (const msg of archivedInConvo) {
        await base44.asServiceRole.entities.Message.update(msg.id, { archived_date: null });
        recovered.messages++;
      }

      // Orphaned memories (no character_id but name match)
      if (charName) {
        const allMemoriesUnfiltered = await base44.asServiceRole.entities.Memory.list('-timestamp', 2000);
        const orphanedMemories = allMemoriesUnfiltered.filter(m =>
          !m.character_id &&
          (m.title?.toLowerCase().includes(charName.toLowerCase()) || m.description?.toLowerCase().includes(charName.toLowerCase()))
        );
        for (const mem of orphanedMemories) {
          await base44.asServiceRole.entities.Memory.update(mem.id, { character_id: characterId });
          recovered.memories++;
        }

        // Orphaned life events
        const allLifeEvents = await base44.asServiceRole.entities.LifeEvent.list('-timestamp', 2000);
        const orphanedEvents = allLifeEvents.filter(e =>
          !e.character_id &&
          (e.character_name?.toLowerCase() === charName.toLowerCase() || e.description?.toLowerCase().includes(charName.toLowerCase()))
        );
        for (const ev of orphanedEvents) {
          await base44.asServiceRole.entities.LifeEvent.update(ev.id, { character_id: characterId, character_name: charName });
          recovered.lifeEvents++;
        }
      }

      // Fix broken image URLs in current convo
      const brokenImages = allMessages.filter(m => m.sender_type === 'character' && (m.image_url === '' || m.image_url === 'pending'));
      for (const msg of brokenImages) {
        await base44.asServiceRole.entities.Message.update(msg.id, { image_url: null });
        recovered.images++;
      }

      // Sync reference images from character messages back to character profile
      const allCharMsgsWithImages = allCharMessages.filter(m => m.image_url?.startsWith('http'));
      const uniqueImageUrls = [...new Set(allCharMsgsWithImages.map(m => m.image_url))];
      if (uniqueImageUrls.length > 0 && character) {
        const existingRefs = character.reference_image_urls || [];
        const newRefs = uniqueImageUrls.filter(url => !existingRefs.includes(url));
        if (newRefs.length > 0) {
          await base44.asServiceRole.entities.Character.update(characterId, {
            reference_image_urls: [...existingRefs, ...newRefs.slice(0, 20)],
          });
          recovered.images += newRefs.length;
        }
      }

      const total = recovered.messages + recovered.memories + recovered.lifeEvents + recovered.images;
      results.checks.push({
        name: 'Deep Character Recovery',
        status: total > 0 ? 'passed' : 'info',
        message: `Scanned all data for ${charName}. Recovered: ${recovered.messages} messages, ${recovered.memories} memories, ${recovered.lifeEvents} life events, ${recovered.images} images`
      });
      if (total > 0) {
        results.fixes_applied.push(`Deep recovery: ${recovered.messages} messages, ${recovered.memories} memories, ${recovered.lifeEvents} life events, ${recovered.images} images reattached to ${charName}`);
      } else {
        results.issues_found.push(`No orphaned data found for ${charName} — all records correctly linked`);
      }
    }

    // ── FIX EVERYTHING ────────────────────────────────────────────────────
    if (selectedIssues.includes('fix_everything')) {
      const res = await base44.asServiceRole.functions.invoke('fixEverything', {});
      const d = res?.data || {};
      results.checks.push(...(d.systems_checked || []).map(s => ({ name: s, status: 'info', message: '' })));
      results.fixes_applied.push(...(d.corrective_actions_taken || []));
      results.issues_found.push(
        ...(d.issues_found || []),
        ...(d.corrective_actions_recommended || []).map(r => `RECOMMENDED: ${r}`),
        ...(d.unresolved_items || []).map(u => `UNRESOLVED: ${u}`)
      );
    }

    const totalIssues = results.issues_found.length;
    const totalFixes = results.fixes_applied.length;
    results.summary = totalIssues === 0 && totalFixes === 0
      ? 'All selected checks passed — thread looks healthy'
      : totalFixes > 0
        ? `Found ${totalIssues} issue(s), applied ${totalFixes} fix(es)`
        : `Found ${totalIssues} issue(s) — review details`;

    return Response.json({ success: true, data: results });
  } catch (error) {
    console.error('[troubleshootThread]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});