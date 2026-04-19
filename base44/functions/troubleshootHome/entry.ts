import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { selectedIssues = [] } = await req.json();

    const results = {
      checked: [],
      fixed: [],
      issues_found: []
    };

    // Fetch ONLY this user's characters — never global
    const characters = await base44.entities.Character.filter(
      { created_by: user.email },
      '-created_date'
    );

    // CARD DATA CHECK
    if (selectedIssues.includes('card_data')) {
      results.checked.push('Character card data presence');
      for (const char of characters) {
        if (!char.name || !char.emotional_state) {
          results.issues_found.push(`${char.name || 'Unknown'}: Missing core card data (emotional_state)`);
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
        for (const char of missingState) {
          await base44.entities.Character.update(char.id, { emotional_state: 'calm' });
          results.fixed.push(`${char.name}: Emotional state restored to "calm"`);
        }
      } else {
        results.fixed.push('All characters have an emotional state set');
      }
    }

    // LOCATION DISPLAY CHECK
    if (selectedIssues.includes('location_display')) {
      results.checked.push('Location display on cards');
      const noLocation = characters.filter(c => !c.city && !c.state);
      if (noLocation.length > 0) {
        results.issues_found.push(`${noLocation.length} character(s) missing city/state location data`);
      } else {
        results.fixed.push('All characters have location data');
      }
    }

    // AVAILABILITY DISPLAY CHECK + AUTO-FIX
    if (selectedIssues.includes('availability_display')) {
      results.checked.push('Availability and status display (all activity types)');

      const activityKeywords = [
        'work', 'school', 'class', 'gym', 'bar', 'club', 'mall', 'home', 'hospital',
        'prayer', 'worship', 'doctor', 'coffee', 'café', 'cafe', 'park', 'trail', 'hike',
        'restaurant', 'dinner', 'lunch', 'brunch', 'store', 'errand', 'grocery', 'pharmacy',
        'church', 'mosque', 'temple', 'synagogue', 'mass', 'kingdom hall',
        'training', 'internship', 'shadowing', 'outside', 'outdoor', 'laundromat', 'laundry',
        'shopping', 'evening', 'out for', 'friend', 'event', 'support group', 'therapy',
        'therapist', 'counseling', 'appointment', 'procedure', 'surgery', 'clinic',
        'workout', 'exercise', 'yoga', 'pilates', 'crossfit', 'spin class',
        'resting', 'cooking', 'watching', 'cleaning', 'winding down', 'morning routine',
        'sleeping', 'asleep', 'apartment', 'house', 'studying', 'tutoring', 'library', 'campus',
        'sick', 'patient'
      ];

      for (const char of characters) {
        const fixes = {};
        const charIssues = [];

        if (!char.sleep_start_time || !char.wake_up_time) {
          fixes.sleep_start_time = '23:00';
          fixes.wake_up_time = '07:00';
          charIssues.push('missing sleep schedule → set to 11pm–7am');
        }

        if (char.work_details?.job_title && (!char.work_start_time || !char.work_end_time)) {
          fixes.work_start_time = '09:00';
          fixes.work_end_time = '17:00';
          charIssues.push('missing work hours → set to 9am–5pm');
        }

        if (char.work_details?.job_title && (!char.work_days || char.work_days.length === 0)) {
          fixes.work_days = [1, 2, 3, 4, 5];
          charIssues.push('missing work days → set to Mon–Fri');
        }

        // Clear unrecognized current_activity values
        const activity = (char.current_activity || '').toLowerCase().trim();
        const hasDetectable = !activity || activityKeywords.some(kw => activity.includes(kw));
        if (activity && !hasDetectable) {
          fixes.current_activity = '';
          charIssues.push(`unrecognized activity "${char.current_activity}" → cleared`);
        }

        if (Object.keys(fixes).length > 0) {
          await base44.entities.Character.update(char.id, fixes);
          results.fixed.push(`${char.name}: ${charIssues.join('; ')}`);
        }
      }

      if (results.fixed.length === 0) {
        results.fixed.push('All characters have complete availability/activity data — nothing to fix');
      }
    }

    // MARK ALL MESSAGES AS READ
    if (selectedIssues.includes('mark_read')) {
      results.checked.push('Unread message counts');
      let totalMarked = 0;
      let chatUnread = 0;
      let textUnread = 0;

      for (const char of characters) {
        const convos = await base44.entities.Conversation.filter(
          { character_ids: [char.id] }, '-updated_date', 100
        );
        for (const convo of convos) {
          const unreadMsgs = await base44.entities.Message.filter(
            { conversation_id: convo.id, is_read: false, sender_type: 'character' }
          );
          if (convo.type === 'direct' || !convo.type) chatUnread += unreadMsgs.length;
          else if (convo.type === 'phone') textUnread += unreadMsgs.length;

          for (const msg of unreadMsgs) {
            await base44.entities.Message.update(msg.id, { is_read: true });
            totalMarked++;
          }
        }
      }

      results.fixed.push(`Chat unread: ${chatUnread} → 0`);
      results.fixed.push(`Text unread: ${textUnread} → 0`);
      results.fixed.push(`Total messages marked as read: ${totalMarked}`);
    }

    // CHARACTER SEPARATION / CROSS-CONTAMINATION CHECK
    if (selectedIssues.includes('character_separation')) {
      results.checked.push('Character data separation audit');

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

      // Check for cross-routing in direct conversations
      for (const char of characters) {
        const convos = await base44.entities.Conversation.filter(
          { character_ids: [char.id] }, '-updated_date', 20
        );
        const crossLinked = convos.filter(c =>
          c.character_ids && c.character_ids.length > 1 && c.type === 'direct'
        );
        if (crossLinked.length > 0) {
          results.issues_found.push(`${char.name}: ${crossLinked.length} direct conversation(s) contain multiple character IDs — possible cross-routing.`);
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
          { character_ids: [char.id] }, '-updated_date', 10
        );
        for (const convo of convos) {
          const unread = await base44.entities.Message.filter(
            { conversation_id: convo.id, is_read: false, sender_type: 'character' }
          );
          unreadCount += unread.length;
        }
      }
      results.fixed.push(`Notification count verified: ${unreadCount} unread message(s) across all threads`);
    }

    // MISSING CHARACTERS CHECK
    if (selectedIssues.includes('missing_characters')) {
      results.checked.push('Missing characters diagnostic');
      const activeChars = characters.filter(c => !c.status || c.status === 'active');
      const hiddenChars = characters.filter(c => c.exclude_from_homepage === true);
      const softDeleted = characters.filter(c => c.status === 'soft_deleted');
      const merged = characters.filter(c => c.status === 'merged');

      results.fixed.push(`Total characters on this account: ${characters.length}`);
      results.fixed.push(`Active (visible): ${activeChars.length}`);
      if (hiddenChars.length > 0) results.issues_found.push(`${hiddenChars.length} character(s) have exclude_from_homepage=true and won't show on home`);
      if (softDeleted.length > 0) results.issues_found.push(`${softDeleted.length} character(s) are soft_deleted`);
      if (merged.length > 0) results.issues_found.push(`${merged.length} character(s) are merged (expected)`);

      // Check for missing required fields that would cause list exclusion
      for (const char of activeChars) {
        const missing = [];
        if (!char.name?.trim()) missing.push('name');
        if (!char.character_type) missing.push('character_type');
        if (missing.length > 0) {
          results.issues_found.push(`"${char.name || char.id}": missing required fields: ${missing.join(', ')} — may be excluded from lists`);
        }
      }
    }

    return Response.json({
      data: {
        checked: results.checked,
        fixed: results.fixed,
        fixes_applied: results.fixed,
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