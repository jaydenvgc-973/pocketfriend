import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ETHAN_ID = '69c0d59d7e382cc866ded9c9';
    const diagnostics = [];
    const fixes = [];
    const deletedMessages = [];
    
    // DIAGNOSTIC LOOP: Run up to 10 times checking for issues
    for (let iteration = 1; iteration <= 10; iteration++) {
      diagnostics.push(`\n=== ITERATION ${iteration} ===`);
      
      // 1. GET ALL ETHAN CONVERSATIONS
      const convos = await base44.entities.Conversation.filter(
        { character_ids: [ETHAN_ID], created_by: user.email },
        "-updated_date",
        100
      );
      diagnostics.push(`Found ${convos.length} Ethan conversations`);
      
      let iterationUnreadCount = 0;
      let foundIssues = false;
      
      for (const convo of convos) {
        // 2. COUNT UNREAD MESSAGES
        const unreadMsgs = await base44.entities.Message.filter(
          { conversation_id: convo.id, is_read: false, sender_type: 'character' }
        );
        iterationUnreadCount += unreadMsgs.length;
        
        if (unreadMsgs.length > 0) {
          diagnostics.push(`  [${convo.type}] ${convo.title}: ${unreadMsgs.length} unread`);
          foundIssues = true;
          
          // 3. ANALYZE EACH UNREAD MESSAGE FOR ISSUES
          for (const msg of unreadMsgs) {
            const createdDate = new Date(msg.created_date);
            const now = new Date();
            const ageMinutes = Math.round((now - createdDate) / 60000);
            
            diagnostics.push(`    Message ID: ${msg.id.substring(0, 8)} | Age: ${ageMinutes}m | Sent: ${msg.sender_type}`);
            
            // CHECK FOR STUCK/PHANTOM MESSAGES
            // - Very old unread messages (stuck for days)
            // - Messages with no content
            // - Messages that appear to be duplicates
            // - Messages sent out of chronological order
            
            if (ageMinutes > 10080) { // older than 7 days
              diagnostics.push(`    ⚠️ STUCK: Message is ${ageMinutes} minutes old (7+ days)`);
              foundIssues = true;
              
              // Delete stuck message
              await base44.entities.Message.delete(msg.id);
              deletedMessages.push(msg.id);
              fixes.push(`Deleted stuck message ${msg.id.substring(0, 8)} (age: ${ageMinutes}m)`);
            }
            
            if (!msg.content || msg.content.trim() === '') {
              diagnostics.push(`    ⚠️ PHANTOM: Message has no content`);
              foundIssues = true;
              
              // Delete phantom message
              await base44.entities.Message.delete(msg.id);
              deletedMessages.push(msg.id);
              fixes.push(`Deleted phantom message ${msg.id.substring(0, 8)} (no content)`);
            }
          }
          
          // 4. CHECK CHRONOLOGICAL ORDER
          const allCharMsgs = await base44.entities.Message.filter(
            { conversation_id: convo.id, sender_type: 'character' },
            "-created_date",
            100
          );
          
          for (let i = 0; i < allCharMsgs.length - 1; i++) {
            const curr = new Date(allCharMsgs[i].created_date);
            const next = new Date(allCharMsgs[i + 1].created_date);
            
            // Check if messages are out of order (should be descending in the array)
            if (curr < next) {
              diagnostics.push(`    ⚠️ OUT-OF-ORDER: Messages ${i} and ${i+1} are not in chronological order`);
              foundIssues = true;
            }
          }
        }
      }
      
      diagnostics.push(`Total unread in iteration ${iteration}: ${iterationUnreadCount}`);
      
      // 5. RESET ALL UNREAD IF NOT ALREADY DONE
      if (iterationUnreadCount > 0) {
        diagnostics.push(`  Marking ${iterationUnreadCount} unread messages as read...`);
        
        for (const convo of convos) {
          const unread = await base44.entities.Message.filter(
            { conversation_id: convo.id, is_read: false, sender_type: 'character' }
          );
          
          for (const msg of unread) {
            await base44.entities.Message.update(msg.id, { is_read: true });
          }
        }
        
        fixes.push(`Iteration ${iteration}: Marked ${iterationUnreadCount} messages as read`);
      }
      
      // If no issues found in this iteration, stop looping
      if (!foundIssues && iterationUnreadCount === 0) {
        diagnostics.push(`✓ Iteration ${iteration}: No issues found. Stopping checks.`);
        break;
      }
    }
    
    // FINAL VERIFICATION
    diagnostics.push(`\n=== FINAL VERIFICATION ===`);
    
    let finalUnreadCount = 0;
    const finalConvos = await base44.entities.Conversation.filter(
      { character_ids: [ETHAN_ID], created_by: user.email },
      "-updated_date",
      100
    );
    
    for (const convo of finalConvos) {
      const unread = await base44.entities.Message.filter(
        { conversation_id: convo.id, is_read: false, sender_type: 'character' }
      );
      finalUnreadCount += unread.length;
    }
    
    diagnostics.push(`Final unread count: ${finalUnreadCount}`);
    
    if (finalUnreadCount === 0) {
      diagnostics.push(`✓ SUCCESS: Ethan's notification is clear. Red dot should not appear.`);
    } else {
      diagnostics.push(`⚠️ WARNING: Still have ${finalUnreadCount} unread messages. Check for new undelivered messages.`);
    }
    
    // Check for pending messages
    const pending = await base44.entities.PendingMessage.filter(
      { character_id: ETHAN_ID, delivered: false }
    );
    
    diagnostics.push(`\nPending messages (not yet delivered): ${pending.length}`);
    if (pending.length > 0) {
      diagnostics.push(`Note: Pending messages will count as unread once delivered. This is expected behavior.`);
      for (const p of pending) {
        diagnostics.push(`  - Pending: "${p.content.substring(0, 50)}..."`);
      }
    }
    
    return Response.json({
      success: finalUnreadCount === 0,
      final_unread_count: finalUnreadCount,
      deleted_message_count: deletedMessages.length,
      deleted_messages: deletedMessages,
      pending_messages_count: pending.length,
      diagnostics: diagnostics.join('\n'),
      fixes: fixes,
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});