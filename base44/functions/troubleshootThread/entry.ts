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

    const results = {
      timestamp: new Date().toISOString(),
      checks: [],
      fixes_applied: [],
      issues_found: [],
      summary: '',
    };

    // Load conversation and messages
    const convArr = await base44.asServiceRole.entities.Conversation.filter({ id: conversationId });
    const conversation = convArr[0] || null;
    const allMessages = await base44.asServiceRole.entities.Message.filter({ conversation_id: conversationId }, '-created_date', 500);

    // --- THREAD LOAD / CHARACTER IDENTITY CHECK ---
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
            : `Character ${characterId} is NOT in conversation.character_ids — routing mismatch!`
        });

        // Messages from the wrong character in this thread
        const foreignMessages = allMessages.filter(m =>
          m.sender_type === 'character' &&
          m.character_id &&
          m.character_id !== characterId
        );
        if (foreignMessages.length > 0) {
          const foreignNames = [...new Set(foreignMessages.map(m => m.character_name || m.character_id))];
          results.issues_found.push(`Thread contains ${foreignMessages.length} message(s) from OTHER characters: ${foreignNames.join(', ')} — cross-contamination detected!`);
          results.checks.push({
            name: 'Character Identity Separation',
            status: 'failed',
            message: `Foreign character messages in thread: ${foreignNames.join(', ')}`
          });
        } else {
          results.checks.push({ name: 'Character Identity Separation', status: 'passed', message: 'All character messages belong to the correct character' });
        }
      }
    }

    // --- MISSING MESSAGES ---
    if (selectedIssues.includes('missing_messages')) {
      const visibleMessages = allMessages.filter(m => !m.archived_date);
      const archivedMessages = allMessages.filter(m => m.archived_date);

      results.checks.push({
        name: 'Message Presence',
        status: allMessages.length > 0 ? 'passed' : 'warning',
        message: `Total in DB: ${allMessages.length} | Visible: ${visibleMessages.length} | Archived: ${archivedMessages.length}`
      });

      if (visibleMessages.length === 0 && archivedMessages.length > 0) {
        for (const msg of archivedMessages) {
          await base44.asServiceRole.entities.Message.update(msg.id, { archived_date: null });
        }
        results.fixes_applied.push(`Restored ${archivedMessages.length} archived messages to visible`);
      }
    }

    // --- UNREAD STUCK ---
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

    // --- PENDING MESSAGES ---
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

    // --- MEDIA / IMAGE RECOVERY ---
    if (selectedIssues.includes('media_missing')) {
      const failedImageMsgs = allMessages.filter(m =>
        m.sender_type === 'character' && !m.image_url && !m.content?.trim() && !m.is_narrative
      );
      const brokenImageMsgs = allMessages.filter(m => m.image_url === '' || m.image_url === 'pending');

      results.checks.push({
        name: 'Image Integrity',
        status: failedImageMsgs.length > 0 || brokenImageMsgs.length > 0 ? 'warning' : 'passed',
        message: `Failed image attempts (no URL): ${failedImageMsgs.length} | Broken image URLs: ${brokenImageMsgs.length} | Loaded images: ${allMessages.filter(m => m.image_url?.startsWith('http')).length}`
      });

      if (failedImageMsgs.length > 0) {
        results.issues_found.push(`${failedImageMsgs.length} message(s) are image placeholders — image was attempted but URL was never attached.`);
      }
      if (brokenImageMsgs.length > 0) {
        for (const msg of brokenImageMsgs) {
          await base44.asServiceRole.entities.Message.update(msg.id, { image_url: null });
        }
        results.fixes_applied.push(`Cleared ${brokenImageMsgs.length} broken/empty image URL references`);
      }
    }

    // --- ARCHIVED MESSAGES ---
    if (selectedIssues.includes('archived_messages')) {
      const archived = allMessages.filter(m => m.archived_date);
      results.checks.push({
        name: 'Archived Messages',
        status: archived.length > 0 ? 'warning' : 'passed',
        message: `Archived (hidden from view): ${archived.length}`
      });
      if (archived.length > 0) {
        results.issues_found.push(`${archived.length} messages are archived. Use "Restore" if important messages are missing from chat.`);
      }
    }

    // --- DEEP CHARACTER RECOVERY ---
    if (selectedIssues.includes('deep_character_recovery')) {
      const charArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
      const character = charArr[0];

      // SAFETY: only recover data for characters owned by this user
      if (!character || (character.created_by && character.created_by !== user.email)) {
        results.issues_found.push('Deep recovery skipped — character not found or not owned by this account.');
      } else {
        const charName = character?.name || '';
        let recovered = { messages: 0, memories: 0, lifeEvents: 0, images: 0 };

        // 1. Find messages with this character_id not in this conversation
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

        // 2. Restore archived messages in this conversation
        const archivedInConvo = allMessages.filter(m => m.archived_date);
        for (const msg of archivedInConvo) {
          await base44.asServiceRole.entities.Message.update(msg.id, { archived_date: null });
          recovered.messages++;
        }

        // 3. Find orphaned memories (no character_id but mention this character by name)
        if (charName) {
          // Fetch memories from this user's characters only
          const allUserMemories = await base44.asServiceRole.entities.Memory.filter({ created_by: user.email }, '-timestamp', 2000);
          const orphanedMemories = allUserMemories.filter(m =>
            !m.character_id &&
            (m.title?.toLowerCase().includes(charName.toLowerCase()) || m.description?.toLowerCase().includes(charName.toLowerCase()))
          );
          for (const mem of orphanedMemories) {
            await base44.asServiceRole.entities.Memory.update(mem.id, { character_id: characterId });
            recovered.memories++;
          }
        }

        // 4. Find orphaned life events (no character_id but matching name) — scoped to this user
        if (charName) {
          const allUserLifeEvents = await base44.asServiceRole.entities.LifeEvent.filter({ created_by: user.email }, '-timestamp', 2000);
          const orphanedEvents = allUserLifeEvents.filter(e =>
            !e.character_id &&
            (e.character_name?.toLowerCase() === charName.toLowerCase() || e.description?.toLowerCase().includes(charName.toLowerCase()))
          );
          for (const ev of orphanedEvents) {
            await base44.asServiceRole.entities.LifeEvent.update(ev.id, { character_id: characterId, character_name: charName });
            recovered.lifeEvents++;
          }
        }

        // 5. Fix broken image URL references
        const msgWithBrokenImages = allMessages.filter(m => m.sender_type === 'character' && (m.image_url === '' || m.image_url === 'pending'));
        for (const msg of msgWithBrokenImages) {
          await base44.asServiceRole.entities.Message.update(msg.id, { image_url: null });
          recovered.images++;
        }

        // 6. Sync reference images from messages to character record
        const allCharMsgsWithImages = allCharMessages.filter(m => m.image_url?.startsWith('http'));
        const uniqueImageUrls = [...new Set(allCharMsgsWithImages.map(m => m.image_url))];
        if (uniqueImageUrls.length > 0) {
          const existingRefs = character.reference_image_urls || [];
          const newRefs = uniqueImageUrls.filter(url => !existingRefs.includes(url));
          if (newRefs.length > 0) {
            await base44.asServiceRole.entities.Character.update(characterId, {
              reference_image_urls: [...existingRefs, ...newRefs.slice(0, 20)],
            });
            recovered.images += newRefs.length;
          }
        }

        const totalRecovered = recovered.messages + recovered.memories + recovered.lifeEvents + recovered.images;
        results.checks.push({
          name: 'Deep Character Recovery',
          status: totalRecovered > 0 ? 'fixed' : 'info',
          message: `Scanned all data for ${charName}. Recovered: ${recovered.messages} messages, ${recovered.memories} memories, ${recovered.lifeEvents} life events, ${recovered.images} images.`
        });
        if (totalRecovered > 0) {
          results.fixes_applied.push(`Deep recovery: reattached ${recovered.messages} messages, ${recovered.memories} memories, ${recovered.lifeEvents} life events, ${recovered.images} images to ${charName}.`);
        } else {
          results.issues_found.push(`No orphaned data found for ${charName} — all records already correctly linked.`);
        }
      }
    }

    // --- WORLD NAME ENFORCEMENT ---
    if (selectedIssues.includes('world_name_enforcement')) {
      // Scope to this user's settings only
      const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: user.email });
      const worldName = settingsList?.[0]?.fictional_world_name || null;

      if (!worldName) {
        results.checks.push({ name: 'World Name Enforcement', status: 'warning', message: 'No world name set in user profile — characters will use pronouns. Set one in Settings > Your Name (In-World).' });
      } else {
        const PLACEHOLDER_PATTERNS = [/\bthe user\b/i, /\bthe player\b/i, /\bplayer\b/i];
        const charMessages = allMessages.filter(m => m.sender_type === 'character' && m.content);
        const leakyMessages = charMessages.filter(m => PLACEHOLDER_PATTERNS.some(p => p.test(m.content)));

        if (leakyMessages.length > 0) {
          results.issues_found.push(`IDENTITY LEAK: ${leakyMessages.length} character message(s) contain placeholder identity instead of "${worldName}". Root cause: stale prompt or cache not refreshed after world name was set.`);
          results.checks.push({ name: 'World Name — Dialogue', status: 'failed', message: `Found ${leakyMessages.length} message(s) with "the user" placeholder. World name "${worldName}" is set but not reaching this character's prompt. Check system_prompt cache.` });
        } else {
          results.checks.push({ name: 'World Name — Dialogue', status: 'passed', message: `No placeholder identity found in ${charMessages.length} character message(s). World name "${worldName}" is propagating correctly.` });
        }

        const charArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
        const character = charArr[0];
        if (character) {
          const memories = await base44.asServiceRole.entities.Memory.filter({ character_id: characterId }, '-timestamp', 200);
          const staleMemories = memories.filter(m => PLACEHOLDER_PATTERNS.some(p => p.test(m.title || '') || p.test(m.description || '')));
          if (staleMemories.length > 0) {
            let corrected = 0;
            for (const mem of staleMemories) {
              const newTitle = (mem.title || '').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
              const newDesc = (mem.description || '').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
              await base44.asServiceRole.entities.Memory.update(mem.id, { title: newTitle, description: newDesc });
              corrected++;
            }
            results.fixes_applied.push(`Corrected ${corrected} stale memory record(s) — replaced placeholder with "${worldName}"`);
            results.checks.push({ name: 'World Name — Memory', status: 'fixed', message: `${staleMemories.length} memory record(s) corrected.` });
          } else {
            results.checks.push({ name: 'World Name — Memory', status: 'passed', message: `No stale identity references in ${memories.length} memory record(s).` });
          }

          if (character.system_prompt && PLACEHOLDER_PATTERNS.some(p => p.test(character.system_prompt))) {
            await base44.asServiceRole.entities.Character.update(characterId, { system_prompt: null });
            results.fixes_applied.push(`Cleared stale system_prompt cache — will regenerate with world name "${worldName}" on next chat.`);
            results.checks.push({ name: 'World Name — Cached Prompt', status: 'fixed', message: `Stale system_prompt cleared. Will rebuild with "${worldName}" on next chat.` });
          } else if (character.system_prompt) {
            results.checks.push({ name: 'World Name — Cached Prompt', status: 'passed', message: 'Cached system_prompt does not contain placeholder identity.' });
          }
        }
      }
    }

    // --- STALE PROMPT CACHE ---
    if (selectedIssues.includes('stale_prompt_cache')) {
      const charArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
      const character = charArr[0];
      if (character) {
        if (character.system_prompt && character.system_prompt.length > 500) {
          results.checks.push({ name: 'Stale Prompt Cache', status: 'warning', message: `Cached system_prompt detected (${character.system_prompt.length} chars). May contain outdated context. If character behavior feels stale, run the "Character calling me the user" check to auto-clear.` });
          results.issues_found.push(`ACTION AVAILABLE: Run the "Character calling me the user" check to force-clear stale prompt cache.`);
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
          if (ageHours > 48) {
            results.checks.push({ name: 'Needs Simulation Staleness', status: 'warning', message: `Needs last updated ${ageHours} hours ago — may be stale.` });
          } else {
            results.checks.push({ name: 'Needs Simulation Staleness', status: 'passed', message: `Needs last updated ${ageHours} hours ago.` });
          }
        }
      }
    }

    const totalIssues = results.issues_found.length;
    const totalFixes = results.fixes_applied.length;
    if (totalIssues === 0 && totalFixes === 0) {
      results.summary = 'All selected checks passed — thread looks healthy';
    } else if (totalFixes > 0) {
      results.summary = `Found ${totalIssues} issue(s), applied ${totalFixes} fix(es)`;
    } else {
      results.summary = `Found ${totalIssues} issue(s) — review details`;
    }

    return Response.json({ success: true, data: results });
  } catch (error) {
    console.error('[troubleshootThread]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});