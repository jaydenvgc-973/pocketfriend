import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ETHAN_ID = '69c0d59d7e382cc866ded9c9';
    const report = [];
    
    // GET ALL UNREAD IN ONE PASS
    report.push('=== ETHAN FINAL RESET ===');
    report.push('Getting all conversations...');
    
    const allConvos = await base44.entities.Conversation.filter(
      { character_ids: [ETHAN_ID] },
      "-updated_date",
      200
    );
    report.push(`Total conversations: ${allConvos.length}`);
    
    let totalUnreadFound = 0;
    let totalMarked = 0;
    const convoSummary = [];
    
    // COLLECT ALL UNREAD MESSAGES FIRST
    const allUnreadMessages = [];
    
    for (const convo of allConvos) {
      const unread = await base44.entities.Message.filter(
        { conversation_id: convo.id, is_read: false, sender_type: 'character' }
      );
      
      if (unread.length > 0) {
        convoSummary.push(`${convo.type}: "${convo.title}" = ${unread.length} unread`);
        totalUnreadFound += unread.length;
        allUnreadMessages.push(...unread.map(m => ({ id: m.id, convoType: convo.type })));
      }
    }
    
    report.push(`Total unread found: ${totalUnreadFound}`);
    report.push('Conversations with unread:');
    convoSummary.forEach(s => report.push(`  - ${s}`));
    
    // MARK ALL AS READ IN ONE BATCH
    report.push('\nMarking all as read...');
    for (const msg of allUnreadMessages) {
      try {
        await base44.entities.Message.update(msg.id, { is_read: true });
        totalMarked++;
      } catch (e) {
        report.push(`Failed to mark ${msg.id.substring(0, 8)}: ${e.message}`);
      }
    }
    
    report.push(`Marked as read: ${totalMarked}/${totalUnreadFound}`);
    
    // VERIFY FINAL STATE
    report.push('\nFinal verification...');
    let finalUnread = 0;
    
    for (const convo of allConvos) {
      const verify = await base44.entities.Message.filter(
        { conversation_id: convo.id, is_read: false, sender_type: 'character' }
      );
      if (verify.length > 0) {
        report.push(`⚠️ STILL UNREAD: ${convo.type} "${convo.title}": ${verify.length}`);
        finalUnread += verify.length;
      }
    }
    
    report.push(`\nFinal unread count: ${finalUnread}`);
    
    if (finalUnread === 0) {
      report.push('✓ SUCCESS: Red dot should be gone now');
    } else {
      report.push(`✗ ERROR: ${finalUnread} messages still unread`);
    }
    
    return Response.json({
      success: finalUnread === 0,
      total_found: totalUnreadFound,
      total_marked: totalMarked,
      final_unread: finalUnread,
      report: report.join('\n'),
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});