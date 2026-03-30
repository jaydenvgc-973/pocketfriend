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

    // CARD DATA CHECK — only run if selected
    if (selectedIssues.includes('card_data')) {
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

    // CHARACTER SEPARATION / CROSS-CONTAMINATION CHECK
    if (selectedIssues.includes('character_separation')) {
      results.checked.push('Character data separation audit');

      // Group characters by name to find duplicates from recovery
      const nameMap = {};
      for (const char of characters) {
        const key = char.name?.toLowerCase().trim();
        if (!key) continue;
        if (!nameMap[key]) nameMap[key] = [];
        nameMap[key].push(char);
      }

      for (const [name, chars] of Object.entries(nameMap)) {
        if (chars.length > 1) {
          results.issues_found.push(`Duplicate character records for "${name}": ${chars.map(c => `${c.id} (${c.status || 'active'})`).join(' | ')}`);
        }
      }

      // Check for shared conversations between distinct characters (cross-routing)
      for (const char of characters) {
        const convos = await base44.entities.Conversation.filter(
          { character_ids: [char.id] },
          '-updated_date',
          20
        );
        const crossLinked = convos.filter(c =>
          c.character_ids && c.character_ids.length > 1 && c.type === 'direct'
        );
        if (crossLinked.length > 0) {
          results.issues_found.push(`${char.name}: ${crossLinked.length} direct conversation(s) contain multiple character IDs — possible cross-routing. Conversation IDs: ${crossLinked.map(c => c.id).join(', ')}`);
        }
      }

      if (results.issues_found.length === 0) {
        results.fixed.push('All characters have unique records and isolated conversations');
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
        fixes_applied: results.fixed, // alias for UI compatibility
        issues_found: results.issues_found,
        summary: results.issues_found.length === 0
          ? 'All selected checks passed'
          : `Found ${results.issues_found.length} issue(s) — ${results.fixed.length > 0 ? `${results.fixed.length} fix(es) applied` : 'review details above'}`
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});