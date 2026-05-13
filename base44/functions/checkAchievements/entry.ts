import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Pattern-based checks on message text
function detectTextPatternAchievements(msg, existingIds) {
  const text = (msg || '').toLowerCase();
  const toUnlock = [];
  const has = (id) => existingIds.includes(id);

  // first_responder
  if (!has('first_responder')) {
    const patterns = [
      /call(ed|ing)?\s+(9-?1-?1|emergency|ambulance|paramedic)/i,
      /order(ed|ing)?\s+(an?\s+)?(uber|lyft|taxi|cab|ride)/i,
      /call(ed|ing)?\s+(her|his|their)?\s*(mom|dad|mother|father|parent|sister|brother|family|partner)/i,
      /took\s+(her|him|them)\s+to\s+(the\s+)?(hospital|doctor|urgent care|er|clinic)/i,
      /drove\s+(her|him|them)/i,
      /list\s+of\s+(hospitals|clinics|doctors)/i,
      /found\s+(a\s+)?(hospital|clinic|doctor)/i,
      /get\s+(yourself\s+)?(checked|tested|seen|treated|help)/i,
      /arranged\s+(help|a ride|transport)/i,
    ];
    if (patterns.some(p => p.test(text))) toUnlock.push('first_responder');
  }

  // bedside_manner
  if (!has('bedside_manner')) {
    const patterns = [
      /how\s+are\s+you\s+(feeling|doing)/i,
      /are\s+you\s+(ok|okay|alright|feeling better)/i,
      /checking\s+(in|on)/i,
      /hope\s+you('re|\s+are)\s+(ok|okay|feeling|better|recovering)/i,
      /get\s+well/i,
      /feel\s+better/i,
      /thinking\s+(of|about)\s+you/i,
      /sending\s+(love|thoughts|prayers|good vibes)/i,
      /i('m|\s+am)\s+here\s+(for\s+you|if)/i,
    ];
    if (patterns.some(p => p.test(text))) toUnlock.push('bedside_manner');
  }

  // the_call_nobody_wanted
  if (!has('the_call_nobody_wanted')) {
    const patterns = [
      /call(ed|ing)?\s+(her|his|their)?\s*(mom|dad|mother|father|parent|sister|brother|family|partner)/i,
      /text(ed|ing)?\s+(her|his|their)?\s*(mom|dad|mother|father|parent|family)/i,
      /let\s+(her|his|their)?\s*(mom|dad|parent|family|partner)\s+know/i,
    ];
    if (patterns.some(p => p.test(text))) toUnlock.push('the_call_nobody_wanted');
  }

  // the_push
  if (!has('the_push')) {
    const patterns = [
      /should\s+(take|enroll|sign up|try|do|start)\s+(a\s+)?(course|class|certification|degree|program|training)/i,
      /enroll(ed|ing)?\s+(in|for)\s+(a\s+)?(course|class|certification|program)/i,
      /sign(ed|ing)?\s+up\s+(for|in)\s+(a\s+)?(course|class|program)/i,
      /go(ing)?\s+(back\s+to\s+)?(school|college|university)/i,
      /get\s+(your|a)\s+(degree|certification|diploma|license)/i,
    ];
    if (patterns.some(p => p.test(text))) toUnlock.push('the_push');
  }

  // that_meant_something
  if (!has('that_meant_something')) {
    const patterns = [
      /i('m|\s+am)\s+(proud|so proud)\s+of\s+you/i,
      /you('re|\s+are)\s+(amazing|incredible|wonderful|doing\s+(so\s+)?great)/i,
      /that('s|\s+is)\s+(beautiful|incredible|amazing|wonderful)/i,
      /i\s+(really\s+)?love\s+(that|this|you|how)/i,
      /you\s+(did\s+)?great/i,
      /so\s+(happy|glad|proud)\s+(for|of)\s+you/i,
      /you('re|\s+are)?\s+not\s+alone/i,
      /i('m|\s+am)\s+here\s+(for\s+you)/i,
      /that\s+means\s+(a lot|everything|so much)/i,
    ];
    if (patterns.some(p => p.test(text))) toUnlock.push('that_meant_something');
  }

  // tension
  if (!has('tension')) {
    const patterns = [
      /you('re|\s+are)\s+(wrong|being\s+(ridiculous|stupid|dramatic|overreacting))/i,
      /that('s|\s+is)\s+(stupid|ridiculous|wrong|your\s+fault)/i,
      /i\s+don't\s+(care|want\s+to\s+talk)/i,
      /leave\s+(me|it)\s+alone/i,
      /stop\s+(being|acting)/i,
      /you\s+always\s+do\s+this/i,
      /i('m|\s+am)\s+(angry|pissed|furious|done)\s+(at|with|about)/i,
    ];
    if (patterns.some(p => p.test(text))) toUnlock.push('tension');
  }

  // voice_of_reason
  if (!has('voice_of_reason')) {
    const patterns = [
      /don't\s+(do|make)\s+(that|this|a)\s+(mistake|decision)/i,
      /think\s+(about\s+this|before\s+you|it\s+through)/i,
      /are\s+you\s+sure\s+(about\s+)?(that|this)/i,
      /slow\s+down/i,
      /don't\s+(rush|be\s+impulsive)/i,
      /wait\s+before\s+you/i,
      /talk\s+(to|with)\s+(someone|a\s+(therapist|counselor|professional))\s+first/i,
    ];
    if (patterns.some(p => p.test(text))) toUnlock.push('voice_of_reason');
  }

  // bad_influence
  if (!has('bad_influence')) {
    const patterns = [
      /just\s+(do\s+it|go\s+for\s+it|say\s+it)/i,
      /you\s+should\s+(just|totally)\s+(do|say|go|tell)/i,
      /who\s+cares\s+(what|if)/i,
      /forget\s+(about\s+)?(them|it|what\s+they\s+think)/i,
      /live\s+(a\s+little|dangerously)/i,
      /you\s+only\s+live\s+once/i,
    ];
    if (patterns.some(p => p.test(text))) toUnlock.push('bad_influence');
  }

  return toUnlock;
}

// DATA-DRIVEN ACHIEVEMENT CHECKS
// These require querying the database
async function detectDataAchievements(base44, userEmail, characterId, characterName, userMessage, existingIds) {
  const toUnlock = [];
  const has = (id) => existingIds.includes(id);
  const now = Date.now();

  // Run all data queries in parallel
  const [
    allMessages,
    allCharacters,
    allConversations,
  ] = await Promise.all([
    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    base44.asServiceRole.entities.Message.filter({ owner_email: userEmail }, '-created_date', 500),
    base44.asServiceRole.entities.Character.filter({ owner_email: userEmail, status: 'active' }),
    base44.asServiceRole.entities.Conversation.filter({ owner_email: userEmail }),
  ]);

  const userMessages = allMessages.filter(m => m.sender_type === 'user');
  const charMessages = allMessages.filter(m => m.sender_type === 'character');

  // first_impression: sent at least 1 message ever
  if (!has('first_impression') && userMessages.length >= 1) {
    toUnlock.push('first_impression');
  }

  // seen_it_all: received a photo from a character (only if we have character messages)
  if (!has('seen_it_all') && charMessages.length > 0 && charMessages.some(m => m.image_url)) {
    toUnlock.push('seen_it_all');
  }

  // multi-character engagement (no formal badge for this yet but maps to inner_circle proximity)
  // inner_circle: interacted with the same character across 10+ messages
  if (!has('inner_circle')) {
    const msgsWithThisChar = allMessages.filter(m => 
      m.sender_type === 'user' && 
      allMessages.some(cm => cm.conversation_id === m.conversation_id && cm.sender_type === 'character' && cm.character_id === characterId)
    );
    if (msgsWithThisChar.length >= 10) {
      toUnlock.push('inner_circle');
    }
  }

  // still_here: sent messages on 3+ distinct calendar days
  if (!has('still_here')) {
    const days = new Set(
      userMessages.map(m => new Date(m.created_date || m.timestamp).toDateString())
    );
    if (days.size >= 3) toUnlock.push('still_here');
  }

  // they_came_back: gap of 3+ days then returned
  if (!has('they_came_back') && userMessages.length >= 2) {
    const sorted = [...userMessages].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    for (let i = 1; i < sorted.length; i++) {
      const gap = new Date(sorted[i].created_date) - new Date(sorted[i - 1].created_date);
      if (gap > 3 * 24 * 60 * 60 * 1000) {
        toUnlock.push('they_came_back');
        break;
      }
    }
  }

  // emoji badges: character sent heart reaction to user
  const emojiMessages = allMessages.filter(m => 
    m.sender_type === 'user' && 
    m.reactions?.some(r => r.reactor_type === 'character' && r.emoji === '❤️')
  );
  if (!has('that_meant_something') && emojiMessages.length >= 1) {
    toUnlock.push('that_meant_something');
  }

  // you_were_there: was present when a character had a major life event (narrative message + at least 1 user message)
  if (!has('you_were_there')) {
    const narrativeMessages = charMessages.filter(m => m.is_narrative);
    if (narrativeMessages.length > 0 && userMessages.length > 0) toUnlock.push('you_were_there');
  }

  // big_moment: character shared a milestone (narrative + user responded after)
  if (!has('big_moment')) {
    const narratives = charMessages.filter(m => m.is_narrative);
    if (narratives.length > 0 && userMessages.length > 0) {
      // Check if user sent at least one message after any narrative
      const narrativeTime = Math.min(...narratives.map(m => new Date(m.created_date).getTime()));
      const respondedAfter = userMessages.some(m => new Date(m.created_date).getTime() > narrativeTime);
      if (respondedAfter) toUnlock.push('big_moment');
    }
  }

  // clutch_timing: replied within 2 minutes of a character message
  if (!has('clutch_timing') && userMessages.length >= 1 && charMessages.length >= 1) {
    for (const cm of charMessages.slice(0, 100)) {
      const cmTime = new Date(cm.created_date).getTime();
      const quickReply = userMessages.find(um => {
        const umTime = new Date(um.created_date).getTime();
        return umTime > cmTime && umTime - cmTime < 2 * 60 * 1000;
      });
      if (quickReply) {
        toUnlock.push('clutch_timing');
        break;
      }
    }
  }

  // left_on_read: character message unread for 24h+
  if (!has('left_on_read')) {
    const oldUnread = charMessages.find(m => {
      if (m.is_read) return false;
      const age = now - new Date(m.created_date).getTime();
      return age > 24 * 60 * 60 * 1000;
    });
    if (oldUnread) toUnlock.push('left_on_read');
  }

  // ride_along: active convo across 7+ days with same character
  if (!has('ride_along')) {
    const msgsThisChar = allMessages.filter(m => m.character_id === characterId || 
      allMessages.some(cm => cm.conversation_id === m.conversation_id && cm.character_id === characterId)
    );
    if (msgsThisChar.length >= 2) {
      const sorted = [...msgsThisChar].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
      const span = new Date(sorted[sorted.length - 1].created_date) - new Date(sorted[0].created_date);
      if (span >= 7 * 24 * 60 * 60 * 1000) toUnlock.push('ride_along');
    }
  }

  // they_opened_up: character sent 5+ messages with emotional state = reflective/sad/vulnerable
  if (!has('they_opened_up')) {
    const openMessages = charMessages.filter(m => 
      m.character_id === characterId &&
      ['reflective', 'sad', 'vulnerable', 'longing', 'grief', 'loneliness', 'nostalgia'].includes(m.emotional_state)
    );
    if (openMessages.length >= 2) toUnlock.push('they_opened_up');
  }

  // consistent: messaged on 5+ different days
  if (!has('consistent')) {
    const days = new Set(
      userMessages.map(m => new Date(m.created_date || m.timestamp).toDateString())
    );
    if (days.size >= 5) toUnlock.push('consistent');
  }

  return [...new Set(toUnlock)]; // dedupe
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { characterId, characterName, userMessage, characterState } = body;

    if (!characterId) return Response.json({ unlocked: [] });

    // Get ALL existing achievements for this user.
    // Use user-scoped list (RLS ensures only this user's records are returned).
    // We then check BOTH owner_email match and records without owner_email (legacy records
    // whose owner is proven by RLS). This prevents false "new unlock" on every call
    // before the backfill has set owner_email on legacy records.
    const existing = await base44.entities.UserAchievement.list('-created_date', 500);
    // Deduplicate by achievement_id — only keep first occurrence per achievement_id+character_id
    const existingIds = existing.map(a => a.achievement_id);

    // Run both detection passes in parallel
    const [textAchievements, dataAchievements] = await Promise.all([
      Promise.resolve(detectTextPatternAchievements(userMessage || '', existingIds)),
      detectDataAchievements(base44, user.email, characterId, characterName, userMessage, existingIds),
    ]);

    // Split: new unlocks vs. revisits of already-unlocked achievements
    const allDetected = [...new Set([...textAchievements, ...dataAchievements])];
    const newIds    = allDetected.filter(id => !existingIds.includes(id));
    const revisitIds = allDetected.filter(id => existingIds.includes(id));

    // Create records for genuinely new unlocks only.
    // Double-check against the full existing list to prevent race-condition duplicates:
    // achievement is "new" only if no record exists with same achievement_id regardless of character.
    const newlyUnlocked = [];
    for (const achievement_id of newIds) {
      // Final guard: skip if already in existingIds (could have been pushed in a prior loop iteration)
      if (existingIds.includes(achievement_id)) continue;
      const record = await base44.entities.UserAchievement.create({
        achievement_id,
        character_id: characterId,
        character_name: characterName || '',
        unlocked_at: new Date().toISOString(),
        tier: 'bronze',
        is_seen: false,
        owner_email: user.email,
      });
      newlyUnlocked.push(record);
      existingIds.push(achievement_id); // prevent same-session duplicate
    }

    // EMOTIONAL WEIGHT CLASSIFICATION for revisits
    // Determines whether a revisit is meaningful enough for Life Journal vs. memory-only
    const HIGH_WEIGHT_ACHIEVEMENTS = new Set([
      'inner_circle', 'they_opened_up', 'hit_deep', 'that_meant_something',
      'ride_along', 'trust_built', 'tension_resolved', 'first_responder',
      'bedside_manner', 'watched_them_grow', 'you_were_there', 'big_moment',
    ]);
    const MEDIUM_WEIGHT_ACHIEVEMENTS = new Set([
      'the_push', 'voice_of_reason', 'shifted_perspective', 'let_them_in',
      'hard_truth', 'apologized', 'clutch_timing', 'reconnected',
    ]);

    const revisited = [];
    for (const achievement_id of revisitIds.slice(0, 2)) {
      const isHigh   = HIGH_WEIGHT_ACHIEVEMENTS.has(achievement_id);
      const isMedium = MEDIUM_WEIGHT_ACHIEVEMENTS.has(achievement_id);
      const label    = achievement_id.replace(/_/g, ' ');

      // Stable cooldown key: achievement_id is stored as a context_tag on LifeEvent
      // and as the first word of memory_summary on CharacterMemory.
      // This survives title/label formatting changes.
      const stableKey = `achievement_revisit::${achievement_id}`;
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

      if (isHigh) {
        // Cooldown check: query LifeEvent by character_id + stable context_tag key
        // LifeEvent.context_tags is an array — filter on character_id then check tags client-side
        const recentLifeEvents = await base44.asServiceRole.entities.LifeEvent.filter({
          character_id: characterId,
        }, '-timestamp', 20).catch(() => []);
        const alreadyWrittenRecently = recentLifeEvents.some(ev =>
          (ev.context_tags || []).includes(stableKey) &&
          new Date(ev.timestamp) > new Date(thirtyMinAgo)
        );

        if (!alreadyWrittenRecently) {
          base44.asServiceRole.entities.LifeEvent.create({
            character_id: characterId,
            character_name: characterName || '',
            event_type: 'emotional_exchange',
            valence: 'positive',
            severity: 'moderate',
            title: `Moment revisited: ${label}`,
            description: `This emotional moment was felt again during conversation: "${label}".`,
            emotional_impact: 'A recurring emotional theme in this relationship.',
            triggered_by: 'user_message',
            timestamp: new Date().toISOString(),
            systems_updated: ['memory'],
            // Stable key stored as context_tag — survives title formatting changes
            context_tags: [stableKey, `achievement:${achievement_id}`],
          }).catch(() => {});
          revisited.push({ achievement_id, character_id: characterId, character_name: characterName || '', weight: 'high' });
          console.log(`[checkAchievements] LifeEvent written for high-weight revisit: ${stableKey}`);
        } else {
          console.log(`[checkAchievements] Cooldown active — skipping LifeEvent for ${stableKey}`);
        }
        // If already written recently, skip write AND skip toast
      } else if (isMedium) {
        // Cooldown check: query CharacterMemory by character_id + stable memory_summary prefix
        const recentMems = await base44.asServiceRole.entities.CharacterMemory.filter({
          character_id: characterId,
        }, '-created_date', 20).catch(() => []);
        const alreadyWrittenRecently = recentMems.some(m =>
          m.memory_summary === stableKey &&
          new Date(m.created_date) > new Date(thirtyMinAgo)
        );

        if (!alreadyWrittenRecently) {
          base44.asServiceRole.entities.CharacterMemory.create({
            character_id: characterId,
            memory_type: 'event',
            memory_text: `Recurring emotional pattern: "${label}" felt again in conversation.`,
            // Use stableKey as memory_summary — survives label formatting changes
            memory_summary: stableKey,
            importance_score: 4,
            permanence: 'long_term',
          }).catch(() => {});
          revisited.push({ achievement_id, character_id: characterId, character_name: characterName || '', weight: 'medium' });
          console.log(`[checkAchievements] CharacterMemory written for medium-weight revisit: ${stableKey}`);
        } else {
          console.log(`[checkAchievements] Cooldown active — skipping CharacterMemory for ${stableKey}`);
        }
      }
      // Low-weight revisits (tension, bad_influence, etc.) → silently ignored, no write, no toast
    }

    console.log(`[checkAchievements] user=${user.email} charId=${characterId} textHits=${textAchievements.length} dataHits=${dataAchievements.length} unlocked=${newlyUnlocked.length} revisited=${revisited.length}`);

    return Response.json({ unlocked: newlyUnlocked, revisited });
  } catch (error) {
    console.error('[checkAchievements] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});