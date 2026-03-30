import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

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

    // Always load the conversation and all messages — needed by most checks
    const convArr = await base44.asServiceRole.entities.Conversation.filter({ id: conversationId });
    const conversation = convArr[0] || null;
    const allMessages = await base44.asServiceRole.entities.Message.filter({ conversation_id: conversationId });

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
            : `Character ${characterId} is NOT in conversation.character_ids: [${conversation.character_ids?.join(', ')}] — routing mismatch!`
        });

        // Check for messages in this thread from the WRONG character
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
            message: `Foreign character messages in thread: ${foreignNames.join(', ')}. These should not be here.`
          });
        } else {
          results.checks.push({ name: 'Character Identity Separation', status: 'passed', message: 'All character messages in this thread belong to the correct character' });
        }

        // Cross-contamination: check if OTHER conversations use this same conversationId mapped to a different character
        const duplicateConvos = await base44.asServiceRole.entities.Conversation.filter({ id: conversationId });
        if (duplicateConvos.length > 1) {
          results.issues_found.push(`Multiple conversation records found with the same ID — this is a data integrity problem`);
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

      // Auto-fix: if no visible messages but archived ones exist, un-archive them
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
        // Fetch character name for the message
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

    // --- DEEP MEDIA / IMAGE RECOVERY ---
    if (selectedIssues.includes('media_missing')) {
      // Find messages that have NO image_url and NO content — these are failed image attempts (placeholders)
      const failedImageMsgs = allMessages.filter(m =>
        m.sender_type === 'character' &&
        !m.image_url &&
        !m.content?.trim() &&
        !m.is_narrative
      );

      // Find messages that DO have an image_url but it's broken/empty
      const brokenImageMsgs = allMessages.filter(m => m.image_url === '' || m.image_url === null || m.image_url === 'pending');

      results.checks.push({
        name: 'Image Integrity',
        status: failedImageMsgs.length > 0 || brokenImageMsgs.length > 0 ? 'warning' : 'passed',
        message: `Failed image attempts (no URL attached): ${failedImageMsgs.length} | Broken image URLs: ${brokenImageMsgs.length} | Loaded images: ${allMessages.filter(m => m.image_url && m.image_url.startsWith('http')).length}`
      });

      if (failedImageMsgs.length > 0) {
        results.issues_found.push(`${failedImageMsgs.length} message(s) show as image placeholders — image was attempted but URL was never attached. Message IDs: ${failedImageMsgs.map(m => m.id).join(', ')}`);
        results.issues_found.push(`Use the "Load Photo" button on each placeholder in the chat thread to manually retry loading`);
      }

      // Fix broken (empty string) image_url references
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
        results.issues_found.push(`${archived.length} messages are archived. Use "Restore" if important messages are missing.`);
      }
    }

    // --- DEEP CHARACTER RECOVERY ---
    if (selectedIssues.includes('deep_character_recovery')) {
      const charArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
      const character = charArr[0];
      const charName = character?.name || '';
      let recovered = { messages: 0, memories: 0, lifeEvents: 0, images: 0 };

      // 1. Find ALL messages with this character_id that aren't in this conversation (orphaned or in wrong thread)
      const allCharMessages = await base44.asServiceRole.entities.Message.filter({ character_id: characterId }, '-created_date', 1000);
      const orphanedMsgs = allCharMessages.filter(m => m.conversation_id !== conversationId && m.sender_type === 'character');
      if (orphanedMsgs.length > 0) {
        for (const msg of orphanedMsgs) {
          // Check if the conversation this message belongs to is a valid direct convo for this character
          const parentConvos = await base44.asServiceRole.entities.Conversation.filter({ id: msg.conversation_id });
          const parentConvo = parentConvos[0];
          // If it's a phone or direct convo ONLY for this character, it's valid — leave it
          // If orphaned (no parent or parent belongs to different character set), reattach to current convo
          if (!parentConvo || !parentConvo.character_ids?.includes(characterId)) {
            await base44.asServiceRole.entities.Message.update(msg.id, { conversation_id: conversationId });
            recovered.messages++;
          }
        }
      }

      // 2. Restore all archived messages for this character's conversation
      const archivedInConvo = allMessages.filter(m => m.archived_date);
      for (const msg of archivedInConvo) {
        await base44.asServiceRole.entities.Message.update(msg.id, { archived_date: null });
        recovered.messages++;
      }

      // 3. Find ALL memories with this character_id — ensure none are orphaned
      const allMemories = await base44.asServiceRole.entities.Memory.filter({ character_id: characterId }, '-timestamp', 1000);
      // If charName is set, also scan for memories that mention the character by name but have no/wrong character_id
      if (charName) {
        // Scan memories with no character_id or wrong character_id but whose title/description contains the character name
        const allMemoriesUnfiltered = await base44.asServiceRole.entities.Memory.list('-timestamp', 2000);
        const orphanedMemories = allMemoriesUnfiltered.filter(m =>
          !m.character_id &&
          (m.title?.toLowerCase().includes(charName.toLowerCase()) || m.description?.toLowerCase().includes(charName.toLowerCase()))
        );
        for (const mem of orphanedMemories) {
          await base44.asServiceRole.entities.Memory.update(mem.id, { character_id: characterId, character_name: charName });
          recovered.memories++;
        }
      }

      // 4. Find ALL life events with this character_id — relink any with matching name but missing ID
      if (charName) {
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

      // 5. Scan all messages in current convo for broken/empty image URLs and fix them
      const msgWithImages = allMessages.filter(m => m.image_url && m.image_url.startsWith('http'));
      const msgWithBrokenImages = allMessages.filter(m => m.sender_type === 'character' && (m.image_url === '' || m.image_url === 'pending'));
      for (const msg of msgWithBrokenImages) {
        await base44.asServiceRole.entities.Message.update(msg.id, { image_url: null });
        recovered.images++;
      }

      // 6. Sync avatar/reference images from character record — update character with all found images
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

      // 7. Re-trigger memory extraction from the conversation (fire-and-forget style via inline)
      try {
        const recentMsgs = await base44.asServiceRole.entities.Message.filter({ conversation_id: conversationId }, '-created_date', 100);
        const convoText = recentMsgs.slice(0, 30).reverse().map(m => `${m.sender_type === 'user' ? 'User' : charName}: ${m.content}`).filter(t => t.trim()).join('\n');
        if (convoText) {
          await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `Extract 3-5 key memories from this conversation for character "${charName}". Return JSON array: [{"title":"...","description":"...","emotional_impact":"..."}]\n\n${convoText}`,
            response_json_schema: { type: "object", properties: { memories: { type: "array", items: { type: "object" } } } }
          }).then(async (res) => {
            const mems = res?.memories || [];
            for (const mem of mems) {
              if (!mem.title || !mem.description) continue;
              await base44.asServiceRole.entities.Memory.create({
                character_id: characterId,
                title: mem.title,
                description: mem.description,
                emotional_impact: mem.emotional_impact || 'neutral',
                timestamp: new Date().toISOString(),
                source_context: 'deep_recovery',
              });
              recovered.memories++;
            }
          }).catch(() => {});
        }
      } catch (_) {}

      const totalRecovered = recovered.messages + recovered.memories + recovered.lifeEvents + recovered.images;
      results.checks.push({
        name: 'Deep Character Recovery',
        status: totalRecovered > 0 ? 'passed' : 'info',
        message: `Scanned all app data for ${charName || 'this character'}. Recovered: ${recovered.messages} messages, ${recovered.memories} memories, ${recovered.lifeEvents} life events, ${recovered.images} images.`
      });
      if (totalRecovered > 0) {
        results.fixes_applied.push(`Deep recovery complete: reattached ${recovered.messages} messages, ${recovered.memories} memories, ${recovered.lifeEvents} life events, and ${recovered.images} images to ${charName}.`);
      } else {
        results.issues_found.push(`No orphaned data found for ${charName} — all files are already correctly linked.`);
      }
    }

    const totalIssues = results.issues_found.length;
    const totalFixes = results.fixes_applied.length;
    if (totalIssues === 0 && totalFixes === 0) {
      results.summary = `All selected checks passed — thread looks healthy`;
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