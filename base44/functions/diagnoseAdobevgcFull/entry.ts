/**
 * diagnoseAdobevgcFull
 * Focused diagnostic: character existence + all chars in DB with no owner_email
 * Returns the full result without truncation risk.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TARGET_EMAIL = 'adobevgc@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // 1. Characters by owner_email
    const charsByOwner = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 100
    );

    // 2. All characters in DB
    const allChars = await base44.asServiceRole.entities.Character.list('-created_date', 500);

    // 3. Characters with NO owner_email
    const noOwnerChars = allChars.filter(c => !c.owner_email || c.owner_email === '');

    // 4. Characters with owner_email = adobevgc
    const adobeChars = allChars.filter(c => c.owner_email === TARGET_EMAIL);

    // 5. The 3 character IDs referenced in adobevgc's conversations
    const referencedIds = [
      '69dfcd6c96f06a0babbef844', // Chris Brown
      '69e1cbaf2dae540ad7f9042a', // Alden Spencer
      '69f4a5447df393b107a193dc', // Jesse Arden
    ];

    const refCharCheck = referencedIds.map(id => {
      const found = allChars.find(c => c.id === id);
      return {
        id,
        found_in_db: !!found,
        name: found?.name || null,
        owner_email: found?.owner_email || null,
        status: found?.status || null,
        character_type: found?.character_type || null,
      };
    });

    // 6. Check if any existing messages reference these IDs (cross-db lookup)
    const allMsgSample = await base44.asServiceRole.entities.Message.list('-created_date', 500);
    const msgsForReferencedChars = allMsgSample.filter(m =>
      referencedIds.includes(m.character_id)
    );

    // 7. Check conversations — do any exist where character_ids includes one of the referenced IDs?
    const allConvos = await base44.asServiceRole.entities.Conversation.list('-updated_date', 200);
    const convosWithReferencedChars = allConvos.filter(c =>
      (c.character_ids || []).some(id => referencedIds.includes(id))
    );

    // 8. All conversations for adobevgc
    const adobeConvos = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: TARGET_EMAIL }, '-last_message_date', 100
    );

    // 9. Messages in adobevgc conversations
    let totalAdobeMessages = 0;
    const msgCheckPerConvo = [];
    for (const convo of adobeConvos) {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id }, '-created_date', 200
      );
      totalAdobeMessages += msgs.length;
      msgCheckPerConvo.push({
        convo_id: convo.id,
        title: convo.title,
        char_ids: convo.character_ids,
        message_count: msgs.length,
        last_message: msgs[0] ? {
          sender_type: msgs[0].sender_type,
          content: (msgs[0].content || '').substring(0, 100),
          timestamp: msgs[0].timestamp,
        } : null,
      });
    }

    // 10. Root cause conclusions
    const conclusions = [];

    if (adobeChars.length === 0) {
      conclusions.push('CRITICAL_ROOT_CAUSE: Character.filter({owner_email:"adobevgc@gmail.com"}) returns 0 results. The Home page shows an empty roster to this user.');
    } else {
      conclusions.push(`adobevgc has ${adobeChars.length} character(s) by owner_email: ${adobeChars.map(c => c.name).join(', ')}`);
    }

    refCharCheck.forEach(c => {
      if (!c.found_in_db) {
        conclusions.push(`CRITICAL: Character ID ${c.id} (referenced in adobevgc conversation) does NOT exist in the database at all.`);
      } else if (c.owner_email !== TARGET_EMAIL) {
        conclusions.push(`MISMATCH: Character ${c.name} (${c.id}) exists but owner_email="${c.owner_email}" — NOT adobevgc. RLS will block this character from adobevgc's queries.`);
      }
    });

    if (noOwnerChars.length > 0) {
      conclusions.push(`${noOwnerChars.length} character(s) in DB have NO owner_email. These are invisible to ALL user-scoped queries. They may have belonged to adobevgc before owner_email was set.`);
    }

    if (totalAdobeMessages === 0 && adobeConvos.length > 0) {
      conclusions.push('CONFIRMED: All adobevgc conversations have 0 messages. The chat loader finds the conversation but loads nothing — this is correct DB behavior, not a UI bug.');
    }

    return Response.json({
      success: true,
      summary: {
        total_chars_in_db: allChars.length,
        chars_owned_by_adobevgc: adobeChars.length,
        chars_with_no_owner_email: noOwnerChars.length,
        total_adobe_conversations: adobeConvos.length,
        total_adobe_messages: totalAdobeMessages,
      },
      adobevgc_characters: adobeChars.map(c => ({
        id: c.id, name: c.name, status: c.status,
        character_type: c.character_type, owner_email: c.owner_email,
      })),
      referenced_character_check: refCharCheck,
      chars_with_no_owner_email: noOwnerChars.map(c => ({
        id: c.id, name: c.name, status: c.status,
        character_type: c.character_type,
        owner_user_id: c.owner_user_id,
      })),
      messages_in_adobevgc_convos: msgCheckPerConvo,
      messages_referencing_missing_char_ids: msgsForReferencedChars.length,
      convos_with_referenced_chars_elsewhere: convosWithReferencedChars.map(c => ({
        id: c.id, title: c.title, owner_email: c.owner_email, char_ids: c.character_ids,
      })),
      root_cause_conclusions: conclusions,
    });

  } catch (error) {
    console.error('[diagnoseAdobevgcFull] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});