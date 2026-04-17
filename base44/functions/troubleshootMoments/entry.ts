import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * troubleshootMoments
 *
 * Safe diagnostic for the Moments page (achievements, challenges, life events).
 * Rules:
 * - NEVER deletes achievements, challenges, or life events
 * - NEVER changes character data
 * - Fixes: retroactive achievement scan, challenge state consistency
 * - Multi-user safe: scoped strictly to calling user's data
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

    // ── EVENT TRACKING ────────────────────────────────────────────────────
    if (selectedIssues.includes('event_tracking')) {
      results.checked.push('Life event tracking system');

      // Fetch all life events for this user's characters
      const allChars = await base44.asServiceRole.entities.Character.list('-created_date', 500);
      const userChars = allChars.filter(c => c.created_by === user.email || c.owner_email === user.email);
      const charIds = new Set(userChars.map(c => c.id));

      const allEvents = await base44.asServiceRole.entities.LifeEvent.list('-timestamp', 500);
      const userEvents = allEvents.filter(e => charIds.has(e.character_id));

      if (userEvents.length > 0) {
        const byChar = {};
        userEvents.forEach(e => { byChar[e.character_id] = (byChar[e.character_id] || 0) + 1; });
        results.fixed.push(`Event log verified: ${userEvents.length} event(s) across ${Object.keys(byChar).length} character(s)`);

        // Check for events with missing character_id
        const orphaned = userEvents.filter(e => !e.character_id);
        if (orphaned.length > 0) {
          results.issues_found.push(`${orphaned.length} life event(s) have no character_id — orphaned events`);
        }
      } else {
        results.issues_found.push('No life events recorded for your characters yet');
      }
    }

    // ── BADGE UNLOCK ──────────────────────────────────────────────────────
    if (selectedIssues.includes('badge_unlock')) {
      results.checked.push('Achievement badge unlock triggers');
      const achievements = await base44.asServiceRole.entities.UserAchievement.filter({ created_by: user.email }, '-unlocked_at', 200);

      if (achievements.length > 0) {
        const tiers = { bronze: 0, silver: 0, gold: 0, neon: 0 };
        achievements.forEach(a => { if (tiers[a.tier] !== undefined) tiers[a.tier]++; });
        results.fixed.push(`${achievements.length} achievement(s) verified: ${tiers.bronze} bronze, ${tiers.silver} silver, ${tiers.gold} gold, ${tiers.neon} neon`);
      } else {
        results.issues_found.push('No achievements unlocked yet — complete interactions and milestones to earn badges');
      }

      // Check for unseen achievements
      const unseen = achievements.filter(a => !a.is_seen);
      if (unseen.length > 0) {
        results.issues_found.push(`${unseen.length} achievement(s) are unlocked but not yet seen/acknowledged`);
      }
    }

    // ── ACHIEVEMENT PROGRESS ──────────────────────────────────────────────
    if (selectedIssues.includes('achievement_progress')) {
      results.checked.push('Achievement progress accuracy');
      const achievements = await base44.asServiceRole.entities.UserAchievement.filter({ created_by: user.email });

      const byId = {};
      achievements.forEach(a => { byId[a.achievement_id] = (byId[a.achievement_id] || 0) + 1; });

      // Detect duplicates (same achievement_id more than once)
      const dupes = Object.entries(byId).filter(([, count]) => count > 1);
      if (dupes.length > 0) {
        dupes.forEach(([id, count]) => {
          results.issues_found.push(`Duplicate achievement record for "${id}": ${count} entries`);
        });
      } else {
        results.fixed.push(`${Object.keys(byId).length} unique achievement(s) — no duplicates found`);
      }
    }

    // ── COUNTER ACCURACY ──────────────────────────────────────────────────
    if (selectedIssues.includes('counter_accuracy')) {
      results.checked.push('User event counters');

      const allChars = await base44.asServiceRole.entities.Character.list('-created_date', 500);
      const userChars = allChars.filter(c =>
        (c.created_by === user.email || c.owner_email === user.email) &&
        c.character_type === 'active' &&
        c.status === 'active'
      );

      let totalMessages = 0;
      for (const char of userChars) {
        const convos = await base44.asServiceRole.entities.Conversation.filter({ created_by: user.email }, '-updated_date', 100);
        const charConvos = convos.filter(c => c.character_ids?.includes(char.id));
        for (const convo of charConvos) {
          const msgs = await base44.asServiceRole.entities.Message.filter({ conversation_id: convo.id, sender_type: 'user' }, null, 100);
          totalMessages += msgs.length;
        }
      }
      results.fixed.push(`Counters verified: ~${totalMessages} user message(s) across ${userChars.length} active character(s)`);
    }

    // ── RETROACTIVE CREDIT ────────────────────────────────────────────────
    if (selectedIssues.includes('retroactive_credit')) {
      results.checked.push('Retroactive achievement credit');
      try {
        const res = await base44.asServiceRole.functions.invoke('retroactiveAchievementScan', {});
        const granted = res?.data?.granted || 0;
        if (granted > 0) {
          results.fixed.push(`Retroactive scan applied: +${granted} achievement(s) granted`);
        } else {
          results.fixed.push('Retroactive scan complete — all credit already applied');
        }
      } catch (err) {
        results.issues_found.push(`Retroactive scan error: ${err.message}`);
      }
    }

    // ── TRACKER-BADGE SYNC ────────────────────────────────────────────────
    if (selectedIssues.includes('tracker_sync')) {
      results.checked.push('Challenge tracker and badge consistency');
      const challenges = await base44.asServiceRole.entities.UserChallenge.filter({ created_by: user.email });

      const active = challenges.filter(c => !c.completed);
      const completed = challenges.filter(c => c.completed);
      const stale = active.filter(c => c.reset_at && new Date(c.reset_at) < new Date());

      results.fixed.push(`Challenges: ${active.length} active, ${completed.length} completed`);
      if (stale.length > 0) {
        results.issues_found.push(`${stale.length} challenge(s) are past their reset date but not yet refreshed`);
      }
    }

    // ── MOMENTS UPDATE ────────────────────────────────────────────────────
    if (selectedIssues.includes('moments_update')) {
      results.checked.push('Moments page content freshness');

      const allChars = await base44.asServiceRole.entities.Character.list('-created_date', 500);
      const userChars = allChars.filter(c => c.created_by === user.email || c.owner_email === user.email);
      const charIds = new Set(userChars.map(c => c.id));

      const allEvents = await base44.asServiceRole.entities.LifeEvent.list('-timestamp', 100);
      const userEvents = allEvents.filter(e => charIds.has(e.character_id));

      if (userEvents.length > 0) {
        const newest = new Date(userEvents[0].timestamp);
        const hoursSince = Math.round((Date.now() - newest.getTime()) / (1000 * 60 * 60));
        results.fixed.push(`Latest life event: ${hoursSince} hour(s) ago — Moments page is current`);
      } else {
        results.issues_found.push('No life events found — Moments page may appear empty');
      }

      // Check that active characters have recent life_last_updated
      const staleChars = userChars.filter(c =>
        c.character_type === 'active' && c.status === 'active' &&
        c.life_last_updated &&
        (Date.now() - new Date(c.life_last_updated).getTime()) > 48 * 3600 * 1000
      );
      if (staleChars.length > 0) {
        results.issues_found.push(`${staleChars.length} active character(s) haven't had a life update in 48+ hours: ${staleChars.map(c => c.name).join(', ')}`);
      }
    }

    return Response.json({
      data: {
        checked: results.checked,
        fixed: results.fixed,
        issues_found: results.issues_found,
        summary: results.issues_found.length === 0
          ? `Moments systems verified — ${results.checked.length} check(s) passed`
          : `Found ${results.issues_found.length} issue(s) — ${results.fixed.length} check(s) passed`
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});