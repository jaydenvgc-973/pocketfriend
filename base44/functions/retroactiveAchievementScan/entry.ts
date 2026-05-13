import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── Inline achievement scope map (mirrors lib/achievements.js scope fields)
// Must stay in sync with lib/achievements.js — no local imports in Deno functions.
const ACHIEVEMENT_SCOPES = {
  first_impression: 'global', consistent: 'global', seen_it_all: 'global',
  still_here: 'global', they_came_back: 'global', left_on_read: 'global',
  group_hangout: 'global', new_place: 'global', productive_day: 'global',
  showed_up_anyway: 'global', rent_paid: 'global',
};

function getAchievementScope(id) {
  return ACHIEVEMENT_SCOPES[id] ?? 'character';
}

function buildDedupKey(ownerEmail, achievementId, characterId) {
  if (getAchievementScope(achievementId) === 'global') {
    return `global::${ownerEmail}::${achievementId}`;
  }
  return `char::${ownerEmail}::${achievementId}::${characterId || ''}`;
}

/**
 * Retroactive achievement scan — call this once per user to award
 * all achievements they've already earned but haven't been granted yet.
 * Safe to call multiple times — idempotent.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const userEmail = user.email;
    const now = Date.now();

    // Fetch all data in parallel
    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    const [existing, allMessages, allCharacters, allConversations] = await Promise.all([
      base44.entities.UserAchievement.filter({ owner_email: userEmail }),
      base44.asServiceRole.entities.Message.filter({ owner_email: userEmail }, '-created_date', 1000),
      base44.asServiceRole.entities.Character.filter({ owner_email: userEmail }),
      base44.asServiceRole.entities.Conversation.filter({ owner_email: userEmail }),
    ]);

    // Build existing key set using scope-derived dedup keys
    const existingKeys = new Set(existing.map(a =>
      buildDedupKey(userEmail, a.achievement_id, a.character_id)
    ));
    // Flat id set for legacy loop checks
    const existingIds = new Set(existing.map(a => a.achievement_id));

    // toUnlock: Map of dedupKey -> { achievement_id, character_id, character_name }
    const toUnlock = new Map();

    const userMessages = allMessages.filter(m => m.sender_type === 'user');
    const charMessages = allMessages.filter(m => m.sender_type === 'character');
    const activeChars = allCharacters.filter(c => c.status !== 'deleted');

    // Helper: mark for unlock using scope-derived dedup key
    const mark = (id, charId = null, charName = '') => {
      const key = buildDedupKey(userEmail, id, charId);
      if (!existingKeys.has(key) && !toUnlock.has(key)) {
        toUnlock.set(key, { achievement_id: id, character_id: charId, character_name: charName });
      }
    };

    // ── first_impression
    if (userMessages.length >= 1) mark('first_impression');

    // ── seen_it_all
    if (charMessages.some(m => m.image_url)) {
      const imgMsg = charMessages.find(m => m.image_url);
      mark('seen_it_all', imgMsg?.character_id, imgMsg?.character_name);
    }

    // ── still_here: 3+ distinct days
    const allDays = new Set(userMessages.map(m => new Date(m.created_date || m.timestamp).toDateString()));
    if (allDays.size >= 3) mark('still_here');

    // ── consistent: 5+ distinct days
    if (allDays.size >= 5) mark('consistent');

    // ── they_came_back: gap of 3+ days then returned
    if (!existingIds.has('they_came_back') && userMessages.length >= 2) {
      const sorted = [...userMessages].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
      for (let i = 1; i < sorted.length; i++) {
        const gap = new Date(sorted[i].created_date) - new Date(sorted[i - 1].created_date);
        if (gap > 3 * 24 * 60 * 60 * 1000) { mark('they_came_back'); break; }
      }
    }

    // ── that_meant_something: got ❤️ reaction from character
    const heartMsg = allMessages.find(m =>
      m.sender_type === 'user' && m.reactions?.some(r => r.reactor_type === 'character' && r.emoji === '❤️')
    );
    if (heartMsg) mark('that_meant_something', heartMsg.character_id);

    // ── tension: 😡 reaction from character
    const angryMsg = allMessages.find(m =>
      m.sender_type === 'user' && m.reactions?.some(r => r.reactor_type === 'character' && r.emoji === '😡')
    );
    if (angryMsg) mark('tension', angryMsg.character_id, angryMsg.character_name);

    // ── you_were_there: narrative message exists
    const narrativeMsg = charMessages.find(m => m.is_narrative);
    if (narrativeMsg) mark('you_were_there', narrativeMsg.character_id, narrativeMsg.character_name);

    // ── big_moment: narrative + user responded after
    if (!existingIds.has('big_moment') && narrativeMsg) {
      const narTime = new Date(narrativeMsg.created_date).getTime();
      const respondedAfter = userMessages.some(m => new Date(m.created_date).getTime() > narTime);
      if (respondedAfter) mark('big_moment', narrativeMsg.character_id, narrativeMsg.character_name);
    }

    // ── clutch_timing: replied within 2 minutes of character message
    if (!existingIds.has('clutch_timing')) {
      outer: for (const cm of charMessages.slice(0, 200)) {
        const cmTime = new Date(cm.created_date).getTime();
        for (const um of userMessages) {
          const umTime = new Date(um.created_date).getTime();
          if (umTime > cmTime && umTime - cmTime < 2 * 60 * 1000) {
            mark('clutch_timing', cm.character_id, cm.character_name);
            break outer;
          }
        }
      }
    }

    // ── left_on_read: character message unread 24h+
    if (!existingIds.has('left_on_read')) {
      const old = charMessages.find(m => {
        if (m.is_read) return false;
        return now - new Date(m.created_date).getTime() > 24 * 60 * 60 * 1000;
      });
      if (old) mark('left_on_read', old.character_id, old.character_name);
    }

    // ── per-character checks
    for (const character of activeChars) {
      const cid = character.id;
      const cname = character.name;

      const charMsgsForThis = charMessages.filter(m => m.character_id === cid);
      const convIds = new Set(charMsgsForThis.map(m => m.conversation_id));
      const userMsgsForThis = userMessages.filter(m => convIds.has(m.conversation_id));
      const totalExchange = charMsgsForThis.length + userMsgsForThis.length;

      // inner_circle: 10+ message exchanges with one character
      if (!existingIds.has('inner_circle') && totalExchange >= 10) {
        mark('inner_circle', cid, cname);
      }

      // ride_along: 7+ days span with same character
      if (!existingIds.has('ride_along') && totalExchange >= 2) {
        const all = [...charMsgsForThis, ...userMsgsForThis].sort((a, b) =>
          new Date(a.created_date) - new Date(b.created_date)
        );
        const span = new Date(all[all.length - 1].created_date) - new Date(all[0].created_date);
        if (span >= 7 * 24 * 60 * 60 * 1000) mark('ride_along', cid, cname);
      }

      // they_opened_up: character showed vulnerability 2+ times
      if (!existingIds.has('they_opened_up')) {
        const openMsgs = charMsgsForThis.filter(m =>
          ['reflective', 'sad', 'vulnerable', 'longing', 'grief', 'loneliness', 'nostalgia'].includes(m.emotional_state)
        );
        if (openMsgs.length >= 2) mark('they_opened_up', cid, cname);
      }

      // Text pattern scan on user messages for this character
      for (const um of userMsgsForThis.slice(0, 100)) {
        const text = (um.content || '').toLowerCase();

        if (!existingIds.has('first_responder') && !toUnlock.has('first_responder')) {
          if (/call(ed|ing)?\s+(9-?1-?1|emergency|ambulance)|order(ed|ing)?\s+(an?\s+)?(uber|lyft|taxi)|took\s+(her|him|them)\s+to\s+(hospital|doctor|clinic)|list\s+of\s+(hospitals|clinics)/i.test(text)) {
            mark('first_responder', cid, cname);
          }
        }
        if (!existingIds.has('bedside_manner') && !toUnlock.has('bedside_manner')) {
          if (/how\s+are\s+you\s+(feeling|doing)|are\s+you\s+(ok|okay)|get\s+well|feel\s+better|i('m|\s+am)\s+here\s+for\s+you|thinking\s+(of|about)\s+you/i.test(text)) {
            mark('bedside_manner', cid, cname);
          }
        }
        if (!existingIds.has('the_push') && !toUnlock.has('the_push')) {
          if (/should\s+(take|enroll|try|start)\s+(a\s+)?(course|class|degree|program)|go(ing)?\s+(back\s+to\s+)?school/i.test(text)) {
            mark('the_push', cid, cname);
          }
        }
        if (!existingIds.has('that_meant_something') && !toUnlock.has('that_meant_something')) {
          if (/i('m|\s+am)\s+(proud|so proud)|you('re|\s+are)\s+(amazing|incredible|wonderful)|you('re|\s+are)?\s+not\s+alone|i('m|\s+am)\s+here\s+for\s+you/i.test(text)) {
            mark('that_meant_something', cid, cname);
          }
        }
        if (!existingIds.has('voice_of_reason') && !toUnlock.has('voice_of_reason')) {
          if (/think\s+(about\s+this|before\s+you|it\s+through)|are\s+you\s+sure\s+(about|this)|slow\s+down|don't\s+rush/i.test(text)) {
            mark('voice_of_reason', cid, cname);
          }
        }
        if (!existingIds.has('the_call_nobody_wanted') && !toUnlock.has('the_call_nobody_wanted')) {
          if (/call(ed|ing)?\s+(her|his|their)?\s*(mom|dad|mother|father|parent|family|partner)|let\s+(her|his|their)?\s*(mom|dad|parent|family)\s+know/i.test(text)) {
            mark('the_call_nobody_wanted', cid, cname);
          }
        }
      }
    }

    // Grant all marked achievements
    const granted = [];
    for (const [dedupKey, { achievement_id, character_id, character_name }] of toUnlock.entries()) {
      const record = await base44.entities.UserAchievement.create({
        achievement_id,
        character_id: character_id || null,
        character_name: character_name || '',
        unlocked_at: new Date().toISOString(),
        tier: 'bronze',
        is_seen: false,
        owner_email: userEmail,
      });
      granted.push(record);
      existingKeys.add(dedupKey); // prevent same-session duplicates
    }

    console.log(`[retroactiveScan] user=${userEmail} scanned ${allMessages.length} messages, granted ${granted.length} achievements`);

    return Response.json({
      success: true,
      scanned: { messages: allMessages.length, characters: activeChars.length },
      granted: granted.length,
      achievements: granted.map(a => a.achievement_id),
    });
  } catch (error) {
    console.error('[retroactiveScan] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});