import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const {
      characterId,
      forceGenerate = false,
      trigger = 'interval',
    } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // ── DETECT CALLER CONTEXT ─────────────────────────────────────────────
    // This function is called two ways:
    //   1. User-triggered (Chat page "Right Now", Narrative Builder) — has user auth token
    //   2. Scheduled orchestrator (runAutomaticNarrativesForAllCharacters) — no user token
    // We detect which path we're on and use the appropriate write scope.
    let callerUser = null;
    try { callerUser = await base44.auth.me(); } catch { /* scheduled — no token */ }
    const isUserTriggered = !!callerUser;

    // ── FETCH CHARACTER ───────────────────────────────────────────────────
    // User-triggered: use user-scoped filter (correct RLS path, same as Chat page).
    // Scheduled: no user token available, use asServiceRole.
    let charList;
    if (isUserTriggered) {
      charList = await base44.entities.Character.filter({ id: characterId }, null, 1);
    } else {
      charList = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1);
    }
    const character = charList?.[0];

    if (!character) {
      return Response.json({ error: 'Character not found', characterId }, { status: 404 });
    }

    // owner_email is the sole source of truth — created_by is permanently forbidden
    const ownerEmail = character.owner_email;
    const ownerUser = character.owner_user_id;

    if (!ownerEmail) {
      console.error(`[generateAutomaticNarrative] BLOCKED: Character id=${characterId} name="${character.name}" has no owner_email — cannot write narrative. Ownership cannot be verified.`);
      return Response.json({
        success: false,
        error: `Character "${character.name}" (id=${characterId}) is missing owner_email. Narrative generation stopped. Fix ownership data before retrying.`,
        reason: 'missing_owner_email',
      }, { status: 422 });
    }

    console.log(`[generateAutomaticNarrative] ▶ Character: ${character.name} (${characterId}) | trigger: ${trigger}`);

    // ── CHECK INTERVAL (skip for manual triggers) ─────────────────────────
    const NOW = new Date();
    const isManual = trigger === 'manual_right_now';

    if (!forceGenerate && !isManual) {
      const lastNarrativeList = await base44.asServiceRole.entities.CharacterAutomaticNarrative.filter(
        { character_id: characterId },
        '-timestamp',
        1
      );
      const lastNarrative = lastNarrativeList?.[0];
      const INTERVAL_MINUTES = 30;
      const minIntervalMs = INTERVAL_MINUTES * 60 * 1000;

      if (lastNarrative) {
        const timeSinceLastMs = NOW.getTime() - new Date(lastNarrative.timestamp).getTime();
        if (timeSinceLastMs < minIntervalMs) {
          const nextEligibleTime = new Date(new Date(lastNarrative.timestamp).getTime() + minIntervalMs);
          console.log(`[generateAutomaticNarrative] ⏭️ Skipped (interval): next=${nextEligibleTime.toISOString()}`);
          return Response.json({
            success: false, skipped: true, reason: 'interval_not_reached',
            lastNarrativeTime: lastNarrative.timestamp,
            nextEligibleTime: nextEligibleTime.toISOString(),
          });
        }
      }
    }

    // ── RESOLVE LOCATION — single source of truth ─────────────────────────
    const locationId =
      character.resolved_current_location_id ||
      character.current_home_location_id ||
      null;

    let location = null;
    let resolvedLocationName = 'home';
    let resolvedZoneName = null;
    let locationCategory = 'home';
    let locationDescription = '';

    if (locationId) {
      const locList = await base44.asServiceRole.entities.LocationReference.filter({ id: locationId }, null, 1);
      location = locList?.[0];
      if (location) {
        resolvedLocationName = location.name;
        locationCategory = location.category || 'generic';
        locationDescription = location.description || '';
        if (location.zones && location.zones.length > 0) {
          resolvedZoneName = location.zones[0].zone_name;
        }
      }
    }

    console.log(`[generateAutomaticNarrative] Location: ${resolvedLocationName} (${locationId || 'none'})`);

    // ── DETERMINE STATE — precise and enforced ────────────────────────────
    const nowET = new Date(NOW.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const minute = nowET.getMinutes();
    const currentMinutes = hour * 60 + minute;

    const timeOfDay =
      hour >= 5 && hour < 7 ? 'early_morning' :
      hour >= 7 && hour < 10 ? 'morning' :
      hour >= 10 && hour < 12 ? 'late_morning' :
      hour >= 12 && hour < 14 ? 'midday' :
      hour >= 14 && hour < 17 ? 'afternoon' :
      hour >= 17 && hour < 20 ? 'evening' :
      hour >= 20 && hour < 23 ? 'night' :
      'late_night';

    // Sleep state — use schedule fields
    const wakeHour = character.wake_up_time ? parseInt(character.wake_up_time.split(':')[0]) : 7;
    const sleepHour = character.sleep_start_time ? parseInt(character.sleep_start_time.split(':')[0]) : 23;
    const isAsleep = hour >= sleepHour || hour < wakeHour;
    const sleepState = isAsleep ? 'asleep' : 'awake';

    // Work state — check schedule fields
    let workState = 'off_work';
    let isAtWork = false;
    if (character.work_days && character.work_start_time && character.work_end_time) {
      const dayOfWeek = nowET.getDay();
      const [wsh, wsm] = character.work_start_time.split(':').map(Number);
      const [weh, wem] = character.work_end_time.split(':').map(Number);
      const workStart = wsh * 60 + wsm;
      const workEnd = weh * 60 + wem;
      if (character.work_days.includes(dayOfWeek) && currentMinutes >= workStart && currentMinutes < workEnd) {
        workState = 'at_work';
        isAtWork = true;
      }
    }
    if (character.resolved_presence_status === 'at_work') {
      workState = 'at_work';
      isAtWork = true;
    }

    // Travel state
    const travelState =
      character.travel_status && character.travel_status !== 'not_traveling' ? 'traveling' :
      character.resolved_presence_status === 'traveling' ? 'traveling' :
      'at_location';

    const isTraveling = travelState === 'traveling';
    const travelDestination = character.traveling_to_location_name || character.travel_destination_location_id || null;

    // Presence
    const presenceStatus = character.resolved_presence_status || 'home';

    // ── DEDUPLICATION: Same-instance check ─────────────────────────────────
    // Before generating a new narrative, verify that something actually changed
    // since the last narrative. Re-generating the same "at work" or "at school"
    // entry when the character is still at work/school creates duplicate entries.
    // Skip if: same location, same sleep/work/travel state, within 60 minutes,
    // AND no manual trigger (manual_right_now always generates).
    if (!isManual) {
      try {
        const lastTwoNarrs = await base44.asServiceRole.entities.CharacterAutomaticNarrative.filter(
          { character_id: characterId },
          '-timestamp',
          2
        ).catch(() => []);
        const lastNarr = lastTwoNarrs?.[0];
        if (lastNarr?.timestamp) {
          const lastNarrMs = new Date(lastNarr.timestamp).getTime();
          const elapsedMs = NOW.getTime() - lastNarrMs;
          const SAME_INSTANCE_DEDUP_MS = 60 * 60 * 1000; // 60 minutes

          // Check if state is unchanged from last narrative
          const sameLocation = lastNarr.location_id === locationId;
          const sameSleep    = lastNarr.sleep_state === sleepState;
          const sameWork     = lastNarr.work_state === workState;
          const sameTravel   = lastNarr.travel_state === travelState;
          const stateUnchanged = sameLocation && sameSleep && sameWork && sameTravel;

          if (elapsedMs < SAME_INSTANCE_DEDUP_MS && stateUnchanged) {
            console.log(
              `[generateAutomaticNarrative] ⏭️ Dedup skipped: same instance — ` +
              `loc=${resolvedLocationName} sleep=${sleepState} work=${workState} travel=${travelState} ` +
              `elapsed=${Math.round(elapsedMs / 60000)}min`
            );
            return Response.json({
              success: false,
              skipped: true,
              reason: 'same_instance_dedup',
              detail: 'location, sleep, work, and travel state unchanged since last narrative',
              lastNarrativeTime: lastNarr.timestamp,
              elapsedMinutes: Math.round(elapsedMs / 60000),
            });
          }
        }
      } catch (dedupErr) {
        console.warn(`[generateAutomaticNarrative] Dedup check failed (non-blocking): ${dedupErr.message}`);
      }
    }

    // ── NEEDS SNAPSHOT ────────────────────────────────────────────────────
    const needsSnapshot = {
      hunger: character.hunger_value ?? 70,
      energy: character.energy_value ?? 75,
      social: character.social_value ?? 65,
      health: character.health_value ?? 80,
      mental: character.mental_value ?? 70,
      financial_need: character.financial_need_value ?? 60,
      hygiene: character.hygiene_value ?? 75,
      comfort: character.comfort_value ?? 70,
    };

    // ── TIME RECONCILIATION: Check for expired actions ──────────────────────
    // Resolve any actions completed since last narrative
    let reconciliationUpdates = {};
    try {
      const { enforceTimeReconciliation } = await import('https://cdn.jsdelivr.net/gh/base44/app@latest/lib/actionExpirationEngine.js');
      const reconciliation = enforceTimeReconciliation(character, character.updated_date);
      if (reconciliation.expired && Object.keys(reconciliation.updates).length > 0) {
        console.log(`[generateAutomaticNarrative] ✓ Resolved expired action | Updates:`, reconciliation.updates);
        Object.assign(character, reconciliation.updates);
        reconciliationUpdates = reconciliation.updates;
      }
    } catch (recErr) {
      console.log(`[generateAutomaticNarrative] Reconciliation skipped (non-blocking):`, recErr.message);
    }

    // ── CANONICAL CONTEXT: full identity from shared truth service ───────────
    // Replaces inline personality/soap opera/memory building.
    // Failure here is non-blocking — we still generate with minimal inline context,
    // but we log visibly so it's diagnosable.
    let canonicalSystemPrompt = null;
    let canonicalHardFacts = '';
    let canonicalLoaded = false;
    let canonicalFallbackUsed = false;

    try {
      const ctxRes = await base44.asServiceRole.functions.invoke('buildCanonicalCharacterContext', {
        characterId,
        interactionContext: 'automatic_narrative',
        topKMemories: 6,
      });
      const ctxData = ctxRes?.data || ctxRes;
      if (ctxData?.systemPrompt && ctxData?.character) {
        canonicalSystemPrompt = ctxData.systemPrompt;
        canonicalHardFacts = ctxData.hardFacts || '';
        canonicalLoaded = true;
      } else {
        canonicalFallbackUsed = true;
        console.warn(`[generateAutomaticNarrative] Canonical context returned no systemPrompt for ${character.name} (${characterId}) — falling back to minimal inline context`);
      }
    } catch (ctxErr) {
      canonicalFallbackUsed = true;
      console.warn(`[generateAutomaticNarrative] Canonical context unavailable for ${character.name} (${characterId}): ${ctxErr.message} — falling back to minimal inline context`);
    }

    // Fallback: minimal inline identity — only if canonical service fails
    if (!canonicalLoaded) {
      canonicalSystemPrompt = `You are ${character.name}. ${character.personality_summary || 'A real person with their own life and personality.'}\nEmotional state: ${character.emotional_state || 'calm'}.`;
    }

    // ── FULL DIAGNOSTIC LOG ───────────────────────────────────────────────────
    console.log(
      `[generateAutomaticNarrative] route=automatic_narrative` +
      ` | character=${character.name} (${characterId})` +
      ` | owner=${ownerEmail}` +
      ` | canonical_loaded=${canonicalLoaded}` +
      ` | hard_facts_loaded=${canonicalHardFacts.length > 0}` +
      ` | fallback_used=${canonicalFallbackUsed}` +
      ` | trigger=${trigger}`
    );

    // ── BUILD STATE-ACCURATE PROMPT ───────────────────────────────────────
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const dayName = nowET.toLocaleDateString('en-US', { weekday: 'long' });

    // Derive the dominant constraint
    let situationBlock = '';
    if (isAsleep) {
      situationBlock = `SITUATION: ${character.name} is ASLEEP right now.
- Do NOT depict them awake, moving, speaking, or doing anything active.
- Narrative must reflect sleep: physical rest, breathing, stillness, possible dreams, subconscious.
- Location: ${resolvedLocationName}${resolvedZoneName ? ` — ${resolvedZoneName}` : ''}`;
    } else if (isTraveling) {
      situationBlock = `SITUATION: ${character.name} is TRAVELING right now.
- They are in transit${travelDestination ? ` to ${travelDestination}` : ''}.
- Narrative must reflect movement, transition, anticipation, or the journey.
- Do NOT depict them already arrived or stationary at a destination.`;
    } else if (isAtWork) {
      situationBlock = `SITUATION: ${character.name} is AT WORK right now.
- Location: ${resolvedLocationName}${resolvedZoneName ? ` — ${resolvedZoneName}` : ''}
- Occupation: ${character.occupation || 'their job'}
- Narrative must reflect work tasks, work environment, coworkers, or professional mindset.
- Do NOT depict them at home, relaxing, or away from work.`;
    } else {
      situationBlock = `SITUATION: ${character.name} is AWAKE and ${presenceStatus === 'home' ? 'at home' : `at ${resolvedLocationName}`}.
- Location: ${resolvedLocationName}${resolvedZoneName ? ` — ${resolvedZoneName}` : ''}
- Category: ${locationCategory}
${locationDescription ? `- Environment: ${locationDescription}` : ''}
- Narrative must reflect what they'd realistically be doing here at this time.`;
    }

    // Needs color — thresholds match stable baselines (75), not critical-only.
    // A character whose hunger is below 75 (the stable baseline) is hungry and
    // should eat. A character whose hygiene is below 75 should freshen up.
    // The LLM needs this signal at the stable threshold, not just at crisis,
    // so autonomous narratives document eating and hygiene at normal hunger
    // levels (e.g. hunger 70) — not only when needs are critically low.
    const needsHints = [];
    if (needsSnapshot.hunger < 75) needsHints.push(needsSnapshot.hunger < 40 ? 'they are very hungry and need to eat right now' : 'they are hungry and want to eat something');
    if (needsSnapshot.energy < 35) needsHints.push('they feel exhausted');
    if (needsSnapshot.social < 30) needsHints.push('they feel isolated or lonely');
    if (needsSnapshot.hygiene < 75) needsHints.push(needsSnapshot.hygiene < 40 ? 'they really need to clean up' : 'they want to freshen up');
    if (needsSnapshot.mental < 30) needsHints.push('they are mentally stressed or overwhelmed');
    const needsLine = needsHints.length > 0
      ? `\nCURRENT PHYSICAL/EMOTIONAL STATE: ${needsHints.join(', ')}.`
      : '';

    // Resolve pronouns from character profile — never infer from name or appearance
    const charGender = character.gender || '';
    const charPronouns = charGender === 'male' ? 'he/him' : charGender === 'female' ? 'she/her' : 'they/them';
    const subjectPronoun = charGender === 'male' ? 'he' : charGender === 'female' ? 'she' : 'they';
    const objectPronoun = charGender === 'male' ? 'him' : charGender === 'female' ? 'her' : 'them';
    const possessivePronoun = charGender === 'male' ? 'his' : charGender === 'female' ? 'her' : 'their';

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
    const _seasonalKeysAuto = (() => {
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
    const _householdKeysAuto = [...Object.keys(HOUSEHOLD_ACTIVITY_EXAMPLES)].sort(() => Math.random() - 0.5).slice(0, 3);
    const _householdExAuto = _householdKeysAuto.flatMap(k => (HOUSEHOLD_ACTIVITY_EXAMPLES[k] || []).slice(0, 1)).slice(0, 3);
    const _seasonalExAuto = _seasonalKeysAuto.flatMap(k => (SEASONAL_ACTIVITY_EXAMPLES[k] || []).slice(0, 1)).slice(0, 2);
    const _combinedAuto = [..._householdExAuto, ..._seasonalExAuto];
    const householdActivityBlock = _combinedAuto.length > 0
      ? `\n\nHOUSEHOLD & SEASONAL ACTIVITY INSPIRATION (use as inspiration — generate a NEW variation, never copy verbatim):\n${_combinedAuto.map(e => `  • ${e}`).join('\n')}\n\nCLOTHING-AWARE NOTE: For wardrobe activities, if Outfit Rotation is enabled and today's outfit is available, use the current scheduled outfit. If Character Closet data exists, use the appropriate clothing from the closet. If neither is available, keep the narrative general — do NOT invent clothing items or wardrobe details.\nMUSIC PREFERENCE NOTE: When authoritative music preference data exists, naturally incorporate favorite artists, genres, styles, or playlists into music narratives. If none exists, keep music narratives general.`
      : '';

    const narrativePrompt = `${canonicalSystemPrompt}

════════════════════════════════════
AUTOMATIC NARRATIVE TASK — PRESENT MOMENT
════════════════════════════════════
Generate a vivid, present-moment narrative (2-4 sentences) describing exactly what ${character.name} is experiencing RIGHT NOW.

TIME: ${timeStr} on ${dayName} (${timeOfDay.replace(/_/g, ' ')})

${situationBlock}
${needsLine}${householdActivityBlock}

IDENTITY AND PRONOUN LOCK — ABSOLUTE:
Gender: ${charGender || 'unknown — use they/them'}
Pronouns: ${charPronouns} | Subject: ${subjectPronoun} | Object: ${objectPronoun} | Possessive: ${possessivePronoun}
• Use ONLY the pronouns above — no switching mid-narrative
• No heteronormative defaults — do NOT assume opposite-gender attraction
• No pronoun inference from name or appearance

════════════════════════════════════
SCENE DESCRIPTION AND SEMANTIC INTERPRETATION — MANDATORY
════════════════════════════════════

The objective is to faithfully represent the character's lived experience using accurate, context-grounded language.

Generated narrative text may become memory, journal history, emotional context, activity context, image-prompt context, or future character grounding. Therefore, descriptions must accurately reflect what is actually happening rather than imposing a fixed emotional framing on environmental state.

1. NEUTRAL DESCRIPTOR PRINCIPLE
Complex, dense, busy, crowded, high-energy, or multi-person environments are NOT inherently negative.

These words are neutral descriptors of environmental state. They describe what is happening. They do not prescribe emotional meaning.

Interpret each scene according to the actual evidence:
- character state
- traits
- relationships
- current circumstances
- event facts
- outcome

A busy Saturday night crowd may be vibrant, exciting, lucrative, stressful, overwhelming, or joyful — depending on what is actually happening and who the character is.
A disorderly moment may be playful, dangerous, creative, disorganized, stressful, or joyful — depending on context.
A complex situation may be enriching, challenging, confusing, layered, or growth-producing — depending on the character and events.

2. ACCURATE VOCABULARY
Choose words because they accurately describe reality — not because particular words are discouraged.

The model is free to describe environments as:
- orderly, busy, quiet, vibrant, crowded, complex, peaceful, stressful, joyful, dangerous, playful
- or any other accurate descriptor when supported by the scene.

Do not avoid a word because it sounds intense. Do not prefer a word because it sounds soft.
Use the word that fits.

3. RESTRICTED CRUTCH
"Heavy" is restricted as emotional shorthand.

Do not use "heavy" to vaguely mean important, emotional, stressful, meaningful, complicated, sad, or serious.

Literal physical use is allowed only when it means actual weight or mass.

For emotional or narrative significance, describe the specific reality instead:
- what made it meaningful
- what made it difficult
- what made it serious
- what made it joyful
- what made it painful
- what made it worth remembering

4. MEANING PRESERVATION
Do not overwrite the accurate meaning of an event with vague negative language.

If an event is joyful, proud, loving, intimate, successful, healing, funny, exciting, or growth-producing, preserve that meaning unless the grounded character context clearly changes it.

If an event is painful, disappointing, frightening, harmful, exhausting, tense, or unresolved, preserve that meaning when the grounded context supports it.

Do not force positivity.
Do not force negativity.
Do not "balance" a positive event by injecting destabilizing language.
Do not let unrelated past negativity bleed into a new positive event unless canonically relevant.

5. IDENTITY PROTECTION
Do not promote situational descriptors into identity labels.

A busy event does not mean the character creates disorder.
A difficult moment does not mean the character is toxic.
A painful experience does not mean the memory is negative.
A mistake does not become a permanent personality trait unless canon and repeated demonstrated behavior support it.

BANNED WORDS — ABSOLUTE:
The words "chaos" and "chaotic" are permanently banned from all narrative text. Never use them in any form — as descriptors, labels, metaphors, or identity claims. Choose a different accurate word instead (e.g., busy, disorderly, disorganized, messy, frenzied, turbulent, unruly, wild).

6. GROUNDED EMOTIONAL COLORING
Emotional tone must emerge from the full grounded context:
- character type
- traits
- quirks
- goals
- motivations
- relationships
- current circumstances
- prior memory
- event facts
- outcome

Narrative must describe what happened and how the character experienced it. It must not prescribe a false emotional meaning through vague labels.

7. REINFORCEMENT FAIRNESS
Characters are designed to learn from repeated narrative and memory context.

Do not over-reinforce negative interpretations by mislabeling positive or meaningful experiences with destabilizing language.

Positive experiences should preserve positive reinforcement.
Negative experiences should preserve negative reinforcement when accurate.
Complex experiences should preserve their actual complexity.

The goal is accurate learning, not forced optimism or forced negativity.
════════════════════════════════════

════════════════════════════════════
NARRATIVE REALITY GROUNDING — ABSOLUTE ENFORCEMENT
This rule overrides all other narrative instincts, world knowledge, and associations.
════════════════════════════════════
THE AUTHORITATIVE WORLD STATE IS THE ONLY SOURCE OF TRUTH.
Every descriptive detail in this narrative must be directly supported by the data above.

WHAT IS PERMITTED:
• The character's current canonical location (as stated in the SITUATION block above)
• The active environment for that location (as explicitly named above — not inferred)
• The current scene details derived from the location name, category, and description above
• Characters physically present and listed above
• Objects and activities that naturally belong to this specific location type
• Current time-of-day, weather (if stated above), and needs state

WHAT IS FORBIDDEN:
• Importing scenery, objects, equipment, sounds, smells, people, businesses, or activities
  from any other location — even if that location is related to this character
• Placing any person (family member, coworker, friend, contact) into this scene
  unless they are explicitly listed as present above
• Inventing environmental details that are not supported by the location name/category/description above
• Using generic words in the narrative as evidence of a specific named location:
  — "yard" in dialogue or narration does NOT mean VGC Recovery Yard or any named yard
  — "shop" does NOT mean a business location
  — "office" does NOT mean Business Operations or any named office
  — "campus" does NOT mean North Campus Quarters or any named campus
  — "garage" does NOT mean a repair shop
  — "home" / "house" does NOT mean any specific residence unless the location is confirmed above
  — Any generic noun used in narration is ORDINARY LANGUAGE — never a location reference
• Filling in unknown environmental details with typical, familiar, probable, or associated details
  — If the location description above does not specify what is in a room, yard, or area, keep it generic
  — Do NOT add scrap metal, machinery, equipment, industrial elements, or any specific objects
    unless the location description above explicitly includes them
  — Do NOT add businesses, storefronts, or nearby places unless explicitly named in the location above
• Creating a scene that contradicts the authoritative location type:
  — A residential home location must be described as residential, not industrial or commercial
  — A workplace location must be described as that specific workplace, not generalized
  — Do NOT blend two locations together

CHARACTER PRESENCE RULE — ABSOLUTE:
A character (family member, coworker, friend, romantic partner, neighbor, anyone) may only appear in this
narrative if they are physically present at the authoritative location right now.
Relationships alone are NOT evidence of presence. Knowing a person exists is NOT evidence they are here.
The character is alone unless the situation block above confirms otherwise.

UNKNOWN = GENERIC:
If information about the environment, nearby objects, or surroundings is not provided above,
describe that aspect generically or omit it entirely.
A sparse, accurate narrative is always correct.
A rich, invented narrative is always a failure.
════════════════════════════════════

CRITICAL RULES:
1. NEVER contradict the situation block above — it is the ground truth.
2. Write in present tense, third-person using the LOCKED pronouns above.
3. Make it immersive and specific to the confirmed location and time — no invented details.
4. Let the LIFE THREADS above color tone and behavior naturally — not every thread needs to surface, but they should shape the moment.
5. No dialogue. No speculation about the future. Just this exact moment.
6. 2-4 sentences only. No preamble, no labels.
7. Vary sentence structure, tone, and pacing — do not repeat patterns from prior outputs.

RESPOND WITH JSON:
Return a JSON object with:
{
  "narrative_text": "the vivid 2-4 sentence narrative",
  "action_effects": [
    {
      "type": "needs",
      "need": "hunger|energy|hygiene|social|health|mental|comfort|financial_need",
      "change": <number between -50 and +50>,
      "reason": "why this need changed"
    }
  ]
}

NEED VALUE DIRECTION — CRITICAL:
All need values are SATISFACTION meters: 100 = fully satisfied, 0 = completely deprived.
A POSITIVE change means the need is being SATISFIED (value goes UP = better).
A NEGATIVE change means the need is DROPPING (value goes DOWN = worse).
• Eating INCREASES hunger (positive change) — the character is more fed after eating.
• Sleeping INCREASES energy (positive change) — the character is more rested.
• Showering/washing INCREASES hygiene (positive change) — the character is cleaner.
• Socializing INCREASES social (positive change) — the character is more fulfilled.
Do NOT return a negative hunger change for eating. Eating always makes hunger go UP.

Only include action_effects if the narrative describes concrete actions (eating, sleeping, showering, socializing, etc.).
If no actions occur, return empty action_effects array.`;

    const narrativeRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: narrativePrompt,
      model: 'gemini_3_flash',
      response_json_schema: {
        type: 'object',
        properties: {
          narrative_text: { type: 'string' },
          action_effects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['needs', 'presence'] },
                need: { type: 'string' },
                change: { type: 'number' },
                reason: { type: 'string' },
                location_id: { type: 'string' },
                location_name: { type: 'string' },
              },
              required: ['type', 'reason'],
            },
          },
        },
        required: ['narrative_text', 'action_effects'],
      },
    });

    let narrativeText = narrativeRes?.narrative_text?.trim() ||
      `${character.name} is ${isAsleep ? 'asleep' : `at ${resolvedLocationName}`} during the ${timeOfDay.replace(/_/g, ' ')}.`;
    // Whitespace normalization only — no lexical replacement.
    narrativeText = narrativeText
      .replace(/\s{2,}/g, ' ')
      .trim();
    
    const actionEffects = narrativeRes?.action_effects || [];

    const memorySummary = `[Right Now] ${timeStr} ${dayName}: ${isAsleep ? 'asleep' : `at ${resolvedLocationName}`} — ${narrativeText.substring(0, 80)}...`;

    // ── APPLY ACTION EFFECTS TO CHARACTER ──────────────────────────────────
    let characterUpdatePayload = {};
    const updatedNeeds = { ...needsSnapshot };

    // ── EATING ROUTING: Reconnect documented eating to recordEatingEvent ──
    // When the LLM action_effects include a positive hunger change, the narrative
    // documents an eating occurrence. Route to the existing recordEatingEvent handler
    // (the canonical hunger writer) instead of directly mutating hunger_value.
    // recordEatingEvent owns the authoritative HUNGER_RECOVERY table (snack=+20,
    // meal=+40, large_meal=+60) and also updates energy/comfort. The LLM-invented
    // change magnitude maps to meal size so the existing handler applies its
    // established recovery values. Eating effects are removed from actionEffects
    // so the direct mutation loop below does not double-apply.
    let _eatingOccurred = false;
    let _eatingMealSize = null;
    if (actionEffects && actionEffects.length > 0) {
      const _eatingEffect = actionEffects.find(e => e.type === 'needs' && e.need === 'hunger' && e.change > 0);
      if (_eatingEffect) {
        _eatingMealSize = _eatingEffect.change >= 50 ? 'large_meal' : _eatingEffect.change >= 25 ? 'meal' : 'snack';
        try {
          const _eatRes = await base44.asServiceRole.functions.invoke('recordEatingEvent', {
            characterId,
            mealSize: _eatingMealSize,
            foodDescription: narrativeText.substring(0, 80),
            locationName: resolvedLocationName,
          });
          const _eatData = _eatRes?.data || _eatRes;
          if (_eatData?.success !== false && !_eatData?.skipped) {
            _eatingOccurred = true;
            // recordEatingEvent updated hunger/energy/comfort — remove those effects
            // from actionEffects so the direct mutation loop does not double-apply.
            for (let i = actionEffects.length - 1; i >= 0; i--) {
              const e = actionEffects[i];
              if (e.type === 'needs' && ['hunger', 'energy', 'comfort'].includes(e.need) && e.change > 0) {
                actionEffects.splice(i, 1);
              }
            }
            if (_eatData?.hungerAfter !== undefined) updatedNeeds.hunger = _eatData.hungerAfter;
            if (_eatData?.energyAfter !== undefined) updatedNeeds.energy = _eatData.energyAfter;
            if (_eatData?.comfortAfter !== undefined) updatedNeeds.comfort = _eatData.comfortAfter;
            console.log(`[generateAutomaticNarrative] EATING routed to recordEatingEvent | size=${_eatingMealSize} | hunger: ${_eatData?.hungerBefore ?? '?'} → ${_eatData?.hungerAfter ?? '?'}`);
          } else {
            console.warn(`[generateAutomaticNarrative] recordEatingEvent skipped: ${_eatData?.reason || 'unknown'}`);
          }
        } catch (_eatErr) {
          console.warn(`[generateAutomaticNarrative] recordEatingEvent invoke failed (non-blocking, will not double-apply hunger): ${_eatErr.message}`);
          // If invoke fails, still remove the hunger effect so the LLM-invented value
          // is NOT applied directly — the existing recordEatingEvent authority owns
          // hunger. The eating occurrence is documented but its consequence will be
          // applied by the next pulse or scene call to recordEatingEvent.
          for (let i = actionEffects.length - 1; i >= 0; i--) {
            const e = actionEffects[i];
            if (e.type === 'needs' && e.need === 'hunger' && e.change > 0) {
              actionEffects.splice(i, 1);
            }
          }
        }
      }
    }

    // ── HYGIENE OCCURRENCE FLAG (for Recent Activity) ──
    // The existing hygiene recovery block below detects hygiene actions from
    // narrative text. This flag records whether a hygiene occurrence was detected
    // so a LifeEvent (Recent Activity) can be created for it after the character
    // update. Set inside the existing block — no duplicate detection logic here.
    let _hygieneOccurred = false;
    let _hygieneActionLabel = null;

    if (actionEffects && actionEffects.length > 0) {
      console.log(`[generateAutomaticNarrative] Applying ${actionEffects.length} action effects...`);
      
      // ── ENERGY SIGN GUARD ───────────────────────────────────────────────
      // Energy may ONLY increase in approved recovery states (sleeping,
      // napping, passed_out, hospitalized). Awake/work/school states must
      // NEVER gain energy from narrative action_effects — that would
      // overwrite the authoritative decay applied by simulateActiveCharacterNeeds.
      // This guard does NOT affect negative energy changes (decay reinforcement).
      // Coffee is a separate explicit mechanic, not an LLM action_effect.
      const ENERGY_RECOVERY_PRESENCES = new Set(['sleeping', 'napping', 'passed_out', 'hospitalized']);
      const _narrativePresence = character.resolved_presence_status || '';

      for (const effect of actionEffects) {
        if (effect.type === 'needs' && effect.need) {
          if (effect.need === 'energy' && effect.change > 0 && !ENERGY_RECOVERY_PRESENCES.has(_narrativePresence)) {
            console.warn(`[generateAutomaticNarrative] BLOCKED +energy effect (${effect.change}) for ${character.name} in presence=${_narrativePresence} — awake/work states cannot gain energy from narrative action_effects`);
            continue;
          }
          const needFieldMap = {
            'hunger': 'hunger_value',
            'energy': 'energy_value',
            'social': 'social_value',
            'health': 'health_value',
            'mental': 'mental_value',
            'financial_need': 'financial_need_value',
            'hygiene': 'hygiene_value',
            'comfort': 'comfort_value',
          };
          
          const fieldName = needFieldMap[effect.need];
          if (fieldName && character[fieldName] !== undefined) {
            const oldValue = updatedNeeds[effect.need] ?? character[fieldName] ?? 0;
            const newValue = Math.max(0, Math.min(100, oldValue + effect.change));
            updatedNeeds[effect.need] = newValue;
            characterUpdatePayload[fieldName] = newValue;
            console.log(`  [${effect.need}] ${oldValue} → ${newValue} (${effect.change > 0 ? '+' : ''}${effect.change}) — ${effect.reason}`);
          } else {
            console.warn(`[generateAutomaticNarrative] Unknown need field: ${effect.need}`);
          }
        }
      }

      // ── HYGIENE ACTION GUARANTEE ──────────────────────────────────────────
      // A narrative that establishes that the CHARACTER PERFORMED a recognized
      // hygiene action (shower, bath, washing face/hair/hands, brushing teeth,
      // grooming) must recover the authoritative hygiene_value. Recovery happens
      // because the action occurred; it is not gated on the current hygiene value.
      // Reuses the existing autonomous-activity recovery amounts (+20 wash / +10
      // groom). The existing 75 is the established fallback/baseline already used by
      // the hygiene system; no separate cutoff is introduced here.
      // The match requires a performance verb form (showers/showered/showering,
      // takes/took/taking a shower, bathed/bathing, washes/washed her face, brushes
      // her teeth, grooms, fixes her hair) — bare nouns, planned actions
      // ("wants to take a shower" uses the bare infinitive "take", not matched),
      // observations of another person, environmental cleaning (cleaning the
      // bathroom, washing dishes/car/clothes), and object references are rejected.
      // Live Needs reads this same field, so the bar reflects the recovery.
      // Within-path protection: never apply less than an already-produced hygiene
      // action effect (take the max of the narrative recovery target and any value
      // the LLM action_effects already set).
      {
        const _narrLower = (narrativeText || '').toLowerCase();
        const _envClean = /\b(clean(ing|s|ed)|scrub(bing|s|ed)|mopping|mopped|sweeping|swept|vacuuming|vacuumed|dusting|dusted|wiping|wipes|wiped|polishing|polished)\b[^.!?\n]{0,40}\b(bathroom|toilet|kitchen|floor|counter|sink|tub|mirror|dishes|car|clothes|windows|laundry|house|home|room|tiles|rug|carpet|stove|oven)\b/.test(_narrLower) || /\b(washes|washed|washing|cleans|cleaned|cleaning)\b[^.!?\n]{0,30}\b(dishes|car|clothes|windows|laundry|floors?)\b/.test(_narrLower);
        const _observation = /\b(watches|watched|observes|observed|sees|saw|notices|noticed)\b[^.!?\n]{0,30}\b(showering|bathing|washing|brushing|grooming)\b/.test(_narrLower);
        const _perfWash =
          /\bshowered\b/.test(_narrLower) || /\bshowering\b/.test(_narrLower) ||
          /\b(he|she|they)\b[^.!?\n]{0,30}\bshowers\b/.test(_narrLower) ||
          /\b(bathed|bathing|bathes)\b/.test(_narrLower) ||
          /\b(takes|took|taking)\b[^.!?\n]{0,20}\b(shower|bath)\b/.test(_narrLower) ||
          /\b(washes|washed|washing)\b[^.!?\n]{0,20}\b(her|his|their)\b[^.!?\n]{0,10}\b(face|hair|hands)\b/.test(_narrLower) ||
          /\b(washes up|washed up|freshens up|freshened up|freshening up)\b/.test(_narrLower) ||
          /fresh from (a )?(shower|bath)/.test(_narrLower) ||
          /(stepping|steps|gets) out of (the|a) (shower|bath)/.test(_narrLower) ||
          /out of the (shower|bath)/.test(_narrLower) ||
          /after (her|his|their) (shower|bath)/.test(_narrLower) ||
          /(finishes|finished) (showering|bathing)/.test(_narrLower) ||
          /\bsoaks?\b[^.!?\n]{0,20}\bbath\b/.test(_narrLower);
        const _isWash = _perfWash && !_envClean && !_observation;
        const _isGroom = !_isWash && !_envClean && !_observation && (
          /\b(brushes|brushed|brushing)\b[^.!?\n]{0,20}\b(her|his|their)\b[^.!?\n]{0,10}\b(teeth|hair)\b/.test(_narrLower) ||
          /\b(grooms|groomed|grooming)\b/.test(_narrLower) ||
          /\b(fixes|fixed|fixing)\b[^.!?\n]{0,20}\b(her|his|their)\b[^.!?\n]{0,10}\bhair\b/.test(_narrLower)
        );
        if (_isWash || _isGroom) {
          _hygieneOccurred = true;
          _hygieneActionLabel = _isWash ? 'washing' : 'grooming';
          const _delta = _isWash ? 20 : 10;
          const _target = Math.min(100, Math.round((character.hygiene_value ?? 75) + _delta));
          const _existing = characterUpdatePayload.hygiene_value ?? -Infinity;
          if (_target > _existing) {
            characterUpdatePayload.hygiene_value = _target;
            updatedNeeds.hygiene = _target;
            console.log(`[generateAutomaticNarrative] hygiene recovery applied: ${character.hygiene_value ?? 75} → ${_target} (${_isWash ? 'wash +20' : 'groom +10'}) — narrative established a hygiene action`);
          }
        }
      }

      // Save character updates if any changes were made.
      // ROUTING RULE:
      //   User-triggered: use user-scoped client (satisfies Character RLS via owner_email).
      //   Scheduled (no token): use asServiceRole — no user token available to satisfy RLS,
      //   and asServiceRole is required. The owner_email on the character record was already
      //   verified above, so this is safe.
      if (Object.keys(characterUpdatePayload).length > 0) {
        try {
          if (isUserTriggered) {
            await base44.entities.Character.update(characterId, characterUpdatePayload);
          } else {
            await base44.asServiceRole.entities.Character.update(characterId, characterUpdatePayload);
          }
          console.log(`[generateAutomaticNarrative] ✓ Character needs updated (${isUserTriggered ? 'user-scoped' : 'service-role'}).`);
        } catch (updateErr) {
          console.warn(`[generateAutomaticNarrative] Character needs update skipped (non-blocking):`, updateErr.message);
        }
      }
    }

    // ── RECENT ACTIVITY: Create LifeEvent records for documented activities ──
    // Autonomous narratives document real character behavior. When a supported
    // activity is documented (eating, hygiene), the existing Recent Activity system
    // (LifeEvent entity) must record it — the same way classifyConversationEvent
    // creates LifeEvents for conversation events and simulateActiveCharacterNeeds
    // creates LifeEvents for sleep/wake transitions. Occurrence vs continuation is
    // governed by the existing 30-minute interval check and 60-minute same-instance
    // dedup above — only new occurrences reach this point. No new dedup window is
    // invented. LifeEvent fields mirror the existing classifyConversationEvent
    // pattern exactly; triggered_by 'life_simulation' is the existing enum value
    // for autonomous/simulation-origin events.
    const _nowIso = NOW.toISOString();
    if (_eatingOccurred) {
      try {
        await base44.asServiceRole.entities.LifeEvent.create({
          character_id: characterId,
          character_name: character.name,
          event_type: 'routine_positive_event',
          valence: 'positive',
          severity: 'moderate',
          title: `Had a ${_eatingMealSize === 'snack' ? 'snack' : _eatingMealSize === 'large_meal' ? 'large meal' : 'meal'}`,
          description: `${character.name} had a ${_eatingMealSize === 'snack' ? 'snack' : _eatingMealSize === 'large_meal' ? 'large meal' : 'meal'}${resolvedLocationName ? ` at ${resolvedLocationName}` : ''}.`,
          emotional_impact: 'satisfied',
          triggered_by: 'life_simulation',
          context_tags: ['eating_event', _eatingMealSize, 'autonomous_narrative'],
          systems_updated: ['hunger'],
          timestamp: _nowIso,
        });
        console.log(`[generateAutomaticNarrative] Recent Activity (LifeEvent) created: eating_event (${_eatingMealSize})`);
      } catch (_leErr) {
        console.warn(`[generateAutomaticNarrative] Eating LifeEvent create failed (non-blocking): ${_leErr.message}`);
      }
    }
    if (_hygieneOccurred) {
      try {
        await base44.asServiceRole.entities.LifeEvent.create({
          character_id: characterId,
          character_name: character.name,
          event_type: 'routine_positive_event',
          valence: 'positive',
          severity: 'minor',
          title: `${_hygieneActionLabel === 'washing' ? 'Freshened up' : 'Groomed'}`,
          description: `${character.name} ${_hygieneActionLabel === 'washing' ? 'washed up and freshened' : 'groomed'}${resolvedLocationName ? ` at ${resolvedLocationName}` : ''}.`,
          emotional_impact: 'refreshed',
          triggered_by: 'life_simulation',
          context_tags: ['hygiene', _hygieneActionLabel, 'autonomous_narrative'],
          systems_updated: ['hygiene'],
          timestamp: _nowIso,
        });
        console.log(`[generateAutomaticNarrative] Recent Activity (LifeEvent) created: hygiene (${_hygieneActionLabel})`);
      } catch (_leErr) {
        console.warn(`[generateAutomaticNarrative] Hygiene LifeEvent create failed (non-blocking): ${_leErr.message}`);
      }
    }

    // Persist reconciliation updates if any — same routing rule as above.
    if (Object.keys(reconciliationUpdates).length > 0) {
      try {
        if (isUserTriggered) {
          await base44.entities.Character.update(characterId, reconciliationUpdates);
        } else {
          await base44.asServiceRole.entities.Character.update(characterId, reconciliationUpdates);
        }
        console.log(`[generateAutomaticNarrative] ✓ Persisted reconciliation updates.`);
      } catch (updateErr) {
        console.warn(`[generateAutomaticNarrative] Failed to persist reconciliation:`, updateErr.message);
      }
    }

    // ── SAVE TO CharacterAutomaticNarrative (same table as automatic system) ──
    const narrative = await base44.asServiceRole.entities.CharacterAutomaticNarrative.create({
      character_id: characterId,
      character_name: character.name,
      owner_user_id: ownerUser,
      owner_email: ownerEmail,
      event_type: 'passive_time',
      narrative_text: narrativeText,
      memory_summary: memorySummary,
      timestamp: NOW.toISOString(),
      local_time: timeStr,
      time_of_day: timeOfDay,
      location_id: locationId,
      location_name: resolvedLocationName,
      zone_name: resolvedZoneName,
      sleep_state: isAsleep ? 'asleep' : 'awake',
      travel_state: isTraveling ? 'traveling' : 'at_location',
      work_state: workState,
      needs_snapshot: updatedNeeds,
      emotional_state: character.emotional_state || 'calm',
      triggered_by: isManual ? 'manual' : 'scheduled',
      visibility: isManual ? 'visible_in_chat' : 'visible_in_chat',
    });

    console.log(`[generateAutomaticNarrative] ✓ Saved for ${character.name}: ${narrative.id} | trigger=${trigger}`);

    // Save to Memory so character remembers it. Failure is reported explicitly —
    // never silently swallowed — but does not invalidate the already-saved narrative.
    let memoryWriteFailed = null;
    try {
      await base44.asServiceRole.entities.Memory.create({
        character_id: characterId,
        title: `[Right Now] ${timeStr} ${dayName}`,
        description: narrativeText,
        memory_type: 'event',
        importance_score: 3,
        confidence_score: 0.9,
        permanence: 'long_term',
        timestamp: NOW.toISOString(),
      });
    } catch (memErr) {
      memoryWriteFailed = memErr.message;
      console.error(`[generateAutomaticNarrative] Memory save FAILED (reported, non-reverting):`, memErr.message);
    }

    return Response.json({
      success: true,
      narrativeId: narrative.id,
      characterName: character.name,
      narrativeText,
      memorySummary,
      timestamp: NOW.toISOString(),
      memory_write_failed: memoryWriteFailed,
    });

  } catch (error) {
    console.error('[generateAutomaticNarrative] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});