/**
 * diagnoseAdobevgcAccount
 *
 * Service-role diagnostic scoped STRICTLY to owner_email: adobevgc@gmail.com.
 * Simulates exactly what the adobevgc user would see on their own UI:
 *   - Home page: their characters
 *   - Chat page: their conversations and messages
 *   - RLS context: what Character.filter({owner_email}) returns
 *
 * Does NOT use created_by.
 * Does NOT touch murqart data.
 * Does NOT move, copy, or reassign anything.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TARGET_EMAIL = 'adobevgc@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow admin (murqart) to run this safely for diagnostic purposes only
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const report = {
      target_account: TARGET_EMAIL,
      diagnostic_run_by: user.email,
      timestamp: new Date().toISOString(),
    };

    // ── 1. CHARACTERS owned by adobevgc ──────────────────────────────────────
    // This is exactly what the Home page CharacterCard list loads:
    // Character.filter({ owner_email: TARGET_EMAIL })
    const charsByOwnerEmail = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL },
      '-created_date',
      100
    );
    report.characters_by_owner_email = {
      count: charsByOwnerEmail.length,
      characters: charsByOwnerEmail.map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        character_type: c.character_type,
        owner_email: c.owner_email,
        owner_user_id: c.owner_user_id,
        is_active_character: c.is_active_character,
      })),
    };

    // ── 2. CONVERSATIONS owned by adobevgc ───────────────────────────────────
    // This is exactly what useChatLoadConvo loads:
    // Conversation.filter({ owner_email: TARGET_EMAIL })
    const convos = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: TARGET_EMAIL },
      '-last_message_date',
      100
    );
    report.conversations = {
      count: convos.length,
      list: convos.map(c => ({
        id: c.id,
        title: c.title,
        type: c.type,
        character_ids: c.character_ids,
        owner_email: c.owner_email,
        last_message_date: c.last_message_date,
        last_message_preview: c.last_message_preview,
      })),
    };

    // ── 3. For each conversation: check messages ─────────────────────────────
    const convoMessageCounts = [];
    for (const convo of convos) {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id },
        '-created_date',
        10
      );
      convoMessageCounts.push({
        conversation_id: convo.id,
        title: convo.title,
        character_ids: convo.character_ids,
        message_count: msgs.length,
        sample: msgs.slice(0, 3).map(m => ({
          id: m.id,
          sender_type: m.sender_type,
          content_preview: (m.content || '').substring(0, 80),
          timestamp: m.timestamp,
        })),
      });
    }
    report.conversation_message_check = convoMessageCounts;

    // ── 4. CHARACTER EXISTENCE CHECK ─────────────────────────────────────────
    // Verify each character_id referenced in adobevgc conversations actually exists
    const allCharIdsInConvos = [...new Set(convos.flatMap(c => c.character_ids || []))];
    const charExistenceCheck = [];
    for (const charId of allCharIdsInConvos) {
      try {
        const found = await base44.asServiceRole.entities.Character.filter(
          { id: charId },
          '-created_date',
          1
        );
        charExistenceCheck.push({
          character_id: charId,
          exists: found.length > 0,
          name: found[0]?.name || null,
          owner_email: found[0]?.owner_email || null,
          status: found[0]?.status || null,
        });
      } catch (e) {
        charExistenceCheck.push({
          character_id: charId,
          exists: false,
          error: e.message,
        });
      }
    }
    report.character_existence_check = charExistenceCheck;

    // ── 5. USER SETTINGS for adobevgc ────────────────────────────────────────
    const userSettings = await base44.asServiceRole.entities.UserSettings.filter(
      { owner_email: TARGET_EMAIL },
      '-created_date',
      5
    );
    report.user_settings = {
      count: userSettings.length,
      records: userSettings.map(s => ({
        id: s.id,
        owner_email: s.owner_email,
        has_completed_onboarding: s.has_completed_onboarding,
        default_character_id: s.default_character_id,
        fictional_world_name: s.fictional_world_name,
      })),
    };

    // ── 6. ALL CHARACTERS IN DB — check if adobevgc chars exist under a different field ─────
    // Specifically look for characters that might belong to adobevgc but have
    // owner_email missing/null/wrong
    const allCharsInDB = await base44.asServiceRole.entities.Character.list('-created_date', 200);
    const possiblyAdobeChars = allCharsInDB.filter(c =>
      c.owner_email === TARGET_EMAIL ||
      c.owner_email == null ||   // No owner_email set
      c.owner_email === ''
    );
    report.possibly_adobevgc_chars_in_full_db = {
      total_chars_in_db: allCharsInDB.length,
      chars_with_no_owner_email: possiblyAdobeChars.filter(c => !c.owner_email).length,
      chars_explicitly_owned_by_target: possiblyAdobeChars.filter(c => c.owner_email === TARGET_EMAIL).length,
      sample_no_owner: possiblyAdobeChars.filter(c => !c.owner_email).slice(0, 10).map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        character_type: c.character_type,
        owner_email: c.owner_email,
        owner_user_id: c.owner_user_id,
      })),
    };

    // ── 7. MESSAGES created by adobevgc user (sender_type=user) ─────────────
    // Check if any messages were sent by the user on this account at all
    const userMessages = await base44.asServiceRole.entities.Message.filter(
      { sender_type: 'user' },
      '-created_date',
      200
    );
    // We can't filter by owner_email on Message (it doesn't have it), but we
    // CAN check if any messages belong to conversations owned by adobevgc
    const adobeConvoIds = new Set(convos.map(c => c.id));
    const adobeUserMessages = userMessages.filter(m => adobeConvoIds.has(m.conversation_id));
    report.user_sent_messages_in_adobevgc_convos = {
      count: adobeUserMessages.length,
      sample: adobeUserMessages.slice(0, 5).map(m => ({
        id: m.id,
        conversation_id: m.conversation_id,
        content_preview: (m.content || '').substring(0, 80),
        timestamp: m.timestamp,
      })),
    };

    // ── 8. ROOT CAUSE HYPOTHESIS ─────────────────────────────────────────────
    const hypotheses = [];

    if (charsByOwnerEmail.length === 0) {
      hypotheses.push('CRITICAL: No characters with owner_email=adobevgc@gmail.com. Home page will show empty roster.');
    }

    if (charExistenceCheck.some(c => !c.exists)) {
      const missing = charExistenceCheck.filter(c => !c.exists);
      hypotheses.push(`CRITICAL: ${missing.length} character(s) referenced in conversations do NOT exist: ${missing.map(c => c.character_id).join(', ')}`);
    }

    const convosWithNoMessages = convoMessageCounts.filter(c => c.message_count === 0);
    if (convosWithNoMessages.length > 0) {
      hypotheses.push(`Conversations with 0 messages: ${convosWithNoMessages.map(c => c.title).join(', ')}`);
    }

    const charsWithNoOwner = possiblyAdobeChars.filter(c => !c.owner_email);
    if (charsWithNoOwner.length > 0) {
      hypotheses.push(`${charsWithNoOwner.length} character(s) in DB have NO owner_email set — these are invisible to adobevgc's UI queries.`);
    }

    if (userSettings.length === 0) {
      hypotheses.push('No UserSettings record for adobevgc — onboarding or default character may be broken.');
    }

    if (hypotheses.length === 0) {
      hypotheses.push('No obvious issues found. Data appears intact under owner_email scope.');
    }

    report.root_cause_hypotheses = hypotheses;

    return Response.json({ success: true, report });

  } catch (error) {
    console.error('[diagnoseAdobevgcAccount] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});