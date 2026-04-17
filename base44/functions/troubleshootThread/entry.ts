import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { conversationId, characterId, selectedIssues = [] } = await req.json();
    if (!conversationId || !characterId) {
      return Response.json({ error: 'Missing conversationId or characterId' }, { status: 400 });
    }

    const results = { timestamp: new Date().toISOString(), checks: [], fixes_applied: [], issues_found: [], summary: '' };

    const convArr = await base44.asServiceRole.entities.Conversation.filter({ id: conversationId });
    const conversation = convArr[0] || null;
    const allMessages = await base44.asServiceRole.entities.Message.filter({ conversation_id: conversationId }, '-created_date', 500);

    // ── THREAD LOAD / CHARACTER IDENTITY ─────────────────────────────────────
    if (selectedIssues.includes('thread_load') || selectedIssues.includes('character_identity')) {
      if (!conversation) {
        results.checks.push({ name: 'Thread Load', status: 'failed', message: 'Conversation not found in database.' });
      } else {
        const linked = conversation.character_ids?.includes(characterId);
        results.checks.push({
          name: 'Thread Load',
          status: linked ? 'passed' : 'failed',
          message: linked
            ? `Thread correctly linked (type: ${conversation.type}) | character_ids: [${conversation.character_ids?.join(', ')}]`
            : `Character ${characterId} NOT in conversation.character_ids: [${conversation.character_ids?.join(', ')}] — routing mismatch!`
        });

        const foreign = allMessages.filter(m => m.sender_type === 'character' && m.character_id && m.character_id !== characterId);
        if (foreign.length > 0) {
          const names = [...new Set(foreign.map(m => m.character_name || m.character_id))];
          results.issues_found.push(`Thread contains ${foreign.length} message(s) from OTHER characters: ${names.join(', ')} — cross-contamination detected!`);
          results.checks.push({ name: 'Character Identity Separation', status: 'failed', message: `Foreign messages from: ${names.join(', ')}. This thread should only contain messages from one character.` });
        } else {
          results.checks.push({ name: 'Character Identity Separation', status: 'passed', message: 'All character messages belong to the correct character.' });
        }
      }
    }

    // ── MISSING MESSAGES ─────────────────────────────────────────────────────
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
        results.fixes_applied.push(`Restored ${archived.length} archived messages to visible.`);
      }
    }

    // ── UNREAD STUCK ──────────────────────────────────────────────────────────
    if (selectedIssues.includes('unread_stuck')) {
      const unread = allMessages.filter(m => m.sender_type === 'character' && !m.is_read);
      results.checks.push({ name: 'Unread State', status: unread.length === 0 ? 'passed' : 'warning', message: `Unread character messages: ${unread.length}` });
      for (const msg of unread) {
        await base44.asServiceRole.entities.Message.update(msg.id, { is_read: true });
      }
      if (unread.length > 0) results.fixes_applied.push(`Marked ${unread.length} unread messages as read.`);
    }

    // ── PENDING MESSAGES ──────────────────────────────────────────────────────
    if (selectedIssues.includes('pending_messages')) {
      const pending = await base44.asServiceRole.entities.PendingMessage.filter({ character_id: characterId, delivered: false });
      results.checks.push({ name: 'Pending Messages', status: pending.length === 0 ? 'passed' : 'warning', message: `Stuck pending messages: ${pending.length}` });
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
        results.fixes_applied.push(`Delivered ${pending.length} stuck pending message(s).`);
      }
    }

    // ── MEDIA / IMAGE INTEGRITY ───────────────────────────────────────────────
    if (selectedIssues.includes('media_missing')) {
      const failed = allMessages.filter(m => m.sender_type === 'character' && !m.image_url && !m.content?.trim() && !m.is_narrative);
      const broken = allMessages.filter(m => m.image_url === '' || m.image_url === 'pending');
      results.checks.push({
        name: 'Image Integrity',
        status: failed.length > 0 || broken.length > 0 ? 'warning' : 'passed',
        message: `Failed attempts (no URL): ${failed.length} | Broken URLs: ${broken.length} | Loaded: ${allMessages.filter(m => m.image_url?.startsWith('http')).length}`
      });
      if (failed.length > 0) {
        results.issues_found.push(`${failed.length} message(s) are empty image placeholders — use "Load Photo" button in chat to retry.`);
      }
      for (const msg of broken) {
        await base44.asServiceRole.entities.Message.update(msg.id, { image_url: null });
      }
      if (broken.length > 0) results.fixes_applied.push(`Cleared ${broken.length} broken/empty image URL references.`);
    }

    // ── ARCHIVED MESSAGES ─────────────────────────────────────────────────────
    if (selectedIssues.includes('archived_messages')) {
      const archived = allMessages.filter(m => m.archived_date);
      results.checks.push({ name: 'Archived Messages', status: archived.length > 0 ? 'warning' : 'passed', message: `Archived (hidden): ${archived.length}` });
      if (archived.length > 0) {
        results.issues_found.push(`${archived.length} messages are archived/hidden. Use "Restore" if important messages are missing from the thread.`);
      }
    }

    // ── DEEP CHARACTER RECOVERY ───────────────────────────────────────────────
    // SAFE: reattaches orphaned data only. Never deletes messages or characters.
    if (selectedIssues.includes('deep_character_recovery')) {
      const charArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
      const character = charArr[0];
      const charName = character?.name || '';
      let recovered = { messages: 0, memories: 0, lifeEvents: 0, images: 0 };

      // Orphaned messages: belong to this character but are in a conversation that doesn't include them
      const allCharMessages = await base44.asServiceRole.entities.Message.filter({ character_id: characterId }, '-created_date', 1000);
      const orphaned = allCharMessages.filter(m => m.conversation_id !== conversationId && m.sender_type === 'character');
      for (const msg of orphaned) {
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

      // Orphaned memories with no character_id but mentioning this character's name
      if (charName) {
        const allMems = await base44.asServiceRole.entities.Memory.list('-timestamp', 2000);
        const orphanedMems = allMems.filter(m => !m.character_id && (m.title?.toLowerCase().includes(charName.toLowerCase()) || m.description?.toLowerCase().includes(charName.toLowerCase())));
        for (const mem of orphanedMems) {
          await base44.asServiceRole.entities.Memory.update(mem.id, { character_id: characterId, character_name: charName });
          recovered.memories++;
        }
      }

      // Orphaned life events
      if (charName) {
        const allEvents = await base44.asServiceRole.entities.LifeEvent.list('-timestamp', 2000);
        const orphanedEvents = allEvents.filter(e => !e.character_id && (e.character_name?.toLowerCase() === charName.toLowerCase() || e.description?.toLowerCase().includes(charName.toLowerCase())));
        for (const ev of orphanedEvents) {
          await base44.asServiceRole.entities.LifeEvent.update(ev.id, { character_id: characterId, character_name: charName });
          recovered.lifeEvents++;
        }
      }

      // Clear broken image URLs
      const brokenImgs = allMessages.filter(m => m.sender_type === 'character' && (m.image_url === '' || m.image_url === 'pending'));
      for (const msg of brokenImgs) {
        await base44.asServiceRole.entities.Message.update(msg.id, { image_url: null });
        recovered.images++;
      }

      // Add new image URLs to character reference_image_urls (append only, no removals)
      const allImgMsgs = allCharMessages.filter(m => m.image_url?.startsWith('http'));
      const uniqueImgs = [...new Set(allImgMsgs.map(m => m.image_url))];
      if (uniqueImgs.length > 0 && character) {
        const existing = character.reference_image_urls || [];
        const newRefs = uniqueImgs.filter(url => !existing.includes(url));
        if (newRefs.length > 0) {
          await base44.asServiceRole.entities.Character.update(characterId, {
            reference_image_urls: [...existing, ...newRefs.slice(0, 20)],
          });
          recovered.images += newRefs.length;
        }
      }

      const total = recovered.messages + recovered.memories + recovered.lifeEvents + recovered.images;
      results.checks.push({ name: 'Deep Character Recovery', status: total > 0 ? 'passed' : 'info', message: `Recovered: ${recovered.messages} messages, ${recovered.memories} memories, ${recovered.lifeEvents} life events, ${recovered.images} images.` });
      if (total > 0) results.fixes_applied.push(`Deep recovery: reattached ${recovered.messages} messages, ${recovered.memories} memories, ${recovered.lifeEvents} life events, ${recovered.images} images.`);
      else results.issues_found.push(`No orphaned data found for ${charName} — everything is already correctly linked.`);
    }

    // ── WORLD NAME ENFORCEMENT ────────────────────────────────────────────────
    if (selectedIssues.includes('world_name_enforcement')) {
      const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: user.email });
      const worldName = settingsList?.[0]?.fictional_world_name || null;
      const PLACEHOLDER = [/\bthe user\b/i, /\bthe player\b/i, /\bplayer\b/i];

      if (!worldName) {
        results.checks.push({ name: 'World Name', status: 'warning', message: 'No world name set. Go to Settings > Your Name (In-World).' });
      } else {
        const charMsgs = allMessages.filter(m => m.sender_type === 'character' && m.content);
        const leaky = charMsgs.filter(m => PLACEHOLDER.some(p => p.test(m.content)));
        if (leaky.length > 0) {
          results.issues_found.push(`IDENTITY LEAK: ${leaky.length} character message(s) contain "the user" instead of "${worldName}". Root cause: stale prompt — will resolve on next chat.`);
          results.checks.push({ name: 'World Name — Dialogue', status: 'warning', message: `${leaky.length} message(s) with placeholder identity found.` });
        } else {
          results.checks.push({ name: 'World Name — Dialogue', status: 'passed', message: `No placeholder identity in ${charMsgs.length} character message(s).` });
        }

        const charArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
        const character = charArr[0];
        if (character) {
          const memories = await base44.asServiceRole.entities.Memory.filter({ character_id: characterId }, '-timestamp', 200);
          const stale = memories.filter(m => PLACEHOLDER.some(p => p.test(m.title||'') || p.test(m.description||'')));
          if (stale.length > 0) {
            for (const mem of stale) {
              const newTitle = (mem.title||'').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
              const newDesc = (mem.description||'').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
              await base44.asServiceRole.entities.Memory.update(mem.id, { title: newTitle, description: newDesc });
            }
            results.fixes_applied.push(`Corrected ${stale.length} memory record(s) — replaced placeholder with "${worldName}".`);
            results.checks.push({ name: 'World Name — Memory', status: 'fixed', message: `Corrected ${stale.length} stale memory record(s).` });
          } else {
            results.checks.push({ name: 'World Name — Memory', status: 'passed', message: `No stale identity in ${memories.length} memory record(s).` });
          }

          if (character.system_prompt && PLACEHOLDER.some(p => p.test(character.system_prompt))) {
            await base44.asServiceRole.entities.Character.update(characterId, { system_prompt: null });
            results.fixes_applied.push(`Cleared stale system_prompt — will rebuild with "${worldName}" on next chat.`);
            results.checks.push({ name: 'World Name — Cached Prompt', status: 'fixed', message: `Stale system_prompt cleared.` });
          } else {
            results.checks.push({ name: 'World Name — Cached Prompt', status: 'passed', message: 'No placeholder identity in cached system_prompt.' });
          }
        }
      }
    }

    // ── STALE PROMPT CACHE ────────────────────────────────────────────────────
    if (selectedIssues.includes('stale_prompt_cache')) {
      const charArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
      const character = charArr[0];
      if (character) {
        if (character.system_prompt && character.system_prompt.length > 500) {
          results.checks.push({ name: 'Stale Prompt Cache', status: 'warning', message: `Cached system_prompt exists (${character.system_prompt.length} chars). If behavior feels outdated, run "Character calling me the user" check to auto-clear.` });
        } else {
          results.checks.push({ name: 'Stale Prompt Cache', status: 'passed', message: 'No stale system_prompt cache detected.' });
        }
        if (!character.emotional_state) {
          results.checks.push({ name: 'Emotional State', status: 'warning', message: 'No emotional_state set — character will use a generic fallback.' });
        } else {
          results.checks.push({ name: 'Emotional State', status: 'passed', message: `Emotional state: ${character.emotional_state}` });
        }
        if (character.last_need_simulated_at) {
          const ageHours = Math.floor((Date.now() - new Date(character.last_need_simulated_at).getTime()) / 3600000);
          results.checks.push({ name: 'Needs Staleness', status: ageHours > 48 ? 'warning' : 'passed', message: `Needs last updated ${ageHours} hours ago.` });
        }
      }
    }

    // ── FIX EVERYTHING ────────────────────────────────────────────────────────
    if (selectedIssues.includes('fix_everything')) {
      const res = await base44.asServiceRole.functions.invoke('fixEverything', {}).catch(e => ({ data: { error: e.message } }));
      const d = res?.data || {};
      results.checks.push(...(d.systems_checked || []).map(s => ({ name: s, status: 'info', message: '' })));
      results.fixes_applied.push(...(d.corrective_actions_taken || []));
      results.issues_found.push(...(d.issues_found || []), ...(d.corrective_actions_recommended || []).map(r => `RECOMMENDED: ${r}`), ...(d.unresolved_items || []).map(u => `UNRESOLVED: ${u}`));
      results.checks.push({ name: 'Fix Everything', status: 'info', message: d.summary || 'Master diagnostic complete.' });
    }

    const totalIssues = results.issues_found.length;
    const totalFixes = results.fixes_applied.length;
    results.summary = totalIssues === 0 && totalFixes === 0 ? 'All selected checks passed — thread looks healthy.' : totalFixes > 0 ? `Found ${totalIssues} issue(s), applied ${totalFixes} fix(es).` : `Found ${totalIssues} issue(s) — review details.`;

    return Response.json({ success: true, data: results });
  } catch (error) {
    console.error('[troubleshootThread]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});