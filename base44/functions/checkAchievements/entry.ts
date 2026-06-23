import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── Inline achievement scope map (mirrors lib/achievements.js scope fields)
// This must stay in sync with lib/achievements.js — no local imports in Deno functions.
// Scope "global" = once per user. Scope "character" = once per user+character pair.
const ACHIEVEMENT_SCOPES = {
  first_impression: 'global', consistent: 'global', seen_it_all: 'global',
  still_here: 'global', they_came_back: 'global', left_on_read: 'global',
  group_hangout: 'global', new_place: 'global', productive_day: 'global',
  showed_up_anyway: 'global', rent_paid: 'global',
  // All others default to 'character'
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

// Pattern-based checks on message text
// existingKeys: Set of scoped dedup keys (global:: or char::) — used for character-aware guard
// characterId: the current character being chatted with — needed to build scoped keys
function detectTextPatternAchievements(msg, existingKeys, ownerEmail, characterId) {
  const text = (msg || '').toLowerCase();
  const toUnlock = [];
  // Use scoped dedup key — character-scoped achievements check against this character's key,
  // NOT the flat existingIds which would incorrectly treat any prior character's unlock as blocking.
  const has = (id) => existingKeys.has(buildDedupKey(ownerEmail, id, characterId));

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

  // let_them_in — user opened up personally
  if (!has('let_them_in')) {
    if (/i\s+(feel|felt|have\s+been)\s+(so\s+)?(scared|alone|anxious|lost|broken|hurt|struggling)|i\s+never\s+told\s+(anyone|you)|something\s+i\s+don't\s+share|honestly[,\s]+i\s+|to\s+be\s+honest[,\s]/i.test(text)) {
      toUnlock.push('let_them_in');
    }
  }

  // hard_truth
  if (!has('hard_truth')) {
    if (/i\s+(have|need)\s+to\s+(be\s+honest|tell\s+you\s+(something|the truth))|the\s+truth\s+is|honestly[,\s]+(you|this|that)\s+(need|should)|you\s+might\s+not\s+(want\s+to\s+)?hear\s+this/i.test(text)) {
      toUnlock.push('hard_truth');
    }
  }

  // apologized
  if (!has('apologized')) {
    if (/i('m|\s+am)\s+(so\s+)?sorry|my\s+bad|i\s+apologize|i\s+was\s+wrong|that\s+was\s+(my\s+fault|on\s+me)|i\s+shouldn't\s+have/i.test(text)) {
      toUnlock.push('apologized');
    }
  }

  // stayed_calm
  if (!has('stayed_calm')) {
    if (/i\s+understand|i\s+hear\s+you|let('s|\s+us)\s+(calm|talk|work)|i('m|\s+am)\s+not\s+trying\s+to\s+fight|we\s+can\s+(figure|work|talk)|i\s+don't\s+want\s+to\s+fight|can\s+we\s+talk\s+about/i.test(text)) {
      toUnlock.push('stayed_calm');
    }
  }

  // healthy_choice
  if (!has('healthy_choice')) {
    if (/i('m|\s+am)\s+(going\s+to\s+)?(take\s+a\s+break|step\s+back|breathe|take\s+care\s+of\s+myself)|choosing\s+(to\s+)?(let\s+it\s+go|stay\s+(calm|positive))|not\s+worth\s+(my\s+)?(energy|stress)/i.test(text)) {
      toUnlock.push('healthy_choice');
    }
  }

  // night_out
  if (!has('night_out')) {
    if (/\b(bar|club|nightclub|lounge|we\s+went\s+out|night\s+out|went\s+to\s+the\s+(bar|club)|drinks?\s+(tonight|last night)|clubbing)\b/i.test(text)) {
      toUnlock.push('night_out');
    }
  }

  // financial_clutch
  if (!has('financial_clutch')) {
    if (/sent\s+(you\s+)?(money|funds|cash|\$|dollars)|help(ing)?\s+(with|pay|cover)\s+(your\s+)?(rent|bill|expense)|i('ll|\s+will)\s+(cover|pay|help\s+with)/i.test(text)) {
      toUnlock.push('financial_clutch');
    }
  }

  return toUnlock;
}

// DATA-DRIVEN ACHIEVEMENT CHECKS
// Parity with retroactiveAchievementScan — same evidence rules, same dedup keys.
async function detectDataAchievements(base44, userEmail, characterId, characterName, userMessage, existingIds) {
  const toUnlock = [];
  // Use scoped dedup key for character-aware guard — prevents cross-character suppression
  const hasScoped = (id) => existingIds.includes(id);
  const now = Date.now();
  const sr = base44.asServiceRole;

  const [
    allMessages,
    allCharacters,
    allConversations,
    financialTxns,
    lifeEvents,
    memories,
  ] = await Promise.all([
    sr.entities.Message.filter({ owner_email: userEmail }, '-created_date', 1000).catch(() => []),
    sr.entities.Character.filter({ owner_email: userEmail, status: 'active' }).catch(() => []),
    sr.entities.Conversation.filter({ owner_email: userEmail }).catch(() => []),
    sr.entities.FinancialTransaction.filter({ character_id: characterId }, '-timestamp', 100).catch(() => []),
    sr.entities.LifeEvent.filter({ character_id: characterId }, '-timestamp', 200).catch(() => []),
    sr.entities.Memory.filter({ character_id: characterId }, '-timestamp', 100).catch(() => []),
  ]);

  const userMessages = allMessages.filter(m => m.sender_type === 'user');
  const charMessages = allMessages.filter(m => m.sender_type === 'character');
  const cMsgs = charMessages.filter(m => m.character_id === characterId);
  const convIds = new Set(cMsgs.map(m => m.conversation_id));
  const uMsgs = userMessages.filter(m => convIds.has(m.conversation_id));
  const allDays = new Set(userMessages.map(m => new Date(m.created_date || m.timestamp).toDateString()));

  // ── GLOBAL ───────────────────────────────────────────────────────────────────
  if (!hasScoped('first_impression') && userMessages.length >= 1) toUnlock.push('first_impression');
  if (!hasScoped('seen_it_all') && charMessages.some(m => m.image_url)) toUnlock.push('seen_it_all');
  if (!hasScoped('still_here') && allDays.size >= 3) toUnlock.push('still_here');
  if (!hasScoped('consistent') && allDays.size >= 5) toUnlock.push('consistent');

  if (!hasScoped('they_came_back') && userMessages.length >= 2) {
    const sorted = [...userMessages].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    for (let i = 1; i < sorted.length; i++) {
      if (new Date(sorted[i].created_date) - new Date(sorted[i-1].created_date) > 3 * 86400000) {
        toUnlock.push('they_came_back'); break;
      }
    }
  }

  if (!hasScoped('left_on_read')) {
    const old = charMessages.find(m => !m.is_read && now - new Date(m.created_date).getTime() > 86400000);
    if (old) toUnlock.push('left_on_read');
  }

  if (!hasScoped('group_hangout') && allConversations.some(c => (c.character_ids || []).length >= 2)) {
    toUnlock.push('group_hangout');
  }

  if (!hasScoped('rent_paid') && financialTxns.some(t => t.transaction_type === 'rent')) {
    toUnlock.push('rent_paid');
  }

  // ── CHARACTER-SCOPED (this character only) ───────────────────────────────────
  const total = cMsgs.length + uMsgs.length;

  if (!hasScoped('inner_circle') && total >= 10) toUnlock.push('inner_circle');

  if (!hasScoped('ride_along') && total >= 2) {
    const all = [...cMsgs, ...uMsgs].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    if (new Date(all[all.length-1].created_date) - new Date(all[0].created_date) >= 7 * 86400000) {
      toUnlock.push('ride_along');
    }
  }

  if (!hasScoped('longtime_contact') && total >= 2) {
    const all = [...cMsgs, ...uMsgs].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    if (new Date(all[all.length-1].created_date) - new Date(all[0].created_date) >= 14 * 86400000) {
      toUnlock.push('longtime_contact');
    }
  }

  if (!hasScoped('favorite_contact') && total >= 50) toUnlock.push('favorite_contact');

  if (!hasScoped('they_opened_up')) {
    const open = cMsgs.filter(m => ['reflective','sad','vulnerable','longing','grief','loneliness','nostalgia'].includes(m.emotional_state));
    if (open.length >= 2) toUnlock.push('they_opened_up');
  }

  if (!hasScoped('that_meant_something')) {
    if (uMsgs.some(m => m.reactions?.some(r => r.reactor_type === 'character' && r.emoji === '❤️'))) {
      toUnlock.push('that_meant_something');
    }
  }

  if (!hasScoped('tension')) {
    if (uMsgs.some(m => m.reactions?.some(r => r.reactor_type === 'character' && r.emoji === '😡'))) {
      toUnlock.push('tension');
    }
  }

  if (!hasScoped('you_were_there') || !hasScoped('big_moment')) {
    const narrativeMsg = cMsgs.find(m => m.is_narrative);
    if (narrativeMsg) {
      if (!hasScoped('you_were_there')) toUnlock.push('you_were_there');
      if (!hasScoped('big_moment')) {
        const narTime = new Date(narrativeMsg.created_date).getTime();
        if (uMsgs.some(m => new Date(m.created_date).getTime() > narTime)) toUnlock.push('big_moment');
      }
    }
  }

  if (!hasScoped('clutch_timing')) {
    outer: for (const cm of cMsgs.slice(0, 100)) {
      const cmTime = new Date(cm.created_date).getTime();
      for (const um of uMsgs) {
        const umTime = new Date(um.created_date).getTime();
        if (umTime > cmTime && umTime - cmTime < 2 * 60000) { toUnlock.push('clutch_timing'); break outer; }
      }
    }
  }

  if (!hasScoped('trust_built')) {
    const char = allCharacters.find(c => c.id === characterId);
    if ((char?.trust_level ?? 50) > 70) toUnlock.push('trust_built');
    const trustEvts = lifeEvents.filter(e => ['relationship_shift','bonding_event'].includes(e.event_type) && e.valence === 'positive');
    if (trustEvts.length >= 2) toUnlock.push('trust_built');
  }

  if (!hasScoped('reconnected') && total >= 2) {
    const all = [...cMsgs, ...uMsgs].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    for (let i = 1; i < all.length; i++) {
      if (new Date(all[i].created_date) - new Date(all[i-1].created_date) > 7 * 86400000) {
        toUnlock.push('reconnected'); break;
      }
    }
  }

  if (!hasScoped('reconciliation')) {
    const hasTension = lifeEvents.some(e => e.event_type === 'conflict_event');
    const hasRes = lifeEvents.some(e => e.event_type === 'reconciliation_event');
    if (hasTension && hasRes) toUnlock.push('reconciliation');
  }

  if (!hasScoped('apologized')) {
    if (uMsgs.some(m => /i('m|\s+am)\s+(so\s+)?sorry|my\s+bad|i\s+apologize|i\s+was\s+wrong/i.test(m.content || ''))) {
      toUnlock.push('apologized');
    }
  }

  if (!hasScoped('tension_resolved')) {
    if (uMsgs.some(m => /i('m|\s+am)\s+(so\s+)?sorry|my\s+bad|i\s+apologize|i\s+was\s+wrong/i.test(m.content || ''))) {
      toUnlock.push('tension_resolved');
    }
  }

  if (!hasScoped('financial_lifeline')) {
    const giftTxns = financialTxns.filter(t => ['gift','loan','financial_lifeline'].includes(t.transaction_type) && t.amount > 0);
    if (giftTxns.length >= 1) toUnlock.push('financial_lifeline');
  }

  if (!hasScoped('financial_clutch')) {
    if (uMsgs.some(m => /sent\s+(you\s+)?(money|funds|cash|\$)|help(ing)?\s+(with|pay|cover)\s+(your\s+)?(rent|bill)|i('ll|\s+will)\s+(cover|pay|help\s+with)/i.test(m.content || ''))) {
      toUnlock.push('financial_clutch');
    }
  }

  if (!hasScoped('bar_night')) {
    const barMsgs = [...cMsgs, ...uMsgs].filter(m => /\b(bar|club|nightclub|lounge|night\s+out|went\s+out|clubbing|drinks?\s+(tonight|last\s+night))\b/i.test(m.content || ''));
    if (barMsgs.length >= 2) toUnlock.push('bar_night');
  }

  if (!hasScoped('night_out')) {
    const barMsgs = [...cMsgs, ...uMsgs].filter(m => /\b(bar|club|nightclub|lounge|night\s+out|went\s+out|clubbing|drinks?\s+(tonight|last\s+night))\b/i.test(m.content || ''));
    if (barMsgs.length >= 1) toUnlock.push('night_out');
  }

  if (!hasScoped('photo_history') && cMsgs.filter(m => m.image_url).length >= 3) {
    toUnlock.push('photo_history');
  }

  if (!hasScoped('witnessed_birth')) {
    const birthEvt = lifeEvents.find(e => e.event_type === 'life_milestone_event' && /(birth|newborn|baby|born|pregnant)/i.test((e.title || '') + (e.description || '')));
    const birthMem = memories.find(m => /(birth|newborn|baby|born|pregnant)/i.test((m.title || '') + (m.description || '')));
    const birthMsg = [...cMsgs, ...uMsgs].find(m => /\b(newborn|had\s+(the\s+)?baby|just\s+gave\s+birth|she\s+(had|delivered)|born\s+today)\b/i.test(m.content || ''));
    if (birthEvt || birthMem || birthMsg) toUnlock.push('witnessed_birth');
  }

  if (!hasScoped('watched_them_grow')) {
    const growthEvts = lifeEvents.filter(e => ['achievement_qualifying_action','growth_event','life_milestone_event','recovery_event'].includes(e.event_type) && e.valence === 'positive');
    const char = allCharacters.find(c => c.id === characterId);
    if (growthEvts.length >= 3 || ((char?.friendship_level ?? 75) > 85 && total >= 20)) {
      toUnlock.push('watched_them_grow');
    }
  }

  if (!hasScoped('grief_support')) {
    const griefEvt = lifeEvents.find(e => ['grief_event','medical_event'].includes(e.event_type));
    const griefMsgs = [...cMsgs, ...uMsgs].filter(m => /\b(passed away|died|funeral|death|grief|mourning|loss|condolence)\b/i.test(m.content || ''));
    if (griefEvt || griefMsgs.length >= 2) toUnlock.push('grief_support');
  }

  if (!hasScoped('housing_intervention')) {
    const housingEvt = lifeEvents.find(e => e.event_type === 'location_change_event' && /(homeless|evict|move|housing|shelter)/i.test((e.title || '') + (e.description || '')));
    if (housingEvt) toUnlock.push('housing_intervention');
  }

  if (!hasScoped('growth_arc')) {
    const growthEvts = lifeEvents.filter(e => ['achievement_qualifying_action','growth_event','life_milestone_event','recovery_event'].includes(e.event_type) && e.valence === 'positive');
    if (total >= 30 && growthEvts.length >= 1) toUnlock.push('growth_arc');
  }

  if (!hasScoped('bedside_manner')) {
    if (uMsgs.some(m => /how\s+are\s+you\s+(feeling|doing)|are\s+you\s+(ok|okay)|get\s+well|feel\s+better|i('m|\s+am)\s+here\s+for\s+you/i.test(m.content || ''))) {
      toUnlock.push('bedside_manner');
    }
  }

  if (!hasScoped('first_responder')) {
    if (uMsgs.some(m => /call(ed|ing)?\s+(9-?1-?1|emergency|ambulance)|order(ed|ing)?\s+(an?\s+)?(uber|lyft|taxi)|took\s+(her|him|them)\s+to\s+(hospital|doctor|clinic)/i.test(m.content || ''))) {
      toUnlock.push('first_responder');
    }
  }

  if (!hasScoped('stayed_calm')) {
    if (uMsgs.some(m => /i\s+understand|i\s+hear\s+you|let('s|\s+us)\s+(calm|talk|work)|i('m|\s+am)\s+not\s+trying\s+to\s+fight|we\s+can\s+(figure|work|talk)/i.test(m.content || ''))) {
      toUnlock.push('stayed_calm');
    }
  }

  if (!hasScoped('let_them_in')) {
    if (uMsgs.some(m => /i\s+(feel|felt|have\s+been)\s+(so\s+)?(scared|alone|anxious|lost|broken|hurt|struggling)|i\s+never\s+told\s+(anyone|you)|to\s+be\s+honest[,\s]/i.test(m.content || ''))) {
      toUnlock.push('let_them_in');
    }
  }

  if (!hasScoped('hard_truth')) {
    if (uMsgs.some(m => /i\s+(have|need)\s+to\s+(be\s+honest|tell\s+you\s+(something|the truth))|the\s+truth\s+is|you\s+might\s+not\s+(want\s+to\s+)?hear\s+this/i.test(m.content || ''))) {
      toUnlock.push('hard_truth');
    }
  }

  if (!hasScoped('the_push')) {
    if (uMsgs.some(m => /should\s+(take|enroll|try|start)\s+(a\s+)?(course|class|degree|program)|go(ing)?\s+(back\s+to\s+)?school/i.test(m.content || ''))) {
      toUnlock.push('the_push');
    }
  }

  if (!hasScoped('voice_of_reason')) {
    if (uMsgs.some(m => /think\s+(about\s+this|before\s+you|it\s+through)|are\s+you\s+sure\s+(about|this)|slow\s+down|don't\s+rush/i.test(m.content || ''))) {
      toUnlock.push('voice_of_reason');
    }
  }

  if (!hasScoped('healthy_choice')) {
    if (uMsgs.some(m => /i('m|\s+am)\s+(going\s+to\s+)?(take\s+a\s+break|step\s+back|breathe|take\s+care\s+of\s+myself)|choosing\s+(to\s+)?(let\s+it\s+go|stay\s+(calm|positive))/i.test(m.content || ''))) {
      toUnlock.push('healthy_choice');
    }
  }

  return [...new Set(toUnlock)];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { characterId, characterName, userMessage, characterState } = body;

    if (!characterId) return Response.json({ unlocked: [] });

    // Get ALL existing achievements for this user, scoped by owner_email.
    // Dedup key is derived from ACHIEVEMENT_SCOPES (inline mirror of lib/achievements.js scope fields).
    const existing = await base44.entities.UserAchievement.filter({ owner_email: user.email }, '-created_date', 500);

    // Build existing key set using the shared buildDedupKey logic
    const existingKeys = new Set(existing.map(a =>
      buildDedupKey(user.email, a.achievement_id, a.character_id)
    ));

    // existingIds: flat list of achievement_ids (for legacy pattern checks that only need the id)
    const existingIds = existing.map(a => a.achievement_id);

    // Helper: check if a given achievement_id is already unlocked for the current character context
    const hasForContext = (id) => existingKeys.has(buildDedupKey(user.email, id, characterId));

    // Run both detection passes in parallel
    // Text patterns now use scoped keys (not flat existingIds) so character-scoped achievements
    // can trigger independently per character — fixes cross-character suppression bug.
    const [textAchievements, dataAchievements] = await Promise.all([
      Promise.resolve(detectTextPatternAchievements(userMessage || '', existingKeys, user.email, characterId)),
      detectDataAchievements(base44, user.email, characterId, characterName, userMessage, existingIds),
    ]);

    // Split: new unlocks vs. revisits — use context-aware hasForContext
    const allDetected = [...new Set([...textAchievements, ...dataAchievements])];
    const newIds     = allDetected.filter(id => !hasForContext(id));
    const revisitIds = allDetected.filter(id => hasForContext(id));

    // Create records for genuinely new unlocks only.
    // Key derived from achievement scope definition — no hardcoded lists.
    const newlyUnlocked = [];
    for (const achievement_id of newIds) {
      const dedupKey = buildDedupKey(user.email, achievement_id, characterId);
      if (existingKeys.has(dedupKey)) continue;

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
      existingKeys.add(dedupKey); // prevent same-session duplicate
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