/**
 * GLOBAL AUDIT: High-Use Character Degradation Pattern
 * 
 * Detects where the app punishes or degrades characters with:
 * - High message count
 * - Large Life Journal
 * - Many memories
 * - Frequent image generation
 * - Heavy interaction
 * 
 * These should trigger OPTIMIZATION, not DEGRADATION.
 * 
 * Root causes to find:
 * - Sleep debt being used as load throttle
 * - New conversation threads created instead of loading old ones
 * - Archived/hidden message logic that blocks retrieval
 * - Lazy-load failures that leave partial data
 * - Stale presence states trapping characters
 * - Conversation filters that exclude high-use convos
 * - Memory suppression based on volume
 * - Throttled image regeneration
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Load all user's characters with activity metrics
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email },
      '-updated_date',
      100
    );

    // Measure activity level for each character
    const charActivity = [];
    for (const char of allChars) {
      const msgCount = await base44.entities.Message.filter(
        { character_id: char.id },
        '-created_date',
        500
      ).then(m => m.length).catch(() => 0);

      const memCount = await base44.entities.CharacterMemory.filter(
        { character_id: char.id }
      ).then(m => m.length).catch(() => 0);

      const convoCount = await base44.entities.Conversation.filter(
        { character_ids: char.id }
      ).then(c => c.length).catch(() => 0);

      const lifeJournalLen = (char.daily_micro_narration || '').length +
                             (char.current_life_event || '').length;

      const activityScore = msgCount + memCount * 5 + convoCount * 10;

      charActivity.push({
        id: char.id,
        name: char.name,
        activity_score: activityScore,
        message_count: msgCount,
        memory_count: memCount,
        conversation_count: convoCount,
        life_journal_length: lifeJournalLen,
        sleep_debt_hours: char.sleep_debt_hours || 0,
        resolved_presence_status: char.resolved_presence_status,
        status: char.status,
        is_protected: char.is_protected,
      });
    }

    // Sort by activity
    charActivity.sort((a, b) => b.activity_score - a.activity_score);

    // DEGRADATION PATTERN DETECTION
    const findings = [];

    // Pattern 1: HIGH MESSAGE COUNT + HIGH SLEEP DEBT
    // Sleep debt should not correlate with activity
    const highMsgHighDebt = charActivity.filter(c => c.message_count > 100 && c.sleep_debt_hours > 2);
    if (highMsgHighDebt.length > 0) {
      findings.push({
        pattern: 'SLEEP_DEBT_AS_THROTTLE',
        severity: 'CRITICAL',
        description: 'High-use characters have elevated sleep debt, suggesting sleep debt is being used as a load-reduction mechanism',
        affected_characters: highMsgHighDebt.map(c => ({ id: c.id, name: c.name, msgs: c.message_count, debt: c.sleep_debt_hours })),
        root_cause: 'Sleep debt logic is triggered by message volume or interaction frequency, not by actual sleep patterns',
      });
    }

    // Pattern 2: HIGH ACTIVITY + TRAPPED IN SLEEPING STATE
    const highActivitySleeping = charActivity.filter(c =>
      c.activity_score > 100 && c.resolved_presence_status === 'sleeping'
    );
    if (highActivitySleeping.length > 0) {
      findings.push({
        pattern: 'HIGH_USE_LOCKED_IN_SLEEP',
        severity: 'CRITICAL',
        description: 'Most-active characters are stuck in sleeping state, blocking chat and interaction',
        affected_characters: highActivitySleeping.map(c => ({ id: c.id, name: c.name, activity: c.activity_score })),
        root_cause: 'Stale sleep_interrupted_at timestamps combined with high sleep debt prevent natural wake-up',
      });
    }

    // Pattern 3: HIGH MESSAGE COUNT + MULTIPLE CONVERSATIONS
    // Suggests system is creating new conversations instead of loading old ones
    const highMsgMultiConvo = charActivity.filter(c =>
      c.message_count > 50 && c.conversation_count > 3
    );
    if (highMsgMultiConvo.length > 0) {
      findings.push({
        pattern: 'DUPLICATE_CONVERSATIONS_ON_HIGH_USE',
        severity: 'HIGH',
        description: 'High-use characters have multiple fragmented conversations instead of consolidated history',
        affected_characters: highMsgMultiConvo.map(c => ({ id: c.id, name: c.name, msgs: c.message_count, convos: c.conversation_count })),
        root_cause: 'Chat page is creating new blank conversations when it should load existing ones',
      });
    }

    // Pattern 4: PROTECTED/DEFAULT FLAG BIAS
    const protectedHighUse = charActivity.filter(c =>
      c.message_count > 100 && (c.is_protected || c.status === 'active')
    );
    if (protectedHighUse.length > 0) {
      findings.push({
        pattern: 'OVERPROTECTION_OF_HIGH_USE',
        severity: 'MEDIUM',
        description: 'High-use characters may have protection flags that reduce their visibility or interaction',
        affected_characters: protectedHighUse.map(c => ({ id: c.id, name: c.name, is_protected: c.is_protected })),
      });
    }

    // COMPARISON: High-use vs Low-use character stability
    const topQuartile = charActivity.slice(0, Math.max(1, Math.ceil(charActivity.length / 4)));
    const bottomQuartile = charActivity.slice(Math.floor(charActivity.length * 0.75));

    const topAvgDebt = topQuartile.reduce((s, c) => s + c.sleep_debt_hours, 0) / topQuartile.length;
    const bottomAvgDebt = bottomQuartile.reduce((s, c) => s + c.sleep_debt_hours, 0) / bottomQuartile.length;

    const topSleepingCount = topQuartile.filter(c => c.resolved_presence_status === 'sleeping').length;
    const bottomSleepingCount = bottomQuartile.filter(c => c.resolved_presence_status === 'sleeping').length;

    const stability = {
      high_use_avg_sleep_debt: Math.round(topAvgDebt * 10) / 10,
      low_use_avg_sleep_debt: Math.round(bottomAvgDebt * 10) / 10,
      high_use_locked_sleeping: topSleepingCount,
      low_use_locked_sleeping: bottomSleepingCount,
      correlation: topAvgDebt > bottomAvgDebt ? 'CRITICAL: HIGH-USE CHARACTERS ARE MORE DEGRADED' : 'OK',
    };

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      user_email: user.email,
      total_characters: charActivity.length,
      top_10_by_activity: charActivity.slice(0, 10).map(c => ({
        name: c.name,
        activity_score: c.activity_score,
        messages: c.message_count,
        memories: c.memory_count,
        conversations: c.conversation_count,
      })),
      degradation_findings: findings,
      stability_comparison: stability,
      recommendation: stability.correlation.includes('CRITICAL')
        ? 'FIX IMMEDIATELY: High-use characters must NOT be degraded. Restructure sleep debt, conversation loading, and archiving logic.'
        : 'Monitor for degradation patterns',
    });
  } catch (error) {
    console.error('[auditHighUseCharacterDegradation]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});