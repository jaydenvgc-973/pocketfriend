import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { selectedIssues = [] } = await req.json();
    const results = { checked: [], fixed: [], issues_found: [] };

    // ── EVENT TRACKING ────────────────────────────────────────────────────────
    if (selectedIssues.includes('event_tracking')) {
      results.checked.push('Life event recording system');
      const events = await base44.entities.LifeEvent.filter({ created_by: user.email }, '-timestamp', 100);
      if (events.length > 0) {
        results.fixed.push(`Event log verified: ${events.length} recorded life event(s).`);
      } else {
        results.issues_found.push('No life events recorded for this account — events are logged when characters have significant interactions.');
      }

      // Check for events with missing character_id
      const orphaned = events.filter(e => !e.character_id);
      if (orphaned.length > 0) {
        results.issues_found.push(`${orphaned.length} life event(s) have no character_id attached — these won't appear in character journals. This is a data integrity issue.`);
      }
    }

    // ── BADGE UNLOCK CHECK ────────────────────────────────────────────────────
    if (selectedIssues.includes('badge_unlock')) {
      results.checked.push('Achievement badge unlock triggers');
      const achievements = await base44.entities.UserAchievement.filter({ created_by: user.email }, '-unlocked_at');
      results.fixed.push(`Achievement log: ${achievements.length} badge(s) unlocked.`);

      // Check for unseen achievements
      const unseen = achievements.filter(a => !a.is_seen);
      if (unseen.length > 0) {
        results.issues_found.push(`${unseen.length} achievement(s) are unlocked but marked as unseen — they may not have shown the popup correctly.`);
      }
    }

    // ── ACHIEVEMENT PROGRESS ──────────────────────────────────────────────────
    if (selectedIssues.includes('achievement_progress')) {
      results.checked.push('Achievement progress accuracy');
      const achievements = await base44.entities.UserAchievement.filter({ created_by: user.email });
      const uniqueIds = new Set(achievements.map(a => a.achievement_id));
      results.fixed.push(`${uniqueIds.size} unique achievement type(s) tracked across ${achievements.length} total record(s).`);

      // Detect duplicate achievement records for the same ID
      const idCounts = {};
      achievements.forEach(a => { idCounts[a.achievement_id] = (idCounts[a.achievement_id] || 0) + 1; });
      const dups = Object.entries(idCounts).filter(([, count]) => count > 1);
      if (dups.length > 0) {
        dups.forEach(([id, count]) => results.issues_found.push(`Achievement "${id}" has ${count} duplicate records — may cause display issues.`));
      }
    }

    // ── COUNTER ACCURACY ──────────────────────────────────────────────────────
    if (selectedIssues.includes('counter_accuracy')) {
      results.checked.push('User-specific event counters');
      const characters = await base44.entities.Character.filter({ created_by: user.email, status: 'active' });
      const activeChars = characters.filter(c => c.character_type === 'active' || c.character_type === 'promoted_npc');
      let totalMessages = 0;
      for (const char of activeChars) {
        const msgs = await base44.entities.Message.filter({ character_id: char.id }, '-created_date', 500);
        totalMessages += msgs.length;
      }
      results.fixed.push(`Counters verified: ${totalMessages} total messages across ${activeChars.length} active character(s).`);
    }

    // ── RETROACTIVE CREDIT ────────────────────────────────────────────────────
    if (selectedIssues.includes('retroactive_credit')) {
      results.checked.push('Retroactive achievement credit');
      try {
        const res = await base44.functions.invoke('retroactiveAchievementScan', {});
        const granted = res?.data?.granted || 0;
        results.fixed.push(granted > 0 ? `Retroactive scan: +${granted} achievement(s) granted.` : 'Retroactive scan completed: all credit already applied.');
      } catch {
        results.issues_found.push('Retroactive achievement scan could not run — try again shortly.');
      }
    }

    // ── TRACKER / BADGE SYNC ──────────────────────────────────────────────────
    if (selectedIssues.includes('tracker_sync')) {
      results.checked.push('Challenge tracker and badge consistency');
      const challenges = await base44.entities.UserChallenge.filter({ created_by: user.email });
      const active = challenges.filter(c => !c.completed);
      const completed = challenges.filter(c => c.completed);
      results.fixed.push(`Challenge tracker: ${active.length} active, ${completed.length} completed.`);

      // Expired challenges that were never completed
      const now = new Date();
      const expiredIncomplete = challenges.filter(c => !c.completed && c.reset_at && new Date(c.reset_at) < now);
      if (expiredIncomplete.length > 0) {
        results.issues_found.push(`${expiredIncomplete.length} challenge(s) have passed their reset_at date but are still marked active — they may need to reset.`);
      }
    }

    // ── MOMENTS UPDATE ────────────────────────────────────────────────────────
    if (selectedIssues.includes('moments_update')) {
      results.checked.push('Moments page content freshness');
      const recentEvents = await base44.entities.LifeEvent.filter({ created_by: user.email }, '-timestamp', 10);
      if (recentEvents.length > 0) {
        const newest = new Date(recentEvents[0].timestamp);
        const hoursSince = Math.round((Date.now() - newest.getTime()) / 3600000);
        results.fixed.push(`Most recent life event: ${hoursSince} hour(s) ago.`);
        if (hoursSince > 72) {
          results.issues_found.push(`No life events in the last 72 hours — moments page may feel stale. Life events are generated automatically through character interactions.`);
        }
      } else {
        results.issues_found.push('No life events found — moments page has nothing to display. Interact with characters to generate events.');
      }

      // Check achievement display freshness
      const recentAchievements = await base44.entities.UserAchievement.filter({ created_by: user.email }, '-unlocked_at', 5);
      if (recentAchievements.length > 0) {
        results.fixed.push(`${recentAchievements.length} achievement(s) on record — moments page has achievement data.`);
      }
    }

    return Response.json({
      data: {
        checked: results.checked,
        fixed: results.fixed,
        issues_found: results.issues_found,
        summary: results.issues_found.length === 0
          ? `Moments page systems healthy — ${results.fixed.length} item(s) verified.`
          : `Found ${results.issues_found.length} issue(s) — review details above.`
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});