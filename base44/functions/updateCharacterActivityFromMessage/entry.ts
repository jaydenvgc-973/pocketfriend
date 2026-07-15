import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, messageContent } = await req.json();
    if (!characterId || !messageContent) {
      return Response.json({ error: 'Missing characterId or messageContent' }, { status: 400 });
    }

    const character = await base44.entities.Character.filter({ id: characterId }).then(r => r[0]);
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // ── SLEEP AUTHORITY GUARD ──────────────────────────────────────────────
    // Canonical rule (sleepUtils.js): "Sleep and naps are the SUSPENSION of
    // activities. When a character enters a sleep or nap state, character-driven
    // activities STOP." Chat dialogue is not a valid source of current_activity
    // for a sleeping character. Activities resume after waking naturally.
    const SLEEP_STATES = new Set(['sleeping', 'napping', 'passed_out']);
    if (SLEEP_STATES.has(character.resolved_presence_status)) {
      return Response.json({
        success: false,
        blocked: true,
        reason: 'sleep_authority_guard',
        characterId,
        presence_status: character.resolved_presence_status,
        message: `${character.name} is ${character.resolved_presence_status} — chat activity update blocked. Activities are suspended during sleep.`,
      });
    }

    const text = messageContent.toLowerCase().trim();

    // ── HYGIENE RECOVERY (existing completion flow) ──────────────────────────
    // A character message that establishes a COMPLETED personal-hygiene action
    // (shower, bath, washing face/hair/hands, brushing teeth/hair, grooming) must
    // recover the authoritative hygiene_value during this existing chat completion
    // flow. This reuses the established detection rules and the 75 baseline floor
    // already used by the narrative hygiene recovery path — it is not a separate
    // hygiene authority; it writes the same authoritative Character.hygiene_value.
    // Environmental cleaning (cleaning the bathroom, washing dishes/car/clothes),
    // observations of another person, and bare-noun/plan references are rejected.
    // Runs BEFORE the tense guard so a completed action stated in past/perfect
    // tense ("I just got out of the shower", "I showered") still recovers hygiene,
    // even though past tense is not a valid current_activity source.
    {
      const _narrLower = text;
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
      const _isGroom = !_perfWash && !_envClean && !_observation && (
        /\b(brushes|brushed|brushing)\b[^.!?\n]{0,20}\b(her|his|their)\b[^.!?\n]{0,10}\b(teeth|hair)\b/.test(_narrLower) ||
        /\b(grooms|groomed|grooming)\b/.test(_narrLower) ||
        /\b(fixes|fixed|fixing)\b[^.!?\n]{0,20}\b(her|his|their)\b[^.!?\n]{0,10}\bhair\b/.test(_narrLower)
      );
      const _isWash = _perfWash && !_envClean && !_observation;
      if (_isWash || _isGroom) {
        const _base = character.hygiene_value ?? 75;
        const _delta = _isWash ? 20 : 10;
        const _target = _isWash
          ? Math.min(100, Math.max(Math.round(_base + _delta), 75))
          : Math.min(100, Math.round(_base + _delta));
        if (_target !== _base) {
          try {
            await base44.entities.Character.update(characterId, { hygiene_value: _target });
            console.log(`[updateCharacterActivityFromMessage] hygiene recovery: ${character.name} ${_base} → ${_target} (${_isWash ? 'wash +20 (floor 75)' : 'groom +10'}) — chat reply established a hygiene action`);
          } catch (e) { /* non-fatal — activity update still proceeds */ }
        }
      }
    }


    // ── SLEEP/FATIGUE DIALOGUE GUARD — PERMANENT RULE ────────────────────────────
    // Dialogue expressing tiredness, fatigue, sleep intent, or sleep planning is
    // NEVER a valid source for current_activity. These are feeling-state expressions,
    // not system-state transitions. Writing them as current_activity creates a
    // feedback loop where LLM emotional dialogue becomes authoritative system state.
    //
    // RULE: Feeling tired ≠ being asleep. Sleep state is set exclusively by the
    // authoritative sleep resolver (simulateActiveCharacterNeeds / enforceSlowdownSleep).
    // Dialogue cannot set or influence sleep state under any circumstances.
    const SLEEP_FATIGUE_PATTERNS = [
      /\bi'?m?\s*(so\s+)?(tired|exhausted|sleepy|fatigued|drained|wiped out|worn out|dead tired|running on (empty|fumes))\b/i,
      /\bi\s*(need|could use|want|gotta get)\s+(some\s+)?(sleep|rest|a nap|to sleep|to rest|to lie down|to go to bed)\b/i,
      /\bi\s*(should|need to|have to|gotta|am going to|'m going to|'m about to)\s+(go to\s+)?(sleep|bed|lie down|rest|nap|crash)\b/i,
      /\bi\s*(didn'?t|haven'?t)\s+(sleep|slept|been sleeping|been resting)\s*(well|much|enough|at all)?\b/i,
      /\b(going to bed|heading to bed|about to sleep|about to crash|calling it a night|need sleep|need rest)\b/i,
      /\b(so sleepy|so exhausted|so tired|really tired|really exhausted|barely awake|can'?t keep .{0,10} eyes open)\b/i,
    ];

    if (SLEEP_FATIGUE_PATTERNS.some(p => p.test(text))) {
      return Response.json({
        success: false,
        characterId,
        blocked: true,
        reason: 'sleep_fatigue_dialogue_guard',
        message: 'Fatigue/sleep dialogue is a feeling state, not a system activity. Blocked to prevent sleep-state authority drift.',
      });
    }

    // MASTER REASONING RULE: Read for context, not keywords
    // Determine tense FIRST: Is this present, past, future, or hypothetical?
    
    const isPastTense = /^(i was|i went|i had been|just|earlier|before|yesterday|last|ago)\b/.test(text);
    const isFutureTense = /\b(will|going to|later|tomorrow|next|planning|supposed to|have to)\b/.test(text);
    const isHypothetical = /\b(would|could|might|usually|normally|sometimes|if i)\b/.test(text);

    // RULE: Only extract PRESENT tense statements
    // Past, future, or hypothetical are memories/plans, not current activity
    if (isPastTense || isFutureTense || isHypothetical) {
      return Response.json({
        success: false,
        characterId,
        message: 'This is not a present statement. It should be stored as memory, not activity.',
        tense: isPastTense ? 'past' : isFutureTense ? 'future' : 'hypothetical',
      });
    }

    // Now extract PRESENT context by reading full sentence structure
    let extractedActivity = null;

    // Pattern: "I'm [at/in] [place/doing]" — read the full context
    const presentMatch = text.match(/i[\'m]*\s+(.+?)(?:\.|,|!|\?|$)/i);
    if (presentMatch && presentMatch[1]) {
      const contextPhrase = presentMatch[1].trim();
      
      // Validate this is actually a present activity, not a fragment
      if (contextPhrase.length > 2 && contextPhrase.length < 100) {
        // Check if the context makes sense as a current activity
        // Example: "at work reading" or "at home relaxing" or "in class"
        
        // Rule: Don't filter based on keywords. Read what they're actually saying.
        extractedActivity = contextPhrase;
      }
    }

    // Only update if we extracted something meaningful
    if (extractedActivity) {
      await base44.entities.Character.update(characterId, {
        current_activity: extractedActivity,
      });

      return Response.json({
        success: true,
        characterId,
        characterName: character.name,
        extractedActivity,
        message: `Updated ${character.name}'s activity to: "${extractedActivity}"`,
      });
    }

    return Response.json({
      success: false,
      characterId,
      characterName: character.name,
      message: 'No present-tense activity extracted from message. (Check: is this a past statement, future plan, or hypothetical?)',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});