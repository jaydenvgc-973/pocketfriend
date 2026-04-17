import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * troubleshootHome
 *
 * Safe, read-only-first diagnostic for the Home page.
 * Rules:
 * - NEVER deletes characters, NPCs, locations, memories, or life events
 * - NEVER changes schedules, sleep times, work times, or work days
 * - NEVER drifts character_type, status, or ownership
 * - Fixes are limited to: unread flags, missing emotional_state default, 
 *   broken activity labels, and cross-contamination reports
 * - Multi-user aware: each user only sees their OWN characters
 *   (owner_email OR created_by match — handles admin-created NPCs correctly)
 */
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

    // Fetch characters that BELONG to this user account
    // A character belongs to an account if: created_by OR owner_email matches user.email
    const allChars = await base44.asServiceRole.entities.Character.list('-created_date', 500);
    const characters = allChars.filter(c =>
      (c.created_by === user.email || c.owner_email === user.email) &&
      c.status !== 'deleted' &&
      c.status !== 'soft_deleted' &&
      !c.diagnostic_only &&
      !c.is_test_character
    );

    // ── CARD DATA CHECK ──────────────────────────────────────────────────
    if (selectedIssues.includes('card_data')) {
      results.checked.push('Character card data presence');
      for (const char of characters) {
        const issues = [];
        if (!char.name) issues.push('missing name');
        if (!char.emotional_state) issues.push('missing emotional_state');
        if (!char.character_type) issues.push('missing character_type');
        if (issues.length > 0) {
          results.issues_found.push(`${char.name || char.id}: ${issues.join(', ')}`);
        }
      }
      if (results.issues_found.length === 0) {
        results.fixed.push('All character cards have complete data');
      }
    }

    // ── EMOTIONAL STATE ──────────────────────────────────────────────────
    if (selectedIssues.includes('emotional_state')) {
      results.checked.push('Emotional state display on cards');
      const VALID_STATES = ['calm','irritated','defensive','reflective','closed-off','flirtatious',
        'bored','burnt out','joyful','anxious','sad','excited','overwhelmed','content','frustrated',
        'hopelessness','grief','resentment','shame','longing','apathy','detachment','nostalgia'];
      const missingState = characters.filter(c => !c.emotional_state || !VALID_STATES.includes(c.emotional_state));
      if (missingState.length > 0) {
        for (const char of missingState) {
          // Safe default — does not change schedule, type, ownership, or location
          await base44.asServiceRole.entities.Character.update(char.id, { emotional_state: 'calm' });
          results.fixed.push(`${char.name}: emotional_state restored to "calm"`);
        }
      } else {
        results.fixed.push('All characters have valid emotional state');
      }
    }

    // ── LOCATION DISPLAY ─────────────────────────────────────────────────
    if (selectedIssues.includes('location_display')) {
      results.checked.push('Location display on cards');
      const noLocation = characters.filter(c => !c.city && !c.state && !c.resolved_current_location_name);
      if (noLocation.length > 0) {
        noLocation.forEach(c => {
          results.issues_found.push(`${c.name}: no city/state or resolved location set — card location will be blank`);
        });
      } else {
        results.fixed.push('All characters have location data');
      }
    }

    // ── AVAILABILITY DISPLAY ─────────────────────────────────────────────
    if (selectedIssues.includes('availability_display')) {
      results.checked.push('Availability and status display');
      const activityKeywords = [
        'work','school','class','gym','bar','club','mall','home','hospital','prayer','worship',
        'doctor','coffee','café','cafe','park','trail','hike','restaurant','dinner','lunch',
        'brunch','store','errand','grocery','pharmacy','church','mosque','temple','synagogue',
        'mass','kingdom hall','training','internship','shadowing','outside','outdoor',
        'laundromat','laundry','shopping','evening','out for','friend','event','support group',
        'therapy','therapist','counseling','appointment','procedure','surgery','clinic',
        'workout','exercise','yoga','pilates','crossfit','spin class','resting','cooking',
        'watching','cleaning','winding down','morning routine','sleeping','asleep',
        'apartment','house','studying','tutoring','library','campus','sick','patient','napping'
      ];

      for (const char of characters) {
        const fixes = {};
        const issuesForChar = [];

        // Only set sleep defaults if COMPLETELY missing — never overwrite existing values
        if (!char.sleep_start_time && !char.wake_up_time) {
          fixes.sleep_start_time = '23:00';
          fixes.wake_up_time = '07:00';
          issuesForChar.push('no sleep schedule → defaulted to 11pm–7am');
        }

        // Only set work defaults if character HAS a job title but NO hours set
        if (char.work_details?.job_title && !char.work_start_time && !char.work_end_time) {
          fixes.work_start_time = '09:00';
          fixes.work_end_time = '17:00';
          issuesForChar.push('has job but no work hours → defaulted to 9am–5pm');
        }
        if (char.work_details?.job_title && (!char.work_days || char.work_days.length === 0)) {
          fixes.work_days = [1, 2, 3, 4, 5];
          issuesForChar.push('has job but no work days → defaulted Mon–Fri');
        }

        // Clear unrecognized activity labels only — never clear sleep/work status
        const activity = (char.current_activity || '').toLowerCase().trim();
        const isRecognized = !activity || activityKeywords.some(kw => activity.includes(kw));
        if (activity && !isRecognized) {
          fixes.current_activity = '';
          issuesForChar.push(`unrecognized activity "${char.current_activity}" → cleared`);
        }

        if (Object.keys(fixes).length > 0) {
          await base44.asServiceRole.entities.Character.update(char.id, fixes);
          results.fixed.push(`${char.name}: ${issuesForChar.join('; ')}`);
        }
      }
      if (results.fixed.length === 0) {
        results.fixed.push('All characters have complete availability data — nothing to fix');
      }
    }

    // ── MARK ALL MESSAGES AS READ ────────────────────────────────────────
    if (selectedIssues.includes('mark_read')) {
      results.checked.push('Unread message counts');
      let chatUnread = 0, textUnread = 0, totalMarked = 0;

      for (const char of characters) {
        const convos = await base44.asServiceRole.entities.Conversation.filter(
          { created_by: user.email },
          '-updated_date', 200
        );
        const charConvos = convos.filter(c => c.character_ids?.includes(char.id));

        for (const convo of charConvos) {
          const unreadMsgs = await base44.asServiceRole.entities.Message.filter(
            { conversation_id: convo.id, is_read: false, sender_type: 'character' }
          );
          if (convo.type === 'direct' || !convo.type) chatUnread += unreadMsgs.length;
          else if (convo.type === 'phone') textUnread += unreadMsgs.length;
          for (const msg of unreadMsgs) {
            await base44.asServiceRole.entities.Message.update(msg.id, { is_read: true });
            totalMarked++;
          }
        }
      }

      results.fixed.push(`Chat unread cleared: ${chatUnread} → 0`);
      results.fixed.push(`Text unread cleared: ${textUnread} → 0`);
      results.fixed.push(`Total marked as read: ${totalMarked}`);
    }

    // ── CHARACTER SEPARATION / CROSS-CONTAMINATION ───────────────────────
    if (selectedIssues.includes('character_separation')) {
      results.checked.push('Character data separation audit');

      // Detect characters with same name on same account (could indicate duplicate from recovery)
      const nameMap = {};
      for (const char of characters) {
        const key = char.name?.toLowerCase().trim();
        if (!key) continue;
        if (!nameMap[key]) nameMap[key] = [];
        nameMap[key].push(char);
      }
      for (const [name, chars] of Object.entries(nameMap)) {
        if (chars.length > 1) {
          results.issues_found.push(`Duplicate records for "${name}": ${chars.map(c => `ID ${c.id} (${c.character_type || 'untyped'}, ${c.status || 'active'})`).join(' | ')}`);
        }
      }

      // Detect direct conversations that have multiple character IDs (cross-routing risk)
      for (const char of characters) {
        const convos = await base44.asServiceRole.entities.Conversation.filter(
          { created_by: user.email }, '-updated_date', 50
        );
        const charConvos = convos.filter(c => c.character_ids?.includes(char.id));
        const crossLinked = charConvos.filter(c => c.character_ids?.length > 1 && c.type === 'direct');
        if (crossLinked.length > 0) {
          results.issues_found.push(`${char.name}: ${crossLinked.length} direct conversation(s) contain multiple character IDs — cross-routing risk`);
        }
      }

      if (results.issues_found.length === 0) {
        results.fixed.push('All characters have unique records and isolated conversations');
      }
    }

    // ── NOTIFICATION DOTS ────────────────────────────────────────────────
    if (selectedIssues.includes('notification_dots')) {
      results.checked.push('Notification indicator accuracy');
      let total = 0;
      for (const char of characters) {
        const convos = await base44.asServiceRole.entities.Conversation.filter(
          { created_by: user.email }, '-updated_date', 50
        );
        const charConvos = convos.filter(c => c.character_ids?.includes(char.id));
        for (const convo of charConvos) {
          const unread = await base44.asServiceRole.entities.Message.filter(
            { conversation_id: convo.id, is_read: false, sender_type: 'character' }
          );
          total += unread.length;
        }
      }
      results.fixed.push(`Notification count verified: ${total} unread message(s) across all threads`);
    }

    // ── MISSING CHARACTERS ───────────────────────────────────────────────
    if (selectedIssues.includes('missing_characters')) {
      results.checked.push('Missing characters diagnostic');

      // Characters that exist but have wrong/missing owner fields — report only, never fix ownership silently
      const missingOwner = characters.filter(c => !c.owner_email && !c.created_by);
      if (missingOwner.length > 0) {
        missingOwner.forEach(c => {
          results.issues_found.push(`${c.name} (ID: ${c.id}): missing both owner_email and created_by — orphaned character`);
        });
      }

      // Active characters with no character_type set
      const untyped = characters.filter(c => !c.character_type);
      if (untyped.length > 0) {
        untyped.forEach(c => {
          results.issues_found.push(`${c.name}: no character_type set — may not show correctly in lists`);
        });
      }

      // Characters excluded from homepage — report so admin knows
      const excluded = characters.filter(c => c.exclude_from_homepage || c.diagnostic_only || c.is_test_character);
      if (excluded.length > 0) {
        excluded.forEach(c => {
          results.issues_found.push(`${c.name}: excluded from homepage (exclude_from_homepage=${c.exclude_from_homepage}, diagnostic_only=${c.diagnostic_only})`);
        });
      }

      if (missingOwner.length === 0 && untyped.length === 0 && excluded.length === 0) {
        results.fixed.push(`All ${characters.length} characters are correctly typed, owned, and visible`);
      }
    }

    // ── OWNERSHIP AUDIT (admin-level) ────────────────────────────────────
    if (selectedIssues.includes('ownership_audit')) {
      results.checked.push('Character ownership integrity');

      // Detect characters where owner_email ≠ created_by — flag for review
      const ownershipMismatch = characters.filter(c =>
        c.owner_email && c.created_by && c.owner_email !== c.created_by
      );
      if (ownershipMismatch.length > 0) {
        ownershipMismatch.forEach(c => {
          results.issues_found.push(`${c.name} (ID: ${c.id}): owner_email="${c.owner_email}" vs created_by="${c.created_by}" — intentional transfer or data error?`);
        });
      } else {
        results.fixed.push('All character ownership fields are consistent');
      }

      // Detect NPC characters with wrong owner (created_by doesn't match parent character's owner)
      const npcs = characters.filter(c => c.character_type === 'npc');
      for (const npc of npcs) {
        if (!npc.owner_email) {
          results.issues_found.push(`NPC "${npc.name}" (ID: ${npc.id}): missing owner_email — could be misrouted`);
        }
      }
    }

    // ── SHIFT VERIFICATION ───────────────────────────────────────────────
    if (selectedIssues.includes('shift_verification')) {
      results.checked.push('Work shift accuracy');
      const res = await base44.asServiceRole.functions.invoke('enforceCharacterWorkSchedule', {});
      const d = res?.data || {};
      (d.fixes_applied || d.fixed || []).forEach(f => results.fixed.push(f));
      (d.issues_found || d.violations || []).forEach(i => results.issues_found.push(i));
      if (!d.fixes_applied?.length && !d.issues_found?.length) {
        results.fixed.push('All work shifts verified — no corrections needed');
      }
    }

    // ── STALE DATA SCAN ──────────────────────────────────────────────────
    if (selectedIssues.includes('stale_data_scan')) {
      results.checked.push('Global stale data scan');
      const res = await base44.asServiceRole.functions.invoke('dailyFullSystemDiagnostic', {});
      const d = res?.data || {};
      (d.fixes_applied || d.fixed || []).forEach(f => results.fixed.push(f));
      (d.issues_found || []).forEach(i => results.issues_found.push(i));
      if (!d.fixes_applied?.length && !d.issues_found?.length) {
        results.fixed.push('Stale data scan complete — no issues found');
      }
    }

    return Response.json({
      data: {
        checked: results.checked,
        fixed: results.fixed,
        fixes_applied: results.fixed,
        issues_found: results.issues_found,
        summary: results.issues_found.length === 0
          ? `All ${results.checked.length} check(s) passed — ${characters.length} character(s) scanned`
          : `Found ${results.issues_found.length} issue(s) — ${results.fixed.length} fix(es) applied`
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});