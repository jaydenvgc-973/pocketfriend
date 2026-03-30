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