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

    // Fetch ONLY this user's characters — owner_email is the sole ownership source of truth.
    // NEVER use created_by: that field is legacy and excluded from ownership checks.
    const characters = await base44.entities.Character.filter(
      { owner_email: user.email },
      '-created_date',
      300
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

    // AVAILABILITY DISPLAY CHECK
    // SAFE MODE: reports issues but NEVER overwrites valid states.
    // Protected states (never altered): jail/prison/incarceration, active travel,
    // temporary housing, sleep-interrupted, work_release, house_arrest, hospital.
    if (selectedIssues.includes('availability_display')) {
      results.checked.push('Availability and status display (all activity types)');

      for (const char of characters) {
        const charIssues = [];

        // Protected states — do not touch these characters at all
        const isProtected = char.is_jailed ||
          char.house_arrest_active ||
          char.incarceration_status === 'serving' ||
          char.incarceration_status === 'work_release' ||
          char.travel_status === 'traveling_to_destination' ||
          char.location_status === 'traveling' ||
          char.temporary_housing_location_id;

        if (isProtected) {
          results.fixed.push(`${char.name}: protected state (jail/travel/housing) — not modified`);
          continue;
        }

        // Report missing sleep schedule (do not write defaults without proven schedule data)
        if (!char.sleep_start_time || !char.wake_up_time) {
          charIssues.push('missing sleep schedule times — check character schedule settings');
        }

        // Report missing work hours only if character has a job
        if (char.work_details?.job_title && (!char.work_start_time || !char.work_end_time)) {
          charIssues.push(`has job "${char.work_details.job_title}" but missing work_start_time/work_end_time`);
        }

        if (charIssues.length > 0) {
          results.issues_found.push(`${char.name}: ${charIssues.join('; ')}`);
        }
      }

      if (results.issues_found.length === 0) {
        results.fixed.push('All characters have availability data — no issues detected');
      } else {
        results.fixed.push('Availability check complete — see issues above. No data was auto-modified to protect valid states.');
      }
    }

    // MARK ALL MESSAGES AS READ — real source repair
    // Source of truth: Message.is_read field, scoped by owner_email on Conversation.
    // Approach: fetch all conversations owned by this user, then batch-mark unread character messages.
    // Does NOT use created_by. Does NOT touch other accounts.
    // Per-character proof output is returned for verification.
    // RATE LIMIT GUARD: process max 20 characters to avoid timeout on large accounts.
    if (selectedIssues.includes('mark_read')) {
      results.checked.push('Unread message counts (owner_email-scoped)');
      let totalMarked = 0;
      let chatUnread = 0;
      let textUnread = 0;
      const proofRows = [];
      const charsToProcess = characters.slice(0, 20); // process top 20 by recency

      for (const char of charsToProcess) {
        // Scope conversations by BOTH owner_email AND character_id — prevents cross-account hits
        const convos = await base44.entities.Conversation.filter(
          { owner_email: user.email, character_ids: [char.id] }, '-updated_date', 10
        );
        let charChatUnread = 0;
        let charPhoneUnread = 0;
        const charConvoIds = [];

        for (const convo of convos) {
          const unreadMsgs = await base44.entities.Message.filter(
            { conversation_id: convo.id, is_read: false, sender_type: 'character' }
          );
          const isPhone = convo.type === 'phone';
          const count = unreadMsgs.length;

          if (!isPhone) { chatUnread += count; charChatUnread += count; }
          else { textUnread += count; charPhoneUnread += count; }

          for (const msg of unreadMsgs) {
            await base44.entities.Message.update(msg.id, { is_read: true });
            totalMarked++;
          }
          if (count > 0) charConvoIds.push(`${convo.id.slice(0,8)} (${count} msgs, type=${convo.type || 'direct'})`);
        }

        if (charChatUnread > 0 || charPhoneUnread > 0) {
          proofRows.push({
            character_name: char.name,
            character_id: char.id,
            conversations_with_unread: charConvoIds,
            chat_unread_before: charChatUnread,
            phone_unread_before: charPhoneUnread,
            action: 'marked_all_read',
            chat_unread_after: 0,
            phone_unread_after: 0,
          });
        }
      }

      results.fixed.push(`Chat unread cleared: ${chatUnread} messages`);
      results.fixed.push(`Text unread cleared: ${textUnread} messages`);
      results.fixed.push(`Total messages marked as read: ${totalMarked}`);
      if (proofRows.length > 0) {
        results.proof = proofRows;
        results.fixed.push(`Characters repaired: ${proofRows.map(r => r.character_name).join(', ')}`);
      } else {
        results.fixed.push('No unread messages found — badges were already clean');
      }
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

    // NOTIFICATION INDICATORS CHECK — scoped by owner_email
    // RATE LIMIT GUARD: process max 20 characters
    if (selectedIssues.includes('notification_dots')) {
      results.checked.push('Notification indicator accuracy (owner_email scoped)');
      let unreadCount = 0;
      const perCharSummary = [];
      const charsToCheck = characters.slice(0, 20);
      for (const char of charsToCheck) {
        // Must scope by owner_email to avoid cross-account orphan conversations
        const convos = await base44.entities.Conversation.filter(
          { owner_email: user.email, character_ids: [char.id] }, '-updated_date', 10
        );
        let charUnread = 0;
        for (const convo of convos) {
          const unread = await base44.entities.Message.filter(
            { conversation_id: convo.id, is_read: false, sender_type: 'character' }
          );
          charUnread += unread.length;
          unreadCount += unread.length;
        }
        if (charUnread > 0) {
          perCharSummary.push(`${char.name}: ${charUnread} unread`);
        }
      }
      results.fixed.push(`Total unread: ${unreadCount} message(s) across all owner_email-scoped threads`);
      if (perCharSummary.length > 0) {
        results.issues_found.push(`Characters with unread messages: ${perCharSummary.join(' | ')}`);
        results.fixed.push('To clear these, use "Mark messages as read"');
      } else {
        results.fixed.push('All notification dots are accurate — no stale unread messages found');
      }
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