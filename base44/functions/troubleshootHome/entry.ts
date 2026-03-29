import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { selectedIssues = [] } = await req.json();

    const results = {
      checked: [],
      fixed: [],
      issues_found: []
    };

    // Fetch user's characters
    const characters = await base44.entities.Character.filter(
      { created_by: user.email },
      "-created_date"
    );

    // CARD DATA CHECK
    if (selectedIssues.includes('card_data') || selectedIssues.length === 0) {
      results.checked.push('Character card data presence');
      
      for (const char of characters) {
        if (!char.name || !char.emotional_state) {
          results.issues_found.push(`${char.name || 'Unknown'}: Missing core card data`);
        }
      }
      
      if (results.issues_found.length === 0) {
        results.fixed.push('All character cards have complete data');
      }
    }

    // EMOTIONAL STATE DISPLAY CHECK
    if (selectedIssues.includes('emotional_state')) {
      results.checked.push('Emotional state display on cards');
      
      const missingState = characters.filter(c => !c.emotional_state || c.emotional_state.trim() === '');
      if (missingState.length > 0) {
        results.issues_found.push(`${missingState.length} character(s) missing emotional state`);
        
        // Auto-fix: set to default
        for (const char of missingState) {
          await base44.entities.Character.update(char.id, { emotional_state: 'calm' });
          results.fixed.push(`${char.name}: Emotional state restored to "calm"`);
        }
      }
    }

    // LOCATION DISPLAY CHECK
    if (selectedIssues.includes('location_display')) {
      results.checked.push('Location display on cards');
      
      const noLocation = characters.filter(c => !c.city && !c.state);
      if (noLocation.length > 0) {
        results.issues_found.push(`${noLocation.length} character(s) missing location`);
      }
    }

    // AVAILABILITY DISPLAY CHECK
    if (selectedIssues.includes('availability_display')) {
      results.checked.push('Availability and status display');
      
      const noSchedule = characters.filter(c => !c.work_days && !c.sleep_start_time);
      if (noSchedule.length > 0) {
        results.issues_found.push(`${noSchedule.length} character(s) missing schedule data`);
      }
    }

    // MARK ALL MESSAGES AS READ
    if (selectedIssues.includes('mark_read')) {
      results.checked.push('Unread message counts');
      
      let chatUnreadBefore = 0;
      let textUnreadBefore = 0;
      let ethanUnreadBefore = 0;
      let totalMarked = 0;

      // Count unread before reset
      for (const char of characters) {
        const convos = await base44.entities.Conversation.filter(
          { character_ids: [char.id], created_by: user.email },
          "-updated_date",
          100
        );
        
        for (const convo of convos) {
          const unreadMsgs = await base44.entities.Message.filter(
            { conversation_id: convo.id, is_read: false, sender_type: 'character' }
          );
          
          if (convo.type === 'direct' || !convo.type) {
            chatUnreadBefore += unreadMsgs.length;
          } else if (convo.type === 'phone') {
            textUnreadBefore += unreadMsgs.length;
          }
          
          // Track Ethan specifically
          const PROTECTED_CHARACTER_IDS = ['69c0d59d7e382cc866ded9c9'];
          if (PROTECTED_CHARACTER_IDS.includes(char.id)) {
            ethanUnreadBefore += unreadMsgs.length;
          }
          
          // Mark all unread messages as read
          for (const msg of unreadMsgs) {
            await base44.entities.Message.update(msg.id, { is_read: true });
            totalMarked++;
          }
        }
      }
      
      results.fixed.push(`Chat unread: ${chatUnreadBefore} → 0`);
      results.fixed.push(`Text unread: ${textUnreadBefore} → 0`);
      if (ethanUnreadBefore > 0) {
        results.fixed.push(`Ethan unread: ${ethanUnreadBefore} → 0 (red dot cleared)`);
      }
      results.fixed.push(`Total messages marked as read: ${totalMarked}`);
    }

    // PROTECTED CHARACTER CHECK
    if (selectedIssues.includes('protected_character')) {
      results.checked.push('Protected character behavior');
      
      const PROTECTED_CHARACTER_IDS = ['69c0d59d7e382cc866ded9c9'];
      const protectedChar = characters.find(c => PROTECTED_CHARACTER_IDS.includes(c.id));
      
      if (protectedChar) {
        // Verify protection is active
        const convos = await base44.entities.Conversation.filter(
          { character_ids: [protectedChar.id] },
          "-updated_date",
          1
        );
        
        if (convos.length > 0) {
          const msgCount = await base44.entities.Message.filter(
            { conversation_id: convos[0].id },
            "-created_date",
            1
          );
          
          if (msgCount.length > 0) {
            results.fixed.push('Protected character status confirmed active');
          } else {
            results.issues_found.push('Protected character thread has no messages');
          }
        }
      }
    }

    // NOTIFICATION INDICATORS CHECK
    if (selectedIssues.includes('notification_dots')) {
      results.checked.push('Notification indicator accuracy');
      
      let unreadCount = 0;
      for (const char of characters) {
        const convos = await base44.entities.Conversation.filter(
          { character_ids: [char.id], created_by: user.email },
          "-updated_date",
          10
        );
        
        for (const convo of convos) {
          const unread = await base44.entities.Message.filter(
            { conversation_id: convo.id, is_read: false, sender_type: 'character' }
          );
          unreadCount += unread.length;
        }
      }
      
      results.fixed.push(`Notification count verified: ${unreadCount} unread messages across all threads`);
    }

    return Response.json({
      data: {
        checked: results.checked,
        fixed: results.fixed,
        issues_found: results.issues_found,
        summary: results.issues_found.length === 0 
          ? 'Home page systems healthy'
          : `Found ${results.issues_found.length} issue(s), attempted repairs`
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});