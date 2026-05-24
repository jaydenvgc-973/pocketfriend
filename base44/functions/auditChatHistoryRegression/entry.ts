/**
 * AUDIT: Chat History Regression Investigation
 * 
 * Check for:
 * - Message count disparity (DB vs visible)
 * - Query filters that suppress old messages
 * - Conversation archival/hiding
 * - Pagination/load limit changes
 * - Sleep debt coupling to message visibility
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const findings = {
      timestamp: new Date().toISOString(),
      user_email: user.email,
      characters_checked: [],
      global_patterns: {
        conversations_per_character: {},
        messages_per_character: {},
        query_filters_detected: [],
        pagination_limits_detected: [],
      },
    };

    // Get all characters for this user
    const allChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      '-updated_date',
      30
    );

    console.log(`[auditChatHistoryRegression] Checking ${allChars.length} characters`);

    // Check Ethan specifically + a sample of others
    const charsToAudit = [
      allChars.find(c => c.name === 'Ethan Thompson'),
      ...allChars.slice(0, 3),
    ].filter(Boolean);

    for (const char of charsToAudit) {
      // Get conversations for this character
      const convos = await base44.entities.Conversation.filter(
        { participant_ids: [char.id] },
        '-updated_date',
        50
      ).catch(() => []);

      const messages = await base44.entities.Message.filter(
        { character_id: char.id },
        '-timestamp',
        500
      ).catch(() => []);

      // Check for suspicious patterns
      const hasArchivedMessages = messages.some(m => m.archived_date);
      const hasHiddenMessages = messages.some(m => m.is_read === false && m.timestamp < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
      const latestOnly = messages.length > 0 && messages.slice(2).every(m => !m.content);

      findings.characters_checked.push({
        character_id: char.id,
        character_name: char.name,
        total_conversations: convos.length,
        total_messages_in_db: messages.length,
        messages_with_content: messages.filter(m => m.content && m.content.length > 0).length,
        has_archived_messages: hasArchivedMessages,
        has_hidden_messages: hasHiddenMessages,
        shows_latest_only_pattern: latestOnly,
        sleep_debt_hours: char.sleep_debt_hours,
        resolved_presence_status: char.resolved_presence_status,
        last_sleep_start: char.last_sleep_start,
        sleep_interrupted_at: char.sleep_interrupted_at,
        sample_message_timestamps: messages.slice(0, 5).map(m => ({
          id: m.id,
          timestamp: m.timestamp,
          sender_type: m.sender_type,
          archived_date: m.archived_date,
          is_read: m.is_read,
          content_length: m.content?.length || 0,
        })),
      });
    }

    // Audit for query filters in message loading
    findings.global_patterns.query_filters_detected = [
      "Check: messages ordered by -timestamp (most recent first)",
      "Check: conversation_id filter matching current thread",
      "Check: sender_type filtering (user vs character)",
      "Check: archived_date filtering (null vs not null)",
      "Check: is_read state filtering (may hide unread old messages)",
    ];

    // Check for sleep debt coupling to message visibility
    const sleepDebtCouplingSuspicions = [
      "Check lib/characterSleepState.js: does sleep state suppress message loading?",
      "Check functions/simulateActiveCharacterNeeds: does needs simulation skip character updates?",
      "Check background throttling: is sleep used to reduce data activity?",
      "Check chat message query: are sleeping characters' messages filtered?",
      "Check conversation list: are conversations hidden for sleeping characters?",
    ];
    findings.global_patterns.sleep_debt_coupling_audit = sleepDebtCouplingSuspicions;

    return Response.json({
      success: true,
      findings,
      next_steps: [
        "Identify exact query that loads messages on chat page",
        "Compare database counts vs visible counts",
        "Check if any cleanup/repair function touched messages since sleep debt work",
        "Verify conversation_id has not changed",
        "Check if archived_date or is_read logic was modified",
      ],
    });
  } catch (error) {
    console.error('[auditChatHistoryRegression]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});