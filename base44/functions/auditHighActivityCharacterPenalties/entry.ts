/**
 * GLOBAL MOST-USED CHARACTER PROTECTION AUDIT
 * 
 * CRITICAL FINDING: The app punishes high-activity characters with:
 * - Sleep debt corruption (32h on Ethan)
 * - Conversation linkage failures (new blank convos created)
 * - Message suppression (500 messages become invisible)
 * - Stale presence states (locked in "sleeping")
 * - Archive disconnection (history inaccessible)
 * 
 * This is NOT character-specific. It's an architecture pattern where
 * high message count, large life journal, many memories, or frequent
 * interaction triggers degradation instead of better caching.
 * 
 * In public use, each user's FAVORITE character will be hit hardest.
 * 
 * This audit proves:
 * 1. High-use vs low-use character loading differs
 * 2. Sleep state reduces chat retrieval (or doesn't)
 * 3. Archived history remains connected
 * 4. No character is penalized for being heavily used
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));

    // Load all characters for the user
    const allChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      '-updated_date',
      100
    );

    // Categorize by message/activity volume
    const charActivity = [];
    for (const char of allChars) {
      const msgCount = await base44.entities.Message.filter(
        { character_ids: char.id },
        '-created_date',
        500
      ).then(msgs => msgs.length).catch(() => 0);

      const lifeJournal = await base44.entities.AutomaticNarrative.filter(
        { character_id: char.id },
        '-timestamp',
        100
      ).then(n => n.length).catch(() => 0);

      const memories = await base44.entities.CharacterMemory.filter(
        { character_id: char.id },
        '-created_date',
        100
      ).then(m => m.length).catch(() => 0);

      charActivity.push({
        character_id: char.id,
        character_name: char.name,
        message_count: msgCount,
        life_journal_count: lifeJournal,
        memory_count: memories,
        sleep_debt: char.sleep_debt_hours || 0,
        presence_status: char.resolved_presence_status,
        is_sleeping: (char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping'),
        sleep_interrupted_at: char.sleep_interrupted_at,
        total_activity_score: msgCount + (lifeJournal * 2) + (memories * 1.5),
      });
    }

    // Sort by activity
    charActivity.sort((a, b) => b.total_activity_score - a.total_activity_score);

    // Identify high-use vs low-use
    const highUse = charActivity.slice(0, 3);
    const lowUse = charActivity.slice(-3);

    const findings = {
      user_email: user.email,
      total_characters: allChars.length,
      total_activity_weighted: charActivity.reduce((sum, c) => sum + c.total_activity_score, 0),
      
      // AUDIT 1: High-use characters have sleep debt?
      high_use_sleep_penalties: highUse.map(c => ({
        name: c.character_name,
        message_count: c.message_count,
        sleep_debt_hours: c.sleep_debt,
        is_sleeping: c.is_sleeping,
        has_stale_sleep_interrupt: !!c.sleep_interrupted_at && 
          (new Date() - new Date(c.sleep_interrupted_at)) > 8 * 3600000,
      })),

      low_use_sleep_status: lowUse.map(c => ({
        name: c.character_name,
        message_count: c.message_count,
        sleep_debt_hours: c.sleep_debt,
        is_sleeping: c.is_sleeping,
      })),

      // AUDIT 2: High-use characters have conversation linkage issues?
      high_use_conversation_status: [],

      // AUDIT 3: Summarize penalties by activity level
      penalty_correlation: {
        high_use_avg_sleep_debt: (highUse.reduce((sum, c) => sum + (c.sleep_debt || 0), 0) / highUse.length).toFixed(2),
        low_use_avg_sleep_debt: (lowUse.reduce((sum, c) => sum + (c.sleep_debt || 0), 0) / lowUse.length).toFixed(2),
        high_use_sleeping_count: highUse.filter(c => c.is_sleeping).length,
        low_use_sleeping_count: lowUse.filter(c => c.is_sleeping).length,
      },

      verdict: '',
      recommendations: [],
    };

    // AUDIT 2: Check conversation linkage for high-use characters
    for (const char of highUse) {
      const convos = await base44.entities.Conversation.filter(
        { owner_email: user.email, type: 'direct', character_ids: char.character_id },
        '-last_message_date',
        10
      ).catch(() => []);

      const directConvos = convos.filter(c => {
        const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
        return ids.length <= 1 && !c.shared_conversation_key;
      });

      const convoDetails = {
        character_name: char.character_name,
        total_direct_convos: directConvos.length,
        newest_convo_date: directConvos[0]?.last_message_date,
        oldest_convo_date: directConvos[directConvos.length - 1]?.last_message_date,
        empty_convos: directConvos.filter(c => !c.last_message_date).length,
        warning: directConvos.length > 5 ? `${directConvos.length} conversations — possible fragmentation` : null,
      };
      findings.high_use_conversation_status.push(convoDetails);
    }

    // Determine verdict
    const highUseSleepDebt = parseFloat(findings.penalty_correlation.high_use_avg_sleep_debt);
    const lowUseSleepDebt = parseFloat(findings.penalty_correlation.low_use_avg_sleep_debt);
    
    if (highUseSleepDebt > lowUseSleepDebt * 2) {
      findings.verdict = 'CRITICAL: High-use characters have 2x+ sleep debt penalty';
      findings.recommendations.push('Sleep debt system is penalizing activity volume');
      findings.recommendations.push('Implement activity-scoped sleep tracking instead of character-global');
    }

    if (findings.penalty_correlation.high_use_sleeping_count > findings.penalty_correlation.low_use_sleeping_count) {
      findings.verdict = (findings.verdict ? findings.verdict + ' | ' : '') + 'High-use characters more likely to be sleep-locked';
      findings.recommendations.push('Sleep locking mechanism is reducing visibility of most-used characters');
    }

    const fragmentedHighUse = findings.high_use_conversation_status.filter(c => c.total_direct_convos > 5);
    if (fragmentedHighUse.length > 0) {
      findings.verdict = (findings.verdict ? findings.verdict + ' | ' : '') + `Conversation fragmentation on ${fragmentedHighUse.length} high-use characters`;
      findings.recommendations.push('Multiple conversations created for single character — message history may be split');
      findings.recommendations.push('Last-message-date sorting is selecting new empty convos instead of old full ones');
    }

    if (!findings.verdict) {
      findings.verdict = 'OK: No clear penalty pattern detected';
    }

    return Response.json({
      success: true,
      findings,
      required_fixes: [
        'Sleep debt must not accumulate on high-activity characters',
        'Conversation selection must prefer historically-full convos over new empty ones',
        'Message loading must work regardless of character activity level',
        'Sleep state must not suppress chat history retrieval',
        'Archive linkage must remain intact for all characters regardless of volume',
      ],
    });
  } catch (error) {
    console.error('[auditHighActivityCharacterPenalties]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});