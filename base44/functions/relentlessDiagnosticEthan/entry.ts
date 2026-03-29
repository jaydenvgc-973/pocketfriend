import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ETHAN_ID = '69c0d59d7e382cc866ded9c9';
    const allDiagnostics = [];
    const allFixes = [];
    const allDeletedMessages = [];
    let loopCount = 0;
    let finalUnreadCount = 0;

    // RELENTLESS LOOP: Keep going until unread count is 0 and stays 0
    for (let mainLoop = 1; mainLoop <= 15; mainLoop++) {
      loopCount = mainLoop;
      allDiagnostics.push(`\n========== MAIN LOOP ${mainLoop} ==========`);
      
      // Get all Ethan conversations (including NPC chat)
      const convos = await base44.entities.Conversation.filter(
        { character_ids: [ETHAN_ID] },
        "-updated_date",
        200
      );
      allDiagnostics.push(`Total conversations for Ethan: ${convos.length}`);
      
      let loopUnreadCount = 0;
      const loopDeletedMessages = [];
      
      // 1. SCAN ALL CONVERSATIONS FOR UNREAD
      for (const convo of convos) {
        const unreadMsgs = await base44.entities.Message.filter(
          { conversation_id: convo.id, is_read: false, sender_type: 'character' }
        );
        
        if (unreadMsgs.length > 0) {
          allDiagnostics.push(`  [${convo.type}] "${convo.title}": ${unreadMsgs.length} unread`);
          
          for (const msg of unreadMsgs) {
            const ageMinutes = Math.round((new Date() - new Date(msg.created_date)) / 60000);
            allDiagnostics.push(`    - ${msg.id.substring(0, 8)}: age=${ageMinutes}m | content="${(msg.content || '(empty)').substring(0, 40)}"`);
            
            loopUnreadCount += 1;
            
            // IMMEDIATE MARK AS READ
            await base44.entities.Message.update(msg.id, { is_read: true });
            allFixes.push(`Loop ${mainLoop}: Marked ${msg.id.substring(0, 8)} as read`);
          }
        }
      }
      
      // 2. CHECK PENDING MESSAGES (these shouldn't count as unread yet)
      const pending = await base44.entities.PendingMessage.filter(
        { character_id: ETHAN_ID, delivered: false }
      );
      if (pending.length > 0) {
        allDiagnostics.push(`  ⚠️ Pending (not yet delivered): ${pending.length}`);
      }
      
      // 3. VERIFY ALL NPC CONVERSATIONS
      const npcConvos = convos.filter(c => c.type === 'npc');
      if (npcConvos.length > 0) {
        allDiagnostics.push(`  Special: ${npcConvos.length} NPC conversations - checking thoroughly`);
        
        for (const npcConvo of npcConvos) {
          // Force mark ALL character messages as read in NPC convos
          const allCharMsgs = await base44.entities.Message.filter(
            { conversation_id: npcConvo.id, sender_type: 'character' }
          );
          
          for (const msg of allCharMsgs) {
            if (!msg.is_read) {
              await base44.entities.Message.update(msg.id, { is_read: true });
              loopUnreadCount += 1;
            }
          }
        }
      }
      
      allDiagnostics.push(`Loop ${mainLoop} total unread processed: ${loopUnreadCount}`);
      
      // 4. FINAL COUNT FOR THIS LOOP
      let verifyUnreadCount = 0;
      for (const convo of convos) {
        const verify = await base44.entities.Message.filter(
          { conversation_id: convo.id, is_read: false, sender_type: 'character' }
        );
        verifyUnreadCount += verify.length;
      }
      
      finalUnreadCount = verifyUnreadCount;
      allDiagnostics.push(`After processing: ${verifyUnreadCount} unread remaining`);
      
      // 5. IF ZERO, VERIFY TWICE MORE THEN STOP
      if (verifyUnreadCount === 0) {
        allDiagnostics.push(`✓ Loop ${mainLoop}: ZERO unread found!`);
        
        // Verify again in next loop (extra check)
        if (mainLoop < 15) {
          allDiagnostics.push(`Continuing for extra verification...`);
          continue;
        } else {
          break;
        }
      }
    }
    
    // FINAL EXHAUSTIVE CHECK
    allDiagnostics.push(`\n========== FINAL EXHAUSTIVE CHECK ==========`);
    
    const finalConvos = await base44.entities.Conversation.filter(
      { character_ids: [ETHAN_ID] }
    );
    
    let absoluteFinalUnread = 0;
    for (const convo of finalConvos) {
      const msgs = await base44.entities.Message.filter(
        { conversation_id: convo.id, is_read: false, sender_type: 'character' }
      );
      absoluteFinalUnread += msgs.length;
      
      if (msgs.length > 0) {
        allDiagnostics.push(`⚠️ Still unread in ${convo.type} "${convo.title}": ${msgs.length}`);
        
        // FORCE mark everything as read one final time
        for (const msg of msgs) {
          await base44.entities.Message.update(msg.id, { is_read: true });
          allFixes.push(`FINAL: Force marked ${msg.id.substring(0, 8)} as read`);
        }
      }
    }
    
    allDiagnostics.push(`Final unread count: ${absoluteFinalUnread}`);
    allDiagnostics.push(`Total loops executed: ${loopCount}`);
    
    if (absoluteFinalUnread === 0) {
      allDiagnostics.push(`✓✓✓ SUCCESS: Ethan's unread is completely clear. Red dot MUST disappear.`);
    } else {
      allDiagnostics.push(`✗✗✗ FAILED: Still ${absoluteFinalUnread} unread. Investigating further...`);
    }
    
    return Response.json({
      success: absoluteFinalUnread === 0,
      loops_executed: loopCount,
      final_unread_count: absoluteFinalUnread,
      deleted_message_count: allDeletedMessages.length,
      fixes_count: allFixes.length,
      diagnostics: allDiagnostics.join('\n'),
      fixes: allFixes.slice(0, 50), // Return first 50 fixes
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});