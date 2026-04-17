import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { selectedIssues = [] } = await req.json();

    const results = { checked: [], fixed: [], issues_found: [] };

    // Fetch ALL characters this user can see (their own + those owned by them via owner_email)
    const byCreatedBy = await base44.asServiceRole.entities.Character.filter({ created_by: user.email }, '-created_date', 300);
    const byOwnerEmail = await base44.asServiceRole.entities.Character.filter({ owner_email: user.email }, '-created_date', 300);
    // Deduplicate
    const charMap = {};
    [...byCreatedBy, ...byOwnerEmail].forEach(c => { charMap[c.id] = c; });
    const characters = Object.values(charMap);

    // ── OWNERSHIP INTEGRITY CHECK ─────────────────────────────────────────────
    // Detects characters where created_by and owner_email are out of sync.
    // SAFE: only reports, never deletes or changes any character data except fixing the mismatch.
    if (selectedIssues.includes('ownership_integrity')) {
      results.checked.push('Character ownership integrity (created_by vs owner_email)');
      let mismatchCount = 0;
      for (const char of characters) {
        const hasOwnerEmail = !!char.owner_email;
        const ownerMatchesCreated = char.owner_email === char.created_by;
        if (!hasOwnerEmail) {
          // Fix: set owner_email to created_by so RLS and ownership rules work
          await base44.asServiceRole.entities.Character.update(char.id, { owner_email: char.created_by });
          results.fixed.push(`${char.name}: owner_email was missing — set to created_by (${char.created_by})`);
          mismatchCount++;
        } else if (!ownerMatchesCreated && char.character_type !== 'npc' && char.character_type !== 'family_npc') {
          // For active characters, report mismatch without changing — needs manual review
          results.issues_found.push(`${char.name} (${char.id}): owner_email="${char.owner_email}" differs from created_by="${char.created_by}" — review ownership. If this is an NPC, this may be correct.`);
          mismatchCount++;
        }
      }
      if (mismatchCount === 0) results.fixed.push('All characters have consistent owner_email and created_by fields.');
    }

    // ── NPC ROUTING CHECK ─────────────────────────────────────────────────────
    // Ensures NPC Fictitious Persons are standalone Character records with correct owner.
    // SAFE: never deletes NPCs, never changes NPC data beyond fixing owner_email.
    if (selectedIssues.includes('npc_routing')) {
      results.checked.push('NPC standalone routing and ownership');
      const npcs = characters.filter(c => c.character_type === 'npc' || c.character_type === 'family_npc');
      let routingIssues = 0;
      for (const npc of npcs) {
        if (!npc.owner_email) {
          await base44.asServiceRole.entities.Character.update(npc.id, {
            owner_email: npc.created_by,
          });
          results.fixed.push(`NPC "${npc.name}": missing owner_email — set to ${npc.created_by}`);
          routingIssues++;
        }
        // Check if NPC is embedded in a parent character's family_members instead of being standalone
        // (detect by looking for active characters whose family_members array has a name matching this NPC)
        const activeChars = characters.filter(c => c.character_type === 'active' || c.character_type === 'promoted_npc');
        for (const ac of activeChars) {
          const embeddedMatch = (ac.family_members || []).find(fm => fm.name?.toLowerCase() === npc.name?.toLowerCase());
          if (embeddedMatch) {
            results.issues_found.push(`NPC "${npc.name}" exists as standalone Character (ID: ${npc.id}) BUT is also embedded in "${ac.name}"'s family_members array — the embedded copy should be removed manually from the family list to avoid duplication.`);
          }
        }
      }
      if (routingIssues === 0 && results.issues_found.filter(i => i.includes('family_members')).length === 0) {
        results.fixed.push(`All ${npcs.length} NPC record(s) are correctly routed as standalone characters.`);
      }
    }

    // ── MARK MESSAGES READ ────────────────────────────────────────────────────
    if (selectedIssues.includes('mark_read')) {
      results.checked.push('Unread message counts');
      let totalMarked = 0;
      for (const char of characters) {
        const convos = await base44.asServiceRole.entities.Conversation.filter(
          { character_ids: [char.id], created_by: user.email }, '-updated_date', 100
        );
        for (const convo of convos) {
          const unreadMsgs = await base44.asServiceRole.entities.Message.filter(
            { conversation_id: convo.id, is_read: false, sender_type: 'character' }
          );
          for (const msg of unreadMsgs) {
            await base44.asServiceRole.entities.Message.update(msg.id, { is_read: true });
            totalMarked++;
          }
        }
      }
      results.fixed.push(`Total messages marked as read: ${totalMarked}`);
    }

    // ── CARD DATA CHECK ───────────────────────────────────────────────────────
    if (selectedIssues.includes('card_data')) {
      results.checked.push('Character card data presence');
      const activeChars = characters.filter(c => c.character_type === 'active' || c.character_type === 'promoted_npc');
      for (const char of activeChars) {
        if (!char.name) results.issues_found.push(`Character ID ${char.id}: missing name field`);
        if (!char.emotional_state) {
          await base44.asServiceRole.entities.Character.update(char.id, { emotional_state: 'calm' });
          results.fixed.push(`${char.name}: emotional_state was missing — restored to "calm"`);
        }
      }
      if (results.issues_found.length === 0) results.fixed.push('All active character cards have complete data.');
    }

    // ── EMOTIONAL STATE ───────────────────────────────────────────────────────
    if (selectedIssues.includes('emotional_state')) {
      results.checked.push('Emotional state display');
      const missing = characters.filter(c => !c.emotional_state || c.emotional_state.trim() === '');
      for (const char of missing) {
        await base44.asServiceRole.entities.Character.update(char.id, { emotional_state: 'calm' });
        results.fixed.push(`${char.name}: emotional_state restored to "calm"`);
      }
      if (missing.length === 0) results.fixed.push('All characters have emotional state set.');
    }

    // ── LOCATION DISPLAY ──────────────────────────────────────────────────────
    // READ-ONLY: reports only, never changes location or schedule data
    if (selectedIssues.includes('location_display')) {
      results.checked.push('Location display fields (read-only report)');
      const noLocation = characters.filter(c =>
        (c.character_type === 'active' || c.character_type === 'promoted_npc') && !c.city && !c.state
      );
      if (noLocation.length > 0) {
        results.issues_found.push(`${noLocation.length} active character(s) have no city/state set: ${noLocation.map(c => c.name).join(', ')}`);
      } else {
        results.fixed.push('All active characters have location data.');
      }
    }

    // ── AVAILABILITY DISPLAY ──────────────────────────────────────────────────
    // Only fixes missing sleep schedule defaults. NEVER changes existing schedules, locations, or work data.
    if (selectedIssues.includes('availability_display')) {
      results.checked.push('Availability display — missing defaults only');
      for (const char of characters.filter(c => c.character_type === 'active' || c.character_type === 'promoted_npc')) {
        const fixes = {};
        const notes = [];
        // Only add sleep defaults if COMPLETELY missing — never overwrite existing
        if (!char.sleep_start_time && !char.wake_up_time) {
          fixes.sleep_start_time = '23:00';
          fixes.wake_up_time = '07:00';
          notes.push('no sleep schedule → defaulted to 11pm–7am');
        }
        if (Object.keys(fixes).length > 0) {
          await base44.asServiceRole.entities.Character.update(char.id, fixes);
          results.fixed.push(`${char.name}: ${notes.join('; ')}`);
        }
      }
      if (results.fixed.filter(f => f.includes('sleep')).length === 0) {
        results.fixed.push('All active characters already have sleep schedule data — nothing changed.');
      }
    }

    // ── CHARACTER SEPARATION ──────────────────────────────────────────────────
    if (selectedIssues.includes('character_separation')) {
      results.checked.push('Character data separation / cross-contamination');
      const nameMap = {};
      for (const char of characters.filter(c => c.status === 'active')) {
        const key = char.name?.toLowerCase().trim();
        if (!key) continue;
        if (!nameMap[key]) nameMap[key] = [];
        nameMap[key].push(char);
      }
      for (const [, chars] of Object.entries(nameMap)) {
        if (chars.length > 1) {
          results.issues_found.push(`Duplicate active records for "${chars[0].name}": ${chars.map(c => `${c.id} (type:${c.character_type||'?'})`).join(' | ')}`);
        }
      }
      for (const char of characters) {
        const convos = await base44.asServiceRole.entities.Conversation.filter({ character_ids: [char.id] }, '-updated_date', 20);
        const crossLinked = convos.filter(c => c.character_ids && c.character_ids.length > 1 && c.type === 'direct');
        if (crossLinked.length > 0) {
          results.issues_found.push(`${char.name}: ${crossLinked.length} direct conversation(s) contain multiple character IDs — potential cross-routing.`);
        }
      }
      if (results.issues_found.length === 0) results.fixed.push('No duplicate records or cross-linked conversations detected.');
    }

    // ── MISSING CHARACTERS ────────────────────────────────────────────────────
    if (selectedIssues.includes('missing_characters')) {
      results.checked.push('Missing characters (visible on home page)');
      // Active characters that have no conversations at all
      const activeChars = characters.filter(c => (c.character_type === 'active' || c.character_type === 'promoted_npc') && c.status === 'active');
      for (const char of activeChars) {
        const convos = await base44.asServiceRole.entities.Conversation.filter({ character_ids: [char.id], created_by: user.email });
        if (convos.length === 0) {
          results.issues_found.push(`"${char.name}" (${char.id}) has no conversations — may not appear on home page correctly. Try opening a chat with this character to initialize the thread.`);
        }
      }
      if (results.issues_found.length === 0) results.fixed.push('All active characters have at least one conversation thread.');
    }

    // ── NOTIFICATION DOTS ─────────────────────────────────────────────────────
    if (selectedIssues.includes('notification_dots')) {
      results.checked.push('Notification dot accuracy');
      let total = 0;
      for (const char of characters) {
        const convos = await base44.asServiceRole.entities.Conversation.filter({ character_ids: [char.id], created_by: user.email }, '-updated_date', 10);
        for (const convo of convos) {
          const unread = await base44.asServiceRole.entities.Message.filter({ conversation_id: convo.id, is_read: false, sender_type: 'character' });
          total += unread.length;
        }
      }
      results.fixed.push(`Verified: ${total} unread message(s) currently across all threads.`);
    }

    // ── SHIFT VERIFICATION ────────────────────────────────────────────────────
    // READ-ONLY: checks schedule vs resolved location. Never changes schedule or location.
    if (selectedIssues.includes('shift_verification')) {
      results.checked.push('Work shift vs resolved location alignment (read-only)');
      const now = new Date();
      const etHour = ((now.getUTCHours() - 4) + 24) % 24;
      const dow = now.getDay();
      for (const char of characters.filter(c => c.work_start_time && c.work_end_time)) {
        const [sh] = char.work_start_time.split(':').map(Number);
        const [eh] = char.work_end_time.split(':').map(Number);
        const onShift = (char.work_days || [1,2,3,4,5]).includes(dow) && etHour >= sh && etHour < eh;
        if (onShift && char.current_work_location_id) {
          const atWork = char.resolved_current_location_id === char.current_work_location_id;
          if (!atWork) {
            results.issues_found.push(`${char.name}: Should be at work (${sh}:00–${eh}:00) but resolved_current_location_id doesn't match work location. Resolved: ${char.resolved_current_location_id || 'not set'} | Work: ${char.current_work_location_id}`);
          } else {
            results.fixed.push(`${char.name}: Correctly at work location during shift.`);
          }
        }
      }
      if (results.issues_found.filter(i => i.includes('Should be at work')).length === 0 && results.fixed.filter(f => f.includes('Correctly at work')).length === 0) {
        results.fixed.push('No characters currently on shift — no shift conflicts to report.');
      }
    }

    // ── STALE DATA SCAN ───────────────────────────────────────────────────────
    if (selectedIssues.includes('stale_data_scan')) {
      results.checked.push('Global stale data scan');
      const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: user.email });
      const settings = settingsList[0] || {};
      if (!settings.fictional_world_name) {
        results.issues_found.push('No fictional world name set — characters will call you "the user". Set in Settings > Your Name (In-World).');
      } else {
        results.fixed.push(`World name confirmed: "${settings.fictional_world_name}"`);
      }
      const noAvatar = characters.filter(c => (c.character_type === 'active' || c.character_type === 'promoted_npc') && !c.avatar_url);
      if (noAvatar.length > 0) results.issues_found.push(`${noAvatar.length} active character(s) have no avatar: ${noAvatar.map(c => c.name).join(', ')}`);
      const noAppearanceLock = characters.filter(c => (c.character_type === 'active' || c.character_type === 'promoted_npc') && (!c.appearance_lock || !c.appearance_lock.skin_tone));
      if (noAppearanceLock.length > 0) results.issues_found.push(`${noAppearanceLock.length} active character(s) have no appearance lock — image drift risk: ${noAppearanceLock.map(c => c.name).join(', ')}`);
      if (results.issues_found.length === 0) results.fixed.push('No stale data detected across major systems.');
    }

    return Response.json({
      data: {
        checked: results.checked,
        fixed: results.fixed,
        fixes_applied: results.fixed,
        issues_found: results.issues_found,
        summary: results.issues_found.length === 0
          ? `All selected checks passed — ${results.fixed.length} item(s) confirmed/repaired.`
          : `Found ${results.issues_found.length} issue(s) — ${results.fixed.length} fix(es) applied. Review details above.`
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});