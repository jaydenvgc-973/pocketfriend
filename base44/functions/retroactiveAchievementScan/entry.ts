import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── Inline achievement scope map (mirrors lib/achievements.js)
const ACHIEVEMENT_SCOPES = {
  first_impression: 'global', consistent: 'global', seen_it_all: 'global',
  still_here: 'global', they_came_back: 'global', left_on_read: 'global',
  group_hangout: 'global', new_place: 'global', productive_day: 'global',
  showed_up_anyway: 'global', rent_paid: 'global',
};

function getScope(id) { return ACHIEVEMENT_SCOPES[id] ?? 'character'; }

function dedupKey(ownerEmail, id, charId) {
  return getScope(id) === 'global'
    ? `global::${ownerEmail}::${id}`
    : `char::${ownerEmail}::${id}::${charId || ''}`;
}

/**
 * retroactiveAchievementScan
 *
 * Full multi-source achievement scanner. Idempotent — safe to run multiple times.
 * Evidence sources:
 *   - Message records (chat, text, world_phone)
 *   - FinancialTransaction records
 *   - Memory records
 *   - CharacterMemory (life journal) records
 *   - LifeEvent records
 *   - Character relationship levels
 *   - LocationHistory records
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const userEmail = user.email;
    const sr = base44.asServiceRole;
    const now = Date.now();

    // ── Fetch all evidence in parallel ──────────────────────────────────────
    const [
      existing,
      allMessages,
      allCharacters,
      allConversations,
      financialTxns,
      lifeEvents,
      memories,
      charMemories,
      locationHistory,
    ] = await Promise.all([
      base44.entities.UserAchievement.filter({ owner_email: userEmail }).catch(() => []),
      sr.entities.Message.filter({ owner_email: userEmail }, '-created_date', 2000).catch(() => []),
      sr.entities.Character.filter({ owner_email: userEmail }).catch(() => []),
      sr.entities.Conversation.filter({ owner_email: userEmail }).catch(() => []),
      sr.entities.FinancialTransaction.filter({ character_id: { $exists: true } }, '-timestamp', 500).catch(() => []),
      sr.entities.LifeEvent.filter({}, '-timestamp', 500).catch(() => []),
      sr.entities.Memory.filter({}, '-timestamp', 500).catch(() => []),
      sr.entities.CharacterMemory.filter({}, '-created_date', 500).catch(() => []),
      sr.entities.LocationHistory.filter({ owner_email: userEmail }, '-arrival_time', 500).catch(() => []),
    ]);

    // Build existing dedup key set
    const existingKeys = new Set(existing.map(a => dedupKey(userEmail, a.achievement_id, a.character_id)));
    const existingIds = new Set(existing.map(a => a.achievement_id));

    // toUnlock: Map<dedupKey, { achievement_id, character_id, character_name }>
    const toUnlock = new Map();
    const mark = (id, charId = null, charName = '') => {
      const k = dedupKey(userEmail, id, charId);
      if (!existingKeys.has(k) && !toUnlock.has(k)) {
        toUnlock.set(k, { achievement_id: id, character_id: charId, character_name: charName });
      }
    };

    const userMsgs = allMessages.filter(m => m.sender_type === 'user');
    const charMsgs = allMessages.filter(m => m.sender_type === 'character');
    const activeChars = allCharacters.filter(c => c.status !== 'deleted');
    const wpMsgs = allMessages.filter(m => m.channel === 'world_phone');
    const allDays = new Set(userMsgs.map(m => new Date(m.created_date || m.timestamp).toDateString()));

    // ── GLOBAL ACHIEVEMENTS ──────────────────────────────────────────────────

    // first_impression: sent at least 1 message
    if (userMsgs.length >= 1) mark('first_impression');

    // seen_it_all: received a photo from a character
    const imgMsg = charMsgs.find(m => m.image_url);
    if (imgMsg) mark('seen_it_all', imgMsg.character_id, imgMsg.character_name);

    // still_here: 3+ distinct days
    if (allDays.size >= 3) mark('still_here');

    // consistent: 5+ distinct days
    if (allDays.size >= 5) mark('consistent');

    // they_came_back: gap of 3+ days then returned
    if (userMsgs.length >= 2) {
      const sorted = [...userMsgs].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
      for (let i = 1; i < sorted.length; i++) {
        const gap = new Date(sorted[i].created_date) - new Date(sorted[i-1].created_date);
        if (gap > 3 * 86400000) { mark('they_came_back'); break; }
      }
    }

    // left_on_read: character message unread 24h+
    const unread = charMsgs.find(m => !m.is_read && (now - new Date(m.created_date).getTime()) > 86400000);
    if (unread) mark('left_on_read', unread.character_id, unread.character_name);

    // group_hangout: participated in a group conversation (3+ character_ids in one conversation)
    const groupConvo = allConversations.find(c => (c.character_ids || []).length >= 2);
    if (groupConvo) mark('group_hangout');

    // new_place: visited a new location (LocationHistory has any record)
    if (locationHistory.length > 0) mark('new_place');

    // productive_day: messages exist across morning, afternoon, and evening in one day
    const dayBuckets = {};
    userMsgs.forEach(m => {
      const d = new Date(m.created_date || m.timestamp);
      const ds = d.toDateString();
      const h = d.getHours();
      if (!dayBuckets[ds]) dayBuckets[ds] = { am: false, pm: false, eve: false };
      if (h >= 6 && h < 12) dayBuckets[ds].am = true;
      if (h >= 12 && h < 18) dayBuckets[ds].pm = true;
      if (h >= 18) dayBuckets[ds].eve = true;
    });
    if (Object.values(dayBuckets).some(b => b.am && b.pm && b.eve)) mark('productive_day');

    // showed_up_anyway: 5+ day streak including a day where tension/conflict messages exist
    const tensionDays = new Set(
      charMsgs.filter(m => ['irritated','defensive','angry','frustrated'].includes(m.emotional_state))
        .map(m => new Date(m.created_date).toDateString())
    );
    if (allDays.size >= 5 && tensionDays.size > 0) mark('showed_up_anyway');

    // rent_paid: FinancialTransaction with type=rent exists
    const rentTxn = financialTxns.find(t => t.transaction_type === 'rent');
    if (rentTxn) mark('rent_paid');

    // ── PER-CHARACTER ACHIEVEMENTS ───────────────────────────────────────────
    for (const character of activeChars) {
      const cid = character.id;
      const cname = character.name;

      const cMsgs = charMsgs.filter(m => m.character_id === cid);
      const convIds = new Set(cMsgs.map(m => m.conversation_id));
      const uMsgs = userMsgs.filter(m => convIds.has(m.conversation_id));
      const total = cMsgs.length + uMsgs.length;

      // inner_circle: 10+ message exchanges
      if (total >= 10) mark('inner_circle', cid, cname);

      // ride_along: 7+ day span with same character
      if (total >= 2) {
        const all = [...cMsgs, ...uMsgs].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        const span = new Date(all[all.length-1].created_date) - new Date(all[0].created_date);
        if (span >= 7 * 86400000) mark('ride_along', cid, cname);
      }

      // longtime_contact (Always There): 14+ day span
      if (total >= 2) {
        const all = [...cMsgs, ...uMsgs].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        const span = new Date(all[all.length-1].created_date) - new Date(all[0].created_date);
        if (span >= 14 * 86400000) mark('longtime_contact', cid, cname);
      }

      // they_opened_up: character showed vulnerability 2+ times
      const openMsgs = cMsgs.filter(m => ['reflective','sad','vulnerable','longing','grief','loneliness','nostalgia'].includes(m.emotional_state));
      if (openMsgs.length >= 2) mark('they_opened_up', cid, cname);

      // that_meant_something: ❤️ reaction from character OR meaningful text pattern
      const heartMsg = uMsgs.find(m => m.reactions?.some(r => r.reactor_type === 'character' && r.emoji === '❤️'));
      if (heartMsg) mark('that_meant_something', cid, cname);

      // tension: 😡 reaction from character
      const angryMsg = uMsgs.find(m => m.reactions?.some(r => r.reactor_type === 'character' && r.emoji === '😡'));
      if (angryMsg) mark('tension', cid, cname);

      // you_were_there / big_moment: narrative message exists
      const narrativeMsg = cMsgs.find(m => m.is_narrative);
      if (narrativeMsg) {
        mark('you_were_there', cid, cname);
        const narTime = new Date(narrativeMsg.created_date).getTime();
        if (uMsgs.some(m => new Date(m.created_date).getTime() > narTime)) {
          mark('big_moment', cid, cname);
        }
      }

      // clutch_timing: replied within 2 minutes of a character message
      outer: for (const cm of cMsgs.slice(0, 200)) {
        const cmTime = new Date(cm.created_date).getTime();
        for (const um of uMsgs) {
          const umTime = new Date(um.created_date).getTime();
          if (umTime > cmTime && umTime - cmTime < 2 * 60000) { mark('clutch_timing', cid, cname); break outer; }
        }
      }

      // bar_night (Bar Night): messages in a bar/club/nightlife context
      const barMsgs = [...cMsgs, ...uMsgs].filter(m => {
        const t = (m.content || '').toLowerCase();
        return /\b(bar|club|nightclub|lounge|night\s+out|went\s+out|clubbing|drinks?\s+(tonight|last night))\b/.test(t);
      });
      if (barMsgs.length >= 2) mark('bar_night', cid, cname);

      // night_out: any bar/nightlife message
      if (barMsgs.length >= 1) mark('night_out', cid, cname);

      // photo_history (Picture This): 3+ photo messages with this character
      const photoMsgs = cMsgs.filter(m => m.image_url);
      if (photoMsgs.length >= 3) mark('photo_history', cid, cname);

      // trust_built: trust_level on relationship > 70 OR trust increases detected in LifeEvent
      const charTrustLevel = character.trust_level ?? 50;
      if (charTrustLevel > 70) mark('trust_built', cid, cname);
      // Also check LifeEvent for trust-increase events
      const trustEvents = lifeEvents.filter(e =>
        e.character_id === cid &&
        (e.event_type === 'relationship_shift' || e.event_type === 'bonding_event') &&
        e.valence === 'positive'
      );
      if (trustEvents.length >= 2) mark('trust_built', cid, cname);

      // reconnected (Reconnect / We Came Back): gap of 7+ days then resumed conversation
      if (total >= 2) {
        const all = [...cMsgs, ...uMsgs].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        for (let i = 1; i < all.length; i++) {
          const gap = new Date(all[i].created_date) - new Date(all[i-1].created_date);
          if (gap > 7 * 86400000) { mark('reconnected', cid, cname); break; }
        }
      }

      // reconciliation (We Came Back): tension followed by resolution
      const hasTension = lifeEvents.some(e => e.character_id === cid && e.event_type === 'conflict_event');
      const hasResolution = lifeEvents.some(e => e.character_id === cid && e.event_type === 'reconciliation_event');
      if (hasTension && hasResolution) mark('reconciliation', cid, cname);
      // Also check message patterns: apology followed by positive exchange
      const apologyMsgs = uMsgs.filter(m => /i('m|\s+am)\s+(so\s+)?sorry|my\s+bad|i\s+apologize|i\s+was\s+wrong/i.test(m.content || ''));
      if (apologyMsgs.length >= 1) {
        mark('apologized', cid, cname);
        mark('tension_resolved', cid, cname); // proxy: apologized = tension resolved
      }

      // financial_lifeline (Came Through): financial support events
      const charTxns = financialTxns.filter(t => t.receiver_id === cid || t.character_id === cid);
      const giftTxns = charTxns.filter(t => ['gift','loan','financial_lifeline'].includes(t.transaction_type) && t.amount > 0);
      if (giftTxns.length >= 1) mark('financial_lifeline', cid, cname);

      // financial_clutch: help covering expense mentioned in messages
      const clutchMsgs = uMsgs.filter(m => /sent\s+(you\s+)?(money|funds|cash|\$)|help(ing)?\s+(with|pay|cover)\s+(your\s+)?(rent|bill|expense)|i('ll|\s+will)\s+(cover|pay|help\s+with)/i.test(m.content || ''));
      if (clutchMsgs.length >= 1) mark('financial_clutch', cid, cname);

      // witnessed_birth (New Life): birth/newborn LifeEvent or memory keyword
      const birthEvent = lifeEvents.find(e =>
        e.character_id === cid && (
          e.event_type === 'life_milestone_event' &&
          /(birth|newborn|baby|born|pregnant|pregnancy)/i.test(e.title + ' ' + (e.description || ''))
        )
      );
      if (birthEvent) mark('witnessed_birth', cid, cname);
      const birthMemory = memories.find(m =>
        m.character_id === cid &&
        /(birth|newborn|baby|born|pregnant)/i.test((m.title || '') + ' ' + (m.description || ''))
      );
      if (birthMemory) mark('witnessed_birth', cid, cname);
      // Also check message text
      const birthMsg = [...cMsgs, ...uMsgs].find(m => /\b(newborn|had\s+(the\s+)?baby|just\s+gave\s+birth|she\s+(had|delivered)|born\s+today)\b/i.test(m.content || ''));
      if (birthMsg) mark('witnessed_birth', cid, cname);

      // watched_them_grow: character has grown (friendship_level > 80 or progression LifeEvent)
      const growthEvents = lifeEvents.filter(e =>
        e.character_id === cid &&
        ['achievement_qualifying_action','growth_event','life_milestone_event','recovery_event'].includes(e.event_type) &&
        e.valence === 'positive'
      );
      if (growthEvents.length >= 3) mark('watched_them_grow', cid, cname);
      if ((character.friendship_level ?? 75) > 85 && total >= 20) mark('watched_them_grow', cid, cname);

      // bedside_manner: health support messages
      const bedsideMsgs = uMsgs.filter(m => /how\s+are\s+you\s+(feeling|doing)|are\s+you\s+(ok|okay)|get\s+well|feel\s+better|i('m|\s+am)\s+here\s+for\s+you|thinking\s+(of|about)\s+you/i.test(m.content || ''));
      if (bedsideMsgs.length >= 1) mark('bedside_manner', cid, cname);

      // first_responder: emergency support messages or events
      const emergencyMsgs = uMsgs.filter(m => /call(ed|ing)?\s+(9-?1-?1|emergency|ambulance)|order(ed|ing)?\s+(an?\s+)?(uber|lyft|taxi)|took\s+(her|him|them)\s+to\s+(hospital|doctor|clinic)/i.test(m.content || ''));
      if (emergencyMsgs.length >= 1) mark('first_responder', cid, cname);

      // stayed_calm: calm de-escalation messages
      const calmMsgs = uMsgs.filter(m => /i\s+understand|i\s+hear\s+you|let('s|\s+us)\s+(calm|talk|work)|i('m|\s+am)\s+not\s+trying\s+to\s+fight|we\s+can\s+(figure|work|talk)/i.test(m.content || ''));
      if (calmMsgs.length >= 1) mark('stayed_calm', cid, cname);

      // let_them_in: user opened up
      const openedUpMsgs = uMsgs.filter(m => /i\s+(feel|felt|have\s+been)\s+(so\s+)?(scared|alone|anxious|lost|broken|hurt|struggling)|i\s+never\s+told\s+(anyone|you)|something\s+i\s+don't\s+share|to\s+be\s+honest[,\s]/i.test(m.content || ''));
      if (openedUpMsgs.length >= 1) mark('let_them_in', cid, cname);

      // hard_truth
      const hardTruthMsgs = uMsgs.filter(m => /i\s+(have|need)\s+to\s+(be\s+honest|tell\s+you\s+(something|the truth))|the\s+truth\s+is|you\s+might\s+not\s+(want\s+to\s+)?hear\s+this/i.test(m.content || ''));
      if (hardTruthMsgs.length >= 1) mark('hard_truth', cid, cname);

      // the_push: encouraged action
      const pushMsgs = uMsgs.filter(m => /should\s+(take|enroll|try|start)\s+(a\s+)?(course|class|degree|program)|go(ing)?\s+(back\s+to\s+)?school|you\s+(should|need\s+to)\s+(go\s+for\s+it|do\s+it|apply)/i.test(m.content || ''));
      if (pushMsgs.length >= 1) mark('the_push', cid, cname);

      // voice_of_reason: talked them out of something
      const reasonMsgs = uMsgs.filter(m => /think\s+(about\s+this|before\s+you|it\s+through)|are\s+you\s+sure\s+(about|this)|slow\s+down|don't\s+rush/i.test(m.content || ''));
      if (reasonMsgs.length >= 1) mark('voice_of_reason', cid, cname);

      // favorite_contact: character has most messages of all
      // approximated by high total exchange count
      if (total >= 50) mark('favorite_contact', cid, cname);

      // grief_support: grief/loss messages or LifeEvent
      const griefEvent = lifeEvents.find(e =>
        e.character_id === cid &&
        ['grief_event','medical_event'].includes(e.event_type)
      );
      if (griefEvent) mark('grief_support', cid, cname);
      const griefMsgs = [...cMsgs, ...uMsgs].filter(m =>
        /\b(passed away|died|funeral|death|grief|mourning|loss|condolence)\b/i.test(m.content || '')
      );
      if (griefMsgs.length >= 2) mark('grief_support', cid, cname);

      // growth_arc: long engagement + positive LifeEvents
      if (total >= 30 && growthEvents.length >= 1) mark('growth_arc', cid, cname);

      // housing_intervention: housing/homeless LifeEvent
      const housingEvent = lifeEvents.find(e =>
        e.character_id === cid &&
        e.event_type === 'location_change_event' &&
        /(homeless|evict|move|housing|shelter)/i.test((e.title || '') + ' ' + (e.description || ''))
      );
      if (housingEvent) mark('housing_intervention', cid, cname);

      // healthy_choice: positive self-care messages
      const healthMsgs = uMsgs.filter(m => /i('m|\s+am)\s+(going\s+to\s+)?(take\s+a\s+break|step\s+back|breathe|take\s+care\s+of\s+myself)|choosing\s+(to\s+)?(let\s+it\s+go|stay\s+(calm|positive))/i.test(m.content || ''));
      if (healthMsgs.length >= 1) mark('healthy_choice', cid, cname);

      // World Phone awareness: mark character-to-character events
      const wpForChar = wpMsgs.filter(m => m.sender_character_id === cid || m.receiver_character_id === cid);
      if (wpForChar.length >= 3) mark('inner_circle', cid, cname); // WP = relationship depth signal

    } // end per-character loop

    // ── Grant all marked achievements ───────────────────────────────────────
    const granted = [];
    const errors = [];
    for (const [k, { achievement_id, character_id, character_name }] of toUnlock.entries()) {
      try {
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
        existingKeys.add(k);
      } catch (err) {
        errors.push({ achievement_id, error: err.message });
        console.error(`[retroactiveScan] Failed to grant ${achievement_id}: ${err.message}`);
      }
    }

    console.log(
      `[retroactiveScan] user=${userEmail}` +
      ` | msgs=${allMessages.length} chars=${activeChars.length}` +
      ` | lifeEvents=${lifeEvents.length} txns=${financialTxns.length}` +
      ` | memories=${memories.length} charMemories=${charMemories.length}` +
      ` | wpMsgs=${wpMsgs.length} locationHistory=${locationHistory.length}` +
      ` | evaluated=${toUnlock.size} granted=${granted.length} errors=${errors.length}`
    );

    return Response.json({
      success: true,
      scanned: {
        messages: allMessages.length,
        characters: activeChars.length,
        life_events: lifeEvents.length,
        financial_txns: financialTxns.length,
        memories: memories.length,
        char_memories: charMemories.length,
        world_phone_msgs: wpMsgs.length,
        location_history: locationHistory.length,
      },
      granted: granted.length,
      achievements: granted.map(a => a.achievement_id),
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error) {
    console.error('[retroactiveScan] FATAL:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});