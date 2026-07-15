import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * triggerCharacterNarratives
 *
 * ACCOUNT-SCOPED: Generates automatic narrative messages ONLY for the active user's
 * own characters. Never pulls characters from other accounts.
 *
 * When called by the scheduler (no user token), it iterates all users who have
 * active_created_character records and processes each independently.
 *
 * When called by the frontend (user token present), it processes only that user's characters.
 *
 * Rules:
 * - Only active_created_character types
 * - Characters matched by owner_email OR created_by (both checked, deduplicated)
 * - Only conversations active in the last 7 days
 * - No narrative within the last 2 hours
 * - At least 3 messages in the conversation
 * - 40% random chance per eligible character to keep it organic
 */

const buildLocationAffinityContext = (character) => {
  const se = character.social_energy || 'ambivert';
  const mood = character.emotional_state || 'calm';
  const lines = [`Social energy: ${se}`, `Current mood: ${mood}`];
  if (character.personality_traits?.length) lines.push(`Traits: ${character.personality_traits.join(', ')}`);
  return lines.join('. ');
};

async function processUserNarratives(base44SR, userEmail, runId, diagnosticMode = false) {
  const log = [];
  const now = new Date();
  // active_created_characters receive narratives if conversation was active in the last 7 days
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const results = [];

  // ACCOUNT-SCOPED: fetch this user's characters by both created_by and owner_email
  // Some characters may have been created by service role but owned by the user
  const [byCreatedBy, byOwnerEmail] = await Promise.all([
    base44SR.entities.Character.filter({ created_by: userEmail }, null, 200).catch(() => []),
    base44SR.entities.Character.filter({ owner_email: userEmail }, null, 200).catch(() => []),
  ]);
  // Deduplicate by id
  const seenIds = new Set();
  const rawChars = [...byCreatedBy, ...byOwnerEmail].filter(c => {
    if (seenIds.has(c.id)) return false;
    seenIds.add(c.id);
    return true;
  });
  const userChars = rawChars.filter(c =>
    c.character_type === 'active_created_character' &&
    (!c.status || c.status === 'active')
  );

  log.push(`[${runId}] User: ${userEmail} | eligible chars found: ${userChars.length}`);
  console.log(`[triggerCharacterNarratives] ${log[log.length - 1]}`);

  for (const character of userChars) {
    const skipBase = { characterId: character.id, name: character.name, userEmail, status: 'skipped' };

    // ── 1. Find the most recent DIRECT (user↔character) conversation (scoped to this user) ──
    // CRITICAL BOUNDARY: narratives must ONLY be written to type='direct', channel!='world_phone' convos.
    // World Phone conversations (channel='world_phone') are bilateral character↔character threads.
    // Writing is_narrative=true messages into world_phone convos is a boundary violation.
    // BUG FIXED (2026-06-21): world_phone convos were stored with type='direct', so filtering by
    // type='direct' alone was insufficient — they also matched the character and user scope, causing
    // narratives to be routed into world_phone threads. The additional channel guard below prevents this.
    const [convosByCreatedBy, convosByOwnerEmail] = await Promise.all([
      base44SR.entities.Conversation.filter({ type: 'direct', created_by: userEmail }, '-last_message_date', 100).catch(() => []),
      base44SR.entities.Conversation.filter({ type: 'direct', owner_email: userEmail }, '-last_message_date', 100).catch(() => []),
    ]);
    // Deduplicate by id, then filter for this character
    // BOUNDARY GUARD: exclude any conversation whose channel is 'world_phone' — those are
    // character↔character bilateral threads, not user↔character chat conversations.
    const seenConvoIds = new Set();
    const allUserConvos = [...convosByCreatedBy, ...convosByOwnerEmail].filter(c => {
      if (seenConvoIds.has(c.id)) return false;
      seenConvoIds.add(c.id);
      return true;
    });
    const convos = allUserConvos
      .filter(c =>
        Array.isArray(c.character_ids) &&
        c.character_ids.includes(character.id) &&
        c.channel !== 'world_phone'   // BOUNDARY: never write narratives to world_phone threads
      )
      .sort((a, b) => new Date(b.last_message_date || 0) - new Date(a.last_message_date || 0))
      .slice(0, 1);

    if (!convos.length) {
      const reason = 'no direct conversation found for this user';
      console.log(`[triggerCharacterNarratives] SKIP ${character.name} (${userEmail}) — ${reason}`);
      results.push({ ...skipBase, reason, location: character.resolved_current_location_name || 'unknown', activity: character.current_activity || 'unknown', sleep: character.resolved_presence_status || 'unknown', ts: now.toISOString(), runId });
      continue;
    }

    const convo = convos[0];

    // ── 2. Activity check — last 7 days (active_created_character gets a generous window) ──
    const lastMsgDate = convo.last_message_date ? new Date(convo.last_message_date) : null;
    if (!lastMsgDate || lastMsgDate < sevenDaysAgo) {
      const reason = `conversation inactive — last message: ${convo.last_message_date || 'never'} (needs to be within 7 days)`;
      console.log(`[triggerCharacterNarratives] SKIP ${character.name} — ${reason}`);
      results.push({ ...skipBase, reason, ts: now.toISOString(), runId });
      continue;
    }

    // ── 3. Cooldown — no narrative in last 2h ──
    const recentNarratives = await base44SR.entities.Message.filter(
      { conversation_id: convo.id, is_narrative: true },
      '-timestamp', 5
    ).catch(() => []);
    const narrativeRecently = recentNarratives.some(m => new Date(m.timestamp) > twoHoursAgo);
    if (narrativeRecently) {
      const lastN = recentNarratives[0]?.timestamp;
      const reason = `narrative cooldown — last narrative: ${lastN}`;
      console.log(`[triggerCharacterNarratives] SKIP ${character.name} — ${reason}`);
      results.push({ ...skipBase, reason, ts: now.toISOString(), runId });
      continue;
    }

    // ── 4. Minimum messages ──
    const recentMessages = await base44SR.entities.Message.filter(
      { conversation_id: convo.id },
      '-timestamp', 15
    ).catch(() => []);
    if (recentMessages.length < 3) {
      const reason = `only ${recentMessages.length} messages (need 3+)`;
      console.log(`[triggerCharacterNarratives] SKIP ${character.name} — ${reason}`);
      results.push({ ...skipBase, reason, ts: now.toISOString(), runId });
      continue;
    }

    // ── 5. 40% random gate (bypass in diagnostic mode) ──
    if (!diagnosticMode && Math.random() > 0.4) {
      const reason = 'random gate (40% chance — not this run)';
      console.log(`[triggerCharacterNarratives] SKIP ${character.name} — ${reason}`);
      results.push({ ...skipBase, reason, ts: now.toISOString(), runId });
      continue;
    }

    // ── 6. READ CHARACTER STATE TRUTH ──
    const resolvedLocationName = character.resolved_current_location_name || null;
    const resolvedPresenceStatus = character.resolved_presence_status || null;
    const currentActivity = character.current_activity || null;
    const emotionalState = character.emotional_state || 'calm';

    // Determine sleep state
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hourET = nowET.getHours();
    let isAsleep = resolvedPresenceStatus === 'sleeping' || resolvedPresenceStatus === 'napping';
    if (!isAsleep && character.sleep_start_time && character.wake_up_time) {
      const sH = parseInt(character.sleep_start_time.split(':')[0], 10);
      const wH = parseInt(character.wake_up_time.split(':')[0], 10);
      isAsleep = sH > wH ? (hourET >= sH || hourET < wH) : (hourET >= sH && hourET < wH);
    }
    const timeStr = `${hourET % 12 || 12}:${String(nowET.getMinutes()).padStart(2, '0')} ${hourET >= 12 ? 'PM' : 'AM'}`;
    const dayOfWeek = nowET.toLocaleDateString('en-US', { weekday: 'long' });

    console.log(`[triggerCharacterNarratives] ELIGIBLE: ${character.name} (${userEmail}) | loc: ${resolvedLocationName || 'unknown'} | sleep: ${isAsleep} | emotion: ${emotionalState} | activity: ${currentActivity || 'none'}`);

    // ── 7. BUILD PROMPT ──
    const recentText = recentMessages
      .slice(0, 5)
      .reverse()
      .map(m => `${m.sender_type === 'user' ? 'User' : character.name}: ${m.content || '(photo)'}`)
      .join('\n');

    const locationAffinity = buildLocationAffinityContext(character);
    const city = [character.city, character.state].filter(Boolean).join(', ');
    const weather = character.weather_summary || '';

    const stateBlock = `
CHARACTER STATE (authoritative — ground truth):
- Name: ${character.name}
- Gender: ${character.gender || 'unspecified'}
- Current location: ${resolvedLocationName || 'unknown'}
- Presence status: ${resolvedPresenceStatus || 'unknown'}
- Current activity: ${currentActivity || 'going about their day'}
- Sleep state: ${isAsleep ? 'ASLEEP' : 'AWAKE'}
- Emotional state: ${emotionalState}
- Occupation: ${character.occupation || 'none specified'}
- Current time: ${timeStr} ${dayOfWeek}
${weather ? `- Weather: ${weather}` : ''}
${city ? `- City: ${city}` : ''}
- Location affinity: ${locationAffinity}`;

    const sleepRule = isAsleep
      ? `\nIMPORTANT: ${character.name} IS ASLEEP. Write ONLY about the room's ambient environment and stillness. No movement, no actions, no objects interacted with. Just quiet and rest.`
      : '';

    // ── HOUSEHOLD & SEASONAL ACTIVITY INSPIRATION (additive) ───────────────────
    // Additional narrative-style patterns. Inspiration only — the generator must
    // expand them into complete narrative beats, never copy verbatim.
    const HOUSEHOLD_ACTIVITY_EXAMPLES = {
      cooking_meal: ["They spend time in the kitchen preparing food, moving between ingredients, cookware, and the stove until the meal comes together."],
      preparing_breakfast: ["They start the morning by preparing breakfast, taking a few quiet moments to make something to eat before beginning the day."],
      preparing_lunch: ["They put together lunch, taking a break from whatever they were doing before sitting down to eat."],
      preparing_dinner: ["They prepare dinner, taking their time in the kitchen before enjoying the meal they made."],
      making_coffee: ["They make a fresh cup of coffee, taking a moment to enjoy the familiar routine before continuing with the day."],
      making_tea: ["They prepare a cup of tea, letting the quiet routine help them slow down for a few moments."],
      putting_away_groceries: ["After returning from the store, they unpack the groceries and organize the food, household items, and supplies where they belong."],
      meal_prepping: ["They prepare food ahead of time, portioning and organizing meals to make the coming days easier."],
      cleaning_bathroom: ["They clean the bathroom, working through the sink, mirror, shower, and surfaces until everything feels fresh again."],
      cleaning_kitchen: ["They clear the counters, deal with dishes, wipe down the kitchen, and put everything back where it belongs."],
      cleaning_bedroom: ["They straighten the bedroom, organize their belongings, and leave the room noticeably cleaner and more comfortable."],
      doing_laundry: ["They gather dirty clothes, start or finish a load of laundry, and later put everything away once it is clean."],
      folding_laundry: ["They fold clean laundry, organizing everything before putting it away where it belongs."],
      doing_dishes: ["They wash or load the dishes, clean the sink, and leave the kitchen ready to use again."],
      vacuuming: ["They vacuum around the house, moving from room to room until the floors feel noticeably cleaner."],
      sweeping_mopping: ["They spend some time sweeping or mopping the floors, freshening up the house one room at a time."],
      taking_out_trash: ["They gather the household trash and take it outside before replacing the bags and returning inside."],
      making_bed: ["They straighten the bed, smooth the bedding, and leave the room looking more organized."],
      organizing_closet: ["They organize the closet, straightening shelves, hanging clothes, and putting stored items back into order."],
      organizing_paperwork: ["They sort through paperwork, organizing important documents and clearing away unnecessary clutter."],
      checking_mail: ["They check the mailbox, sort through what arrived, and bring everything inside."],
      watching_television: ["They settle in and watch television for a while, taking a chance to relax and unwind."],
      playing_video_games: ["They spend some time playing a video game, focusing on the experience before eventually stepping away."],
      reading_book: ["They settle into a comfortable place and spend some quiet time reading."],
      listening_to_music: ["They turn on some music and let it play while they relax or move through the house."],
      browsing_internet: ["They spend some time browsing the internet, catching up on things that interest them before moving on."],
      using_computer: ["They sit down at the computer for a while, taking care of whatever they wanted to work on."],
      doing_homework: ["They sit down with homework, making steady progress before moving on with the rest of their day."],
      studying: ["They spend time studying, reviewing information and working toward a better understanding of the material."],
      writing_journal: ["They spend a few quiet moments writing in a journal, reflecting on their thoughts before continuing with the day."],
      exercising_home: ["They complete a workout or exercise session at home before cooling down."],
      stretching: ["They spend a few minutes stretching, loosening up and helping themselves feel more comfortable."],
      meditating: ["They take a few quiet moments to meditate, slowing their breathing and clearing their mind."],
      relaxing_home: ["They spend some quiet time relaxing at home before continuing with the rest of their day."],
      brushing_teeth: ["They brush their teeth and freshen up before continuing with the day or preparing for the night."],
      taking_shower: ["They take a shower, cleaning up and giving themselves a chance to reset before moving on."],
      washing_face: ["They wash their face and freshen up before returning to the rest of their routine."],
      grooming_hair: ["They spend a few moments fixing and grooming their hair before continuing with the day."],
      getting_dressed: ["They get dressed for the day or for their next activity, choosing clothing that matches their plans."],
      choosing_outfit: ["They spend a few moments deciding what to wear before settling on an outfit appropriate for the day."],
      getting_ready_bed: ["They begin winding down for the night, finishing the last parts of their evening routine before settling in to sleep."],
      taking_bath: ["They spend some quiet time soaking in a warm bath, using the opportunity to relax and unwind before continuing with the rest of their day or evening."],
      washing_hair: ["They spend a little extra time washing and caring for their hair as part of their normal grooming routine."],
      front_porch: ["They spend some time sitting on the front porch, enjoying the fresh air and watching the neighborhood as the day quietly passes by."],
      backyard: ["They head out into the backyard for a while, enjoying the outdoors and taking a peaceful break from being inside."],
      playing_solitaire: ["They sit down for a quiet game of solitaire, passing the time while enjoying a few moments to themselves."],
    };
    const SEASONAL_ACTIVITY_EXAMPLES = {
      new_year: ["They spend a quiet New Year's evening at home, letting the night settle in without needing much else."],
      valentines: ["They put together something small for Valentine's Day, keeping it low-key but intentional."],
      spring: ["They open the windows to let the spring air in, taking a moment before getting back to the day."],
      summer: [
        "They step outside to watch the fireworks in the night sky, letting the sound carry over the neighborhood.",
        "They enjoy the warm evening out in the yard, taking a break from being inside.",
      ],
      halloween: ["They sort through a few Halloween decorations, deciding what to put out this year."],
      thanksgiving: ["They start prepping for Thanksgiving dinner early, moving through the kitchen at their own pace."],
      winter_holidays: [
        "They decorate the home for the holidays, working through the familiar pieces one at a time.",
        "They spend a quiet holiday evening at home, letting the night come on its own terms.",
        "They bake seasonal treats, filling the kitchen with the smell of it for a while.",
        "They settle in to watch a holiday movie, letting the evening slow down around it.",
      ],
    };
    const _seasonalKeysTrig = (() => {
      const m = nowET.getMonth() + 1, d = nowET.getDate();
      const k = [];
      if ((m === 12 && d >= 30) || (m === 1 && d <= 2)) k.push('new_year');
      if (m === 2 && d >= 12 && d <= 16) k.push('valentines');
      if (m === 3 || m === 4) k.push('spring');
      if (m >= 6 && m <= 8) k.push('summer');
      if (m === 10 && d >= 28) k.push('halloween');
      if (m === 11) k.push('thanksgiving');
      if (m === 12) k.push('winter_holidays');
      return k;
    })();
    const _householdKeysTrig = [...Object.keys(HOUSEHOLD_ACTIVITY_EXAMPLES)].sort(() => Math.random() - 0.5).slice(0, 3);
    const _householdExTrig = _householdKeysTrig.flatMap(k => (HOUSEHOLD_ACTIVITY_EXAMPLES[k] || []).slice(0, 1)).slice(0, 3);
    const _seasonalExTrig = _seasonalKeysTrig.flatMap(k => (SEASONAL_ACTIVITY_EXAMPLES[k] || []).slice(0, 1)).slice(0, 2);
    const _combinedTrig = [..._householdExTrig, ..._seasonalExTrig];
    const householdActivityBlock = (_combinedTrig.length > 0 && !isAsleep)
      ? `\n\nHOUSEHOLD & SEASONAL ACTIVITY INSPIRATION (use as inspiration — generate a NEW variation, never copy verbatim):\n${_combinedTrig.map(e => `  • ${e}`).join('\n')}\n\nCLOTHING-AWARE NOTE: For wardrobe activities, if Outfit Rotation is enabled and today's outfit is available, use the current scheduled outfit. If Character Closet data exists, use the appropriate clothing from the closet. If neither is available, keep the narrative general — do NOT invent clothing items or wardrobe details.\nMUSIC PREFERENCE NOTE: When authoritative music preference data exists, naturally incorporate favorite artists, genres, styles, or playlists into music narratives. If none exists, keep music narratives general.`
      : '';

    const prompt = `You are writing a short, third-person narrative moment for a character named ${character.name}.
${stateBlock}
${householdActivityBlock}

RECENT CONVERSATION:
${recentText}

TASK:
Write a short narrative moment (1–3 sentences, STRICTLY third person) that:
- Reflects something authentic happening in ${character.name}'s life RIGHT NOW based on their current state
- Fits naturally after the conversation above — like a scene cut or life update
- Is grounded and real — NOT dramatic, NOT poetic, NOT over-written
- NEVER mentions "the user" or addresses them directly
- STRICTLY third person — use "${character.name}" or pronouns (he/she/they). NEVER "I", "me", "my"
- Matches their current location (${resolvedLocationName || 'their space'}) and time of day (${timeStr})
${sleepRule}

Return ONLY the narrative text, nothing else.`;

    // ── 8. GENERATE ──
    let narrativeContent;
    try {
      narrativeContent = await base44SR.integrations.Core.InvokeLLM({ prompt });
    } catch (llmErr) {
      const reason = `LLM error: ${llmErr.message}`;
      console.error(`[triggerCharacterNarratives] LLM FAILED for ${character.name} (${userEmail}): ${reason}`);
      results.push({ ...skipBase, status: 'error', reason, ts: now.toISOString(), runId });
      continue;
    }

    if (!narrativeContent?.trim()) {
      const reason = 'LLM returned empty narrative';
      console.error(`[triggerCharacterNarratives] EMPTY NARRATIVE for ${character.name} (${userEmail})`);
      results.push({ ...skipBase, status: 'error', reason, ts: now.toISOString(), runId });
      continue;
    }

    // Whitespace normalization only — no lexical replacement.
    narrativeContent = (narrativeContent || '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // ── HYGIENE ACTION RECOVERY ─────────────────────────────────────────────
    // A narrative that establishes a recognized hygiene action (shower, bath,
    // washing face/hair/hands, brushing teeth, grooming) must recover the
    // authoritative hygiene_value. Recovery happens because the action occurred;
    // it is not gated on the current hygiene value. Reuses the existing
    // autonomous-activity recovery amounts (+20 wash / +10 groom). The existing
    // 75 is the established fallback/baseline already used by the hygiene
    // system; no separate cutoff is introduced here. Live Needs reads this same
    // field, so the bar reflects the recovery without a refresh, scheduler, or
    // repair job.
    // The hygiene write is a required part of this completed narrative action:
    // if it fails, the narrative is not committed as successful.
    {
      const _narrLower = (narrativeContent || '').toLowerCase();
      const _isWash = /shower|showering|bath|bathing|bathe|bathed|washing (her|his|their )?(face|hair|hands)|washes (her|his|their )?(face|hair|hands)|wash up|washed up|freshen up|freshened up|soaking in a (warm )?bath/.test(_narrLower);
      const _isGroom = !_isWash && /brush(ing|es|ed)? (her|his|their )?teeth|groom(ing|ed)?|fixing (her|his|their )?hair/.test(_narrLower);
      if (_isWash || _isGroom) {
        const _delta = _isWash ? 20 : 10;
        const _target = Math.min(100, Math.round((character.hygiene_value ?? 75) + _delta));
        await base44SR.entities.Character.update(character.id, { hygiene_value: _target });
        console.log(`[triggerCharacterNarratives] hygiene recovery applied: ${character.name} ${character.hygiene_value ?? 75} → ${_target} (${_isWash ? 'wash +20' : 'groom +10'}) — narrative established a hygiene action`);
      }
    }

    // ── 9. SAVE — scoped to the correct conversation + character ──
    let createdMessage;
    try {
      createdMessage = await base44SR.entities.Message.create({
        conversation_id: convo.id,
        sender_type: 'character',
        character_id: character.id,
        character_name: character.name,
        content: narrativeContent.trim(),
        is_narrative: true,
        is_read: false,
        timestamp: now.toISOString(),
      });
    } catch (saveErr) {
      const reason = `save error: ${saveErr.message}`;
      console.error(`[triggerCharacterNarratives] SAVE FAILED for ${character.name}: ${reason}`);
      results.push({ ...skipBase, status: 'error', reason, ts: now.toISOString(), runId });
      continue;
    }

    // Update conversation preview
    await base44SR.entities.Conversation.update(convo.id, {
      last_message_preview: narrativeContent.trim().substring(0, 100),
      last_message_date: now.toISOString(),
    }).catch(() => {});

    const successEntry = {
      characterId: character.id,
      name: character.name,
      userEmail,
      status: 'sent',
      narrativeId: createdMessage?.id,
      conversationId: convo.id,
      location: resolvedLocationName || 'unknown',
      activity: currentActivity || 'none',
      sleep: isAsleep ? 'asleep' : 'awake',
      narrativePreview: narrativeContent.trim().substring(0, 100),
      ts: now.toISOString(),
      runId,
    };
    console.log(`[triggerCharacterNarratives] SUCCESS: ${character.name} (${userEmail}) — msg_id: ${createdMessage?.id} | convo: ${convo.id}`);
    results.push(successEntry);
  }

  return results;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const body = await req.json().catch(() => ({}));
    const diagnosticMode = body?.diagnosticMode === true;
    const runId = `run_${Date.now()}`;

    console.log(`[triggerCharacterNarratives] ▶ START runId=${runId} | diagnosticMode=${diagnosticMode}`);

    // ── DETERMINE CALLER SCOPE ──────────────────────────────────────────────
    // If a real user is calling (e.g. diagnostic button), process only their account.
    // If called by scheduler (no user token), iterate all user accounts.

    let callerUser = null;
    try { callerUser = await base44.auth.me(); } catch (_) {}

    const base44SR = base44.asServiceRole;
    const allResults = [];

    if (callerUser?.email) {
      // SINGLE USER: process only the caller's account
      console.log(`[triggerCharacterNarratives] Single-user mode: ${callerUser.email}`);
      const results = await processUserNarratives(base44SR, callerUser.email, runId, diagnosticMode);
      allResults.push(...results);
    } else {
      // SCHEDULER MODE: iterate distinct user emails from Character records
      // Page through ALL characters in batches to avoid the 500-record cap
      let allChars = [];
      let page = 0;
      const PAGE_SIZE = 500;
      while (true) {
        const batch = await base44SR.entities.Character.list(null, PAGE_SIZE, page * PAGE_SIZE).catch(() => []);
        if (!batch || batch.length === 0) break;
        allChars = allChars.concat(batch);
        if (batch.length < PAGE_SIZE) break; // last page
        page++;
      }

      const eligibleChars = allChars.filter(c =>
        c.character_type === 'active_created_character' &&
        (!c.status || c.status === 'active')
      );

      // Collect unique user emails — prefer owner_email, fall back to created_by
      const userEmails = [...new Set(
        eligibleChars
          .map(c => c.owner_email || c.created_by)
          .filter(e => e && !e.startsWith('service+')) // exclude service-role created records
      )];

      console.log(`[triggerCharacterNarratives] Scheduler: ${allChars.length} total chars → ${eligibleChars.length} active_created_character → ${userEmails.length} unique user accounts`);

      for (const email of userEmails) {
        const results = await processUserNarratives(base44SR, email, runId, false);
        allResults.push(...results);
      }
    }

    const sent = allResults.filter(r => r.status === 'sent').length;
    const skipped = allResults.filter(r => r.status === 'skipped').length;
    const errors = allResults.filter(r => r.status === 'error').length;

    console.log(`[triggerCharacterNarratives] ▶ COMPLETE runId=${runId} | sent=${sent} skipped=${skipped} errors=${errors}`);

    return Response.json({
      success: true,
      runId,
      summary: { sent, skipped, errors, total: allResults.length },
      results: allResults,
    });

  } catch (error) {
    console.error('[triggerCharacterNarratives] FATAL:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});