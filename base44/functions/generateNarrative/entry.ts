import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── INLINE TEMPORAL STATE ENGINE (mirrors lib/temporalStateEngine.js) ─────────
// Deno functions cannot import local lib files, so we inline the critical logic.

function getDaypartLabel(hourET) {
  const h = ((hourET % 24) + 24) % 24;
  if (h < 4)  return { id: 'deep_night',    label: 'deep night' };
  if (h < 6)  return { id: 'pre_dawn',      label: 'pre-dawn' };
  if (h < 8)  return { id: 'early_morning', label: 'early morning' };
  if (h < 12) return { id: 'morning',       label: 'morning' };
  if (h < 14) return { id: 'midday',        label: 'midday' };
  if (h < 17) return { id: 'afternoon',     label: 'afternoon' };
  if (h < 20) return { id: 'evening',       label: 'evening' };
  if (h < 22) return { id: 'night',         label: 'night' };
  return { id: 'late_night', label: 'late night' };
}

const DAYPART_ENV = {
  deep_night:    { awake: 'The space is dark and quiet, well past midnight. The world is fully still.',    asleep: 'Deep night. The room is dark and still — the hours between midnight and dawn.' },
  pre_dawn:      { awake: 'Pre-dawn quiet. The sky is still dark but the night is winding toward its end.', asleep: 'Pre-dawn stillness. Still dark, but a different quiet than midnight — the night is almost over.' },
  early_morning: { awake: 'Early morning. The first soft gray-blue light is gathering outside.',            asleep: 'Early morning, though they are still asleep. The curtains are catching the first dim light of dawn.' },
  morning:       { awake: 'Morning. Natural light is filling the space and the day is underway.',           asleep: 'Morning now, though they are still asleep. Daylight is pressing at the curtains.' },
  midday:        { awake: 'Midday. The sun is at its peak.',                                               asleep: 'Well into midday. Bright light through the curtains, the world fully active outside.' },
  afternoon:     { awake: 'Mid-afternoon. Warm light, the day in full stride.',                            asleep: 'Afternoon. Golden light through the window — the day is already half-spent.' },
  evening:       { awake: 'Evening. The light is fading, the day winding down.',                           asleep: 'Early evening. The daylight has gone soft outside, fading toward night.' },
  night:         { awake: 'Night. The day is over, the city in its evening rhythm.',                       asleep: 'Night. The room is dim, the world outside in its nighttime pace.' },
  late_night:    { awake: 'Late night. Quiet streets, the hours running toward midnight.',                 asleep: 'Late night. The room is still and dark — well past midnight, deep into the night hours.' },
};

function buildTemporalBlock(char, lastMsgTimestamp) {
  const nowET    = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hourET   = nowET.getHours();
  const minET    = nowET.getMinutes();
  const timeStr  = `${hourET % 12 || 12}:${String(minET).padStart(2, '0')} ${hourET >= 12 ? 'PM' : 'AM'}`;
  const dayOfWeek = nowET.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr  = nowET.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const dp       = getDaypartLabel(hourET);
  const envCues  = DAYPART_ENV[dp.id] || DAYPART_ENV.deep_night;

  // Sleep state
  const rp = char?.resolved_presence_status;
  let isAsleep = rp === 'sleeping' || rp === 'napping';
  if (!isAsleep && char?.sleep_start_time && char?.wake_up_time) {
    const sH = parseInt(char.sleep_start_time.split(':')[0], 10);
    const wH = parseInt(char.wake_up_time.split(':')[0], 10);
    isAsleep = sH > wH ? (hourET >= sH || hourET < wH) : (hourET >= sH && hourET < wH);
  }
  const envCue = isAsleep ? envCues.asleep : envCues.awake;

  // Elapsed + continuity
  let elapsedLabel = null;
  let continuityMode = 'immediate';
  let dayChanged = false;
  let sleepOccurred = false;

  if (lastMsgTimestamp) {
    const lastMs = new Date(lastMsgTimestamp).getTime();
    const elapsedMs = Date.now() - lastMs;
    const mins = Math.floor(elapsedMs / 60000);
    const hrs  = Math.floor(elapsedMs / 3600000);
    const days = Math.floor(elapsedMs / 86400000);

    if (elapsedMs < 90000)      elapsedLabel = 'just now';
    else if (mins < 60)         elapsedLabel = `${mins} minutes ago`;
    else if (hrs < 24)          elapsedLabel = `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
    else if (days === 1)        elapsedLabel = 'yesterday';
    else                        elapsedLabel = `${days} days ago`;

    const lastET = new Date(new Date(lastMsgTimestamp).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    dayChanged = lastET.getDate() !== nowET.getDate() || lastET.getMonth() !== nowET.getMonth();
    sleepOccurred = elapsedMs > 5 * 3600 * 1000 || (dayChanged && elapsedMs > 2 * 3600 * 1000);

    if (dayChanged && elapsedMs > 86400000 * 1.5) continuityMode = 'long_absence';
    else if (dayChanged)        continuityMode = 'next_day';
    else if (sleepOccurred)     continuityMode = 'resumed_after_sleep';
    else if (elapsedMs < 300000) continuityMode = 'immediate';
    else if (elapsedMs < 3600000) continuityMode = 'recent';
    else if (elapsedMs < 21600000) continuityMode = 'same_day_gap';
    else                        continuityMode = 'resumed_after_gap';
  }

  const continuityDesc = {
    immediate:           'Immediate continuation — last exchange was moments ago.',
    recent:              'Recent exchange — under an hour ago, conversation has natural momentum.',
    same_day_gap:        'A few hours have passed — same day but resumed, not continuous.',
    resumed_after_gap:   'Several hours have passed — interaction is resumed, not continued.',
    resumed_after_sleep: 'Sleep occurred since last interaction — this is a new-day resumption.',
    next_day:            "Next day. Yesterday's conversation is memory, not an ongoing moment.",
    long_absence:        'Multiple days have passed. Prior topics are background only.',
  }[continuityMode] || '';

  const sleepLine = isAsleep
    ? `Sleep state: ASLEEP — but the WORLD CLOCK has NOT FROZEN. The current daypart is "${dp.label.toUpperCase()}". Environmental descriptions MUST match this. Do NOT write generic night language if real time is morning.`
    : `Sleep state: AWAKE`;

  return `
════════════════════════════════════
TEMPORAL STATE — AUTHORITATIVE (recalculated from live clock — cannot be overridden)
════════════════════════════════════
Current time:  ${timeStr}
Current day:   ${dayOfWeek}, ${dateStr}
Daypart:       ${dp.label.toUpperCase()}
${sleepLine}
${elapsedLabel ? `Last interaction: ${elapsedLabel}\n` : ''}Continuity:    ${continuityMode.replace(/_/g, ' ')} — ${continuityDesc}

ENVIRONMENT CUE (match this — do not use stale night/morning language from a prior scene):
"${envCue}"

HARD RULES FOR THIS NARRATIVE:
• 5:00 AM is early morning — NOT midnight. Never write "night sky" language if the clock shows morning.
• If the clock shows morning, use morning atmosphere even if the character is still asleep.
• If hours have elapsed, the prior topic is NOT immediate — it is remembered or resumed.
• Day rollover is a real state transition. Do not blend yesterday and today.
• The daypart above is final. Lighting, atmosphere, tone, and character alertness must match it exactly.

⛔ TEMPORAL MISMATCH BLOCKER — ABSOLUTE:
ACTUAL SUNRISE/SUNSET TIMES FOR TODAY (DO NOT IGNORE):
  • Sunrise: ${sunriseTime} (pre-dawn transitions into early morning after this)
  • Sunset: ${sunsetTime} (evening transitions to night after this)

HARD RULES:
  • ONLY use sunrise language between ${sunriseTime} and 30 minutes after (5:45-7:15 AM window)
  • ONLY use sunset language between ${sunsetTime} and 30 minutes after (7:15-8:15 PM window)
  • OUTSIDE these windows: NO sun, NO golden hour, NO warm light, NO dusk/dawn language
  • If current time is 1:21 AM: sky is BLACK. DARK. QUIET. Period.
  • If current time is 10 PM–${sunsetTime}: no sunset language (sunset already happened)

If you generate sun/golden hour/warm light outside the actual sunrise/sunset window, the output is INVALID.
Reject and regenerate if temporal language does not match actual times above.
════════════════════════════════════`;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, chatHistory } = await req.json();

    if (!characterId || !chatHistory) {
      return Response.json({ error: 'characterId and chatHistory are required' }, { status: 400 });
    }

    const character = await base44.entities.Character.filter({ id: characterId });
    if (!character || character.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const char = character[0];
    const characterName = char.name;

    // ── RESOLVE CURRENT LOCATION ──────────────────────────────────────────────
    // Fetch all locations belonging to this user to build a locationMap
    let resolvedLocationName = char.resolved_current_location_name || null;
    let resolvedPresenceStatus = char.resolved_presence_status || null;

    try {
      const allLocations = await base44.asServiceRole.entities.LocationReference.list('-created_date', 300).catch(() => []);
      const locationMap = {};
      for (const loc of allLocations) {
        locationMap[loc.id] = loc;
      }

      // Build resolved location from the character's stored resolved fields
      // (These are kept up-to-date by the location resolution system)
      if (char.resolved_current_location_id && locationMap[char.resolved_current_location_id]) {
        resolvedLocationName = locationMap[char.resolved_current_location_id].name;
      }
    } catch (locErr) {
      console.warn('[generateNarrative] Could not resolve location:', locErr.message);
    }

    // ── UNIFIED TEMPORAL STATE (single source of truth) ──────────────────────
    // Get the last message timestamp for elapsed-time + continuity calculation
    const lastMsg = chatHistory?.length > 0 ? chatHistory[chatHistory.length - 1] : null;
    const lastMsgTimestamp = lastMsg?.timestamp || lastMsg?.created_date || null;
    const temporalBlock = buildTemporalBlock(char, lastMsgTimestamp);

    // Derive isAsleep and time string from the same logic used in buildTemporalBlock
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hourET = nowET.getHours();
    const minET = nowET.getMinutes();
    const timeStr = `${hourET % 12 || 12}:${String(minET).padStart(2, '0')} ${hourET >= 12 ? 'PM' : 'AM'}`;
    const timeOfDayDesc = getDaypartLabel(hourET).label;
    
    // CRITICAL: Determine sleep state — this is absolute
    let isAsleep = false;
    if (resolvedPresenceStatus === 'sleeping' || resolvedPresenceStatus === 'napping') {
      isAsleep = true;
    } else if (char.sleep_start_time && char.wake_up_time) {
      const sH = parseInt(char.sleep_start_time.split(':')[0], 10);
      const wH = parseInt(char.wake_up_time.split(':')[0], 10);
      // Sleep window crosses midnight (e.g., 23:00 - 07:00)
      if (sH > wH) {
        isAsleep = hourET >= sH || hourET < wH;
      } else {
        isAsleep = hourET >= sH && hourET < wH;
      }
    }
    
    // Also check for decided_to_stay_up override
    if (isAsleep && char.decided_to_stay_up_until) {
      const stayUpUntil = new Date(char.decided_to_stay_up_until);
      if (nowET < stayUpUntil) {
        isAsleep = false;
      }
    }

    // ── BUILD LIVE NEEDS STATE BLOCK ──────────────────────────────────────────
    const BANDS = [
      { label: 'critical', min: 0,  max: 19  },
      { label: 'low',      min: 20, max: 39  },
      { label: 'reduced',  min: 40, max: 59  },
      { label: 'stable',   min: 60, max: 79  },
      { label: 'strong',   min: 80, max: 100 },
    ];
    const getBand = (val) => {
      const v = Math.max(0, Math.min(100, val ?? 70));
      return BANDS.find(b => v >= b.min && v <= b.max)?.label ?? 'stable';
    };
    const ns = {
      hunger:    getBand(char.hunger_value),
      energy:    getBand(char.energy_value),
      social:    getBand(char.social_value),
      health:    getBand(char.health_value),
      mental:    getBand(char.mental_value),
      financial: getBand(char.financial_need_value),
      hygiene:   getBand(char.hygiene_value),
      comfort:   getBand(char.comfort_value),
    };
    const nv = {
      hunger:    Math.round(char.hunger_value    ?? 70),
      energy:    Math.round(char.energy_value    ?? 75),
      social:    Math.round(char.social_value    ?? 65),
      health:    Math.round(char.health_value    ?? 80),
      mental:    Math.round(char.mental_value    ?? 70),
      financial: Math.round(char.financial_need_value ?? 60),
      hygiene:   Math.round(char.hygiene_value   ?? 75),
      comfort:   Math.round(char.comfort_value   ?? 70),
    };
    // Build combination notes
    const needsCombos = [];
    if ((ns.energy === 'critical' || ns.energy === 'low') && (ns.social === 'stable' || ns.social === 'strong')) needsCombos.push('Physically low but wants social contact — may seek company briefly or with low effort.');
    if ((ns.energy === 'strong') && (ns.mental === 'low' || ns.mental === 'critical')) needsCombos.push('Physically energized but emotionally strained — may be restless or brittle.');
    if ((ns.comfort === 'critical' || ns.comfort === 'low') && (ns.energy === 'strong')) needsCombos.push('Restless and uncomfortable — wants to move or leave current environment.');
    if ((ns.hygiene === 'low' || ns.hygiene === 'critical') && (ns.social === 'strong')) needsCombos.push('Self-conscious about hygiene despite wanting social contact — may want to freshen up first.');
    if ((ns.mental === 'strong') && (ns.health === 'low' || ns.health === 'critical')) needsCombos.push('Mentally composed but physically unwell.');
    if ((ns.financial === 'low' || ns.financial === 'critical') && (ns.social === 'strong')) needsCombos.push('Wants to socialize but limited by finances — leans toward free or cheap options.');
    const needsComboStr = needsCombos.length > 0 ? `\nCOMBINATION EFFECTS:\n${needsCombos.map(c => `  • ${c}`).join('\n')}` : '';

    const needsBlock = `
════════════════════════════════════
LIVE NEEDS — FULL STATE TRUTH (authoritative — overrides all prior context)
════════════════════════════════════
  Hunger:    ${nv.hunger}/100  → ${ns.hunger.toUpperCase()}
  Energy:    ${nv.energy}/100  → ${ns.energy.toUpperCase()}
  Social:    ${nv.social}/100  → ${ns.social.toUpperCase()}
  Health:    ${nv.health}/100  → ${ns.health.toUpperCase()}
  Mental:    ${nv.mental}/100  → ${ns.mental.toUpperCase()}
  Financial: ${nv.financial}/100 → ${ns.financial.toUpperCase()}
  Hygiene:   ${nv.hygiene}/100 → ${ns.hygiene.toUpperCase()}
  Comfort:   ${nv.comfort}/100 → ${ns.comfort.toUpperCase()}
${needsComboStr}
NARRATIVE MUST REFLECT THESE. Do not describe fatigue if energy is stable. Do not describe hunger if hunger is stable. Do not describe illness if health is strong (unless an injury/illness flag is active). Do not describe financial stress if financial is stable. All physical and emotional descriptions must match the above states.
════════════════════════════════════`;

    // ── BUILD AGE-BASED COMMUNICATION CONSTRAINT ──────────────────────────────
    function resolveCharacterAge(c) {
      if (c.age && typeof c.age === 'number' && c.age > 0) return c.age;
      if (c.age_range) {
        const r = c.age_range.toLowerCase();
        if (r.includes('early 20')) return 21;
        if (r.includes('mid 20'))   return 25;
        if (r.includes('late 20'))  return 28;
        if (r.includes('early 30')) return 31;
        if (r.includes('mid 30'))   return 35;
        if (r.includes('late 30'))  return 38;
        if (r.includes('40')) return 43;
        if (r.includes('50')) return 53;
        if (r.includes('60')) return 63;
        if (r.includes('70')) return 73;
      }
      return null;
    }

    function buildNarrativeAgeBlock(c) {
      const age = resolveCharacterAge(c);
      if (!age || age >= 11) return '';
      if (age <= 3) return `
⛔ AGE ENFORCEMENT — TODDLER (age ${age}):
This is a toddler. All narrative must treat them as such.
They do not speak in full sentences. They react — cry, laugh, point, say one word.
Narrative describing their behavior must match toddler-level cognition and motor skills.`;
      if (age <= 5) return `
⛔ AGE ENFORCEMENT — EARLY CHILDHOOD (age ${age}):
Very simple language only. 4–8 word sentences max. Literal thinking. No complex reasoning.
Narrative must reflect their age-level curiosity and limited vocabulary.`;
      if (age <= 10) return `
⛔ AGE ENFORCEMENT — CHILD (age ${age}):
Full simple sentences allowed. Basic reasoning. School-level vocabulary.
No adult emotional complexity in narrative. Reflect their developmental stage accurately.`;
      return '';
    }
    const narrativeAgeBlock = buildNarrativeAgeBlock(char);

    // ── BUILD STATUS CONTEXT STRING ───────────────────────────────────────────
    const locationContext = resolvedLocationName
      ? `Current location: ${resolvedLocationName}`
      : 'Current location: unknown';

    const sleepContext = isAsleep
      ? `Sleep status: ASLEEP (it is ${timeOfDayDesc} — ${timeStr}, within their sleep window of ${char.sleep_start_time}–${char.wake_up_time})`
      : `Sleep status: AWAKE`;

    const presenceContext = resolvedPresenceStatus
      ? `Presence status: ${resolvedPresenceStatus.replace(/_/g, ' ')}`
      : '';

    const activityContext = char.current_activity
      ? `Current activity: ${char.current_activity}`
      : '';

    // ── RESOLVE USER LABEL (account-scoped — never global list) ──────────────
    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    const settingsList = await base44.entities.UserSettings.filter({ owner_email: user.email }).catch(() => []);
    const settings = settingsList?.[0] || {};
    const worldName = settings?.fictional_world_name || null;
    const userLabel = worldName || 'them';

    // ── GET CACHED WEATHER DATA ───────────────────────────────────────────────
    // Sunrise and sunset times are fetched daily at 4 AM ET and cached in UserSettings
    const cachedWeather = settings?.daily_weather_cache || {};
    const sunriseTime = cachedWeather.sunrise || '06:15'; // fallback time
    const sunsetTime = cachedWeather.sunset || '19:45'; // fallback time
    const weatherConditions = cachedWeather.conditions || 'clear';

    // ── RESOLVE ACTIVE CHARACTER IDENTITY (who is the user acting as?) ──────
    // If the most recent user messages reference a played_as_character_name, use that.
    // Otherwise fall back to world name or pronoun.
    const recentUserMsgs = chatHistory.filter(m => m.sender_type === 'user').slice(-5);
    const playedAsName = recentUserMsgs
      .map(m => m.played_as_character_name)
      .filter(Boolean)
      .pop() || null;
    // The label to use for the user-side actor in this conversation
    const actorLabel = playedAsName || worldName || 'them';

    const formattedChatHistory = chatHistory
      .map(m => {
        if (m.sender_type === 'user') {
          const label = m.played_as_character_name || worldName || 'You';
          return `"${label}": "${m.content}"`;
        }
        return `"${characterName}": "${m.content}"`;
      })
      .join('\n');

    // ── LEXICAL REPETITION GUARD ───────────────────────────────────────────────
    // Extract high-impact descriptive words from recent narrative messages so the
    // LLM is explicitly told NOT to reuse them. This prevents anchor-word looping.
    const STOP_WORDS = new Set([
      'the','a','an','and','or','but','in','on','at','to','of','for','with','is',
      'are','was','were','be','been','being','have','has','had','do','does','did',
      'will','would','could','should','may','might','can','shall','it','its','this',
      'that','these','those','they','them','their','he','she','his','her','his','we',
      'you','your','i','me','my','us','our','not','no','so','if','as','by','from',
      'into','out','up','down','over','under','then','than','when','where','who',
      'which','what','how','there','here','just','like','very','more','some','any',
      'all','one','two','also','even','still','already','again','back','away','now',
      'about','after','before','during','while','through','between','each','own',
    ]);

    // Pull narrative messages from the last 20 chat messages
    const recentNarratives = chatHistory
      .slice(-20)
      .filter(m => m.is_narrative && m.content?.trim())
      .map(m => m.content);

    // Also pull any non-narrative character messages as "stylistic context" to avoid repeating
    const recentCharMsgs = chatHistory
      .slice(-15)
      .filter(m => m.sender_type !== 'user' && !m.is_narrative && m.content?.trim())
      .map(m => m.content);

    // Tokenize and collect distinctive words (length >= 5, not stop words)
    function extractDistinctiveWords(texts) {
      const freq = {};
      for (const text of texts) {
        const words = text.toLowerCase().match(/\b[a-z]{5,}\b/g) || [];
        for (const w of words) {
          if (!STOP_WORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
        }
      }
      // Return words that appear more than once OR are very specific/evocative
      const ALWAYS_VARY = new Set([
        'cocoon','chaos','chaotic','whirlwind','swirl','haze','fog','spiral','drift',
        'linger','settle','unravel','pulse','hum','tension','frenzy','blur','stillness',
        'weight','heaviness','quiet','noise','warmth','coldness','brightness','darkness',
        'scattered','fractured','grounded','hollow','raw','electric','sharp','soft',
        'gentle','harsh','wild','steady','restless','tired','weary','heavy','light',
        'flicker','shadow','glow','echo','silence','rhythm','pattern','texture',
        'anchor','float','sink','rise','fall','crash','settle','lurch','trembling',
        'comfort','discomfort','familiar','strange','ordinary','unusual','mundane',
      ]);
      return Object.entries(freq)
        .filter(([w, c]) => c > 1 || ALWAYS_VARY.has(w))
        .map(([w]) => w)
        .slice(0, 20); // cap at 20 to avoid overwhelming the prompt
    }

    const overusedWords = extractDistinctiveWords([...recentNarratives, ...recentCharMsgs]);

    // ── HOME ACTIVITY REPETITION DETECTOR ─────────────────────────────────────
    // Scan recent narratives for overused home activity anchor phrases
    const HOME_ACTIVITY_ANCHORS = [
      { term: 'coffee', label: 'coffee/making coffee' },
      { term: 'window', label: 'looking out the window' },
      { term: 'stares out', label: 'staring outside' },
      { term: 'gazes out', label: 'gazing outside' },
      { term: 'looks out', label: 'looking outside' },
      { term: 'cup of', label: 'cup of something' },
      { term: 'mug', label: 'mug/cup' },
    ];
    const recentNarrativeText = recentNarratives.join(' ').toLowerCase();
    const overusedHomeActions = HOME_ACTIVITY_ANCHORS
      .filter(({ term }) => {
        const matches = (recentNarrativeText.match(new RegExp(term, 'g')) || []).length;
        return matches >= 2;
      })
      .map(({ label }) => label);

    const homeActivityGuardBlock = overusedHomeActions.length > 0 ? `
════════════════════════════════════
HOME ACTIVITY OVERUSE DETECTED — MANDATORY ROTATION
════════════════════════════════════
The following home activities have appeared too frequently in recent narratives. You MUST NOT use them in this scene:
${overusedHomeActions.map(a => `  ✗ "${a}"`).join('\n')}

Choose a DIFFERENT home activity from the expanded activity pool above.
Repeating a blocked activity is a generation failure — regenerate with an alternative.
════════════════════════════════════` : '';

    const repetitionGuardBlock = overusedWords.length > 0
      ? `
════════════════════════════════════
LEXICAL REPETITION GUARD — MANDATORY
════════════════════════════════════
The following words have appeared in recent outputs. You MUST NOT use them in this narrative.
This is not optional. Using these words is a generation failure.

BANNED WORDS (used too recently — choose alternatives):
${overusedWords.map(w => `  ✗ "${w}"`).join('\n')}

REPLACEMENT RULE:
Do not swap one banned word for its direct synonym if that synonym is equally overused.
Instead, rephrase the entire idea using different framing.

EXAMPLES OF CORRECT AVOIDANCE:
• Instead of "cocoon" → describe the feeling: "the insulated stillness of the room", "a quiet that felt sealed off from outside", "wrapped in something private and dim"
• Instead of "chaos" → describe the behavior: "everything slightly off-balance", "a restless, unresolved energy", "pressure that had no clean outlet"
• Instead of "drift/drifting" → "moved without direction", "let the moment carry her", "found herself elsewhere without deciding to go"
• Instead of "haze" → "a soft blurring at the edges of attention", "the kind of tired that softens everything"
• Instead of "weight" → "something pressing behind the eyes", "a density she couldn't locate or name"

The goal is always semantic meaning expressed through fresh language — not word substitution.
════════════════════════════════════`
      : '';

    const antiRepetitionStyleBlock = `
════════════════════════════════════
LANGUAGE VARIATION RULES — MANDATORY
════════════════════════════════════
CHARACTER DESCRIPTION IS NOT A VOCABULARY LIST.
If the character's description uses a word like "chaotic" — understand the behavior it describes.
Do NOT repeat that word in the narrative. Express the meaning instead.

SELF-DEFINING LANGUAGE IS BANNED.
Bad:  "The room felt like chaos, filled with chaotic energy."
Good: "The room felt unstable — everything slightly misaligned, like something was about to shift."

METAPHORS ARE SINGLE-USE IN THIS SESSION.
If a metaphor or image appears in a recent narrative, do not reuse it.
Find a different angle, different image, different sensory entry point.

SENTENCE STRUCTURE MUST VARY.
Do not repeat the same rhythm: subject + verb + descriptive clause.
Mix short sentences with longer ones. Let some sentences end abruptly. Let others breathe.

DESCRIPTIVE FRAMING MUST SHIFT.
If recent narratives led with sound — try texture, temperature, light, or physical sensation.
If recent narratives opened with internal state — try environmental observation first.
If recent narratives used metaphor — try plain precise language.

The goal: each narrative should feel like it was written by a thoughtful person who chose fresh words,
not by a system reusing its own recent outputs.
════════════════════════════════════`;

    // ── BUILD SCENE REACTION BLOCK (inlined — cannot import local lib) ───────
    const bars = {
      user_respect_level: char.user_respect_level ?? 50,
      trust_level: char.trust_level ?? 50,
      friendship_level: char.friendship_level ?? 75,
      romantic_level: char.romantic_level ?? 0,
      attraction_level: char.attraction_level ?? 0,
      relational_jealousy: char.relational_jealousy ?? 0,
      envy_jealousy: char.envy_jealousy ?? 0,
      chosen_family_level: char.chosen_family_level ?? 0,
    };
    const emotionalState = char.emotional_state || 'calm';

    // Body language
    const bodyLangCues = [];
    if (bars.trust_level >= 70) bodyLangCues.push('posture is open and relaxed — no defensive tension');
    else if (bars.trust_level <= 30) bodyLangCues.push('posture stays guarded — arms close, movements measured, nothing fully released');
    else bodyLangCues.push('posture is neutral — present but not fully open');

    if (bars.romantic_level >= 65 || bars.attraction_level >= 65) {
      bodyLangCues.push('shifts closer without thinking about it — proximity feels natural, not deliberate');
    } else if (bars.romantic_level <= 20 && bars.attraction_level <= 20) {
      bodyLangCues.push('no pull toward closeness — body stays at comfortable, neutral distance');
    }
    if (bars.relational_jealousy >= 65) bodyLangCues.push('eyes track subtle shifts — reactive posture, harder to settle');
    else if (bars.relational_jealousy >= 40) bodyLangCues.push('awareness sharpens — noticing more than they let on');
    if (bars.user_respect_level <= 30) bodyLangCues.push('attention drifts — barely looks up when they speak');
    else if (bars.user_respect_level >= 75) bodyLangCues.push('turns toward them when they speak — body follows attention');
    const emotionBodyMap = {
      anxious: "small movements — tapping, adjusting things nearby — can't fully settle",
      defensive: 'weight shifts back slightly — body language closes',
      irritated: 'jaw tightens almost imperceptibly — stillness with edge in it',
      reflective: 'quieter in the body — slower movements, less reactive',
      'closed-off': 'physically present but the energy has pulled back',
      flirtatious: 'deliberate proximity — eye contact held a beat longer than necessary',
      overwhelmed: 'movements lose their usual precision — something is spilling',
      sad: 'posture carries weight — gravity feels different',
      excited: 'energy is in the body — harder to stay still',
    };
    if (emotionBodyMap[emotionalState]) bodyLangCues.push(emotionBodyMap[emotionalState]);

    // Pacing
    let pacingDirective = 'pacing is natural — no urgency, no excessive hesitation';
    const fastStates = ['irritated', 'excited', 'anxious', 'defensive', 'overwhelmed'];
    const slowStates = ['reflective', 'sad', 'closed-off', 'calm'];
    if (fastStates.includes(emotionalState) || bars.relational_jealousy >= 65) {
      pacingDirective = "responds quickly — thoughts arrive before they're fully formed — urgency underneath even casual exchanges";
    } else if (slowStates.includes(emotionalState) || bars.trust_level <= 30) {
      pacingDirective = 'takes a beat before answering — pauses carry weight — responses arrive fully considered';
    }

    // Silence mode
    let silenceMode = null;
    const highEmotionStates = ['overwhelmed', 'sad', 'grief', 'defensive', 'reflective'];
    if (highEmotionStates.includes(emotionalState)) silenceMode = 'silence is active — lets the moment sit before responding — the gap means something';
    else if (bars.trust_level <= 25) silenceMode = 'chooses words carefully — pauses before answering — not withholding, but not rushing either';
    else if (bars.user_respect_level <= 25) silenceMode = 'no urgency to fill silence — does not feel compelled to respond quickly';
    else if (bars.user_respect_level >= 75) silenceMode = 'gives full space before responding — takes in what was said';
    else if (bars.romantic_level >= 70 && bars.trust_level >= 70) silenceMode = 'comfortable with silence between them — it does not need to be filled';

    // Positioning
    let positioning = 'neutral distance — neither closing nor creating space — just present';
    if ((bars.romantic_level >= 65 || bars.attraction_level >= 65) && bars.trust_level >= 55) {
      positioning = "close proximity — stays within their space — doesn't create distance";
    } else if (bars.trust_level <= 30 || ['defensive', 'closed-off'].includes(emotionalState)) {
      positioning = 'creates space — distance is chosen, not accidental';
    } else if (emotionalState === 'irritated') {
      positioning = "shifts slightly back — body creates the distance that words haven't said yet";
    }

    // Environment
    let envMode = 'present in the environment — neither absorbed by it nor ignoring it';
    if (bars.romantic_level >= 70 && bars.trust_level >= 65) {
      envMode = 'surroundings become secondary — environment fades — the space narrows to this';
    } else if (bars.relational_jealousy >= 60 || ['anxious', 'defensive', 'irritated'].includes(emotionalState)) {
      envMode = 'attention fragments — surroundings pull focus — harder to stay fully in the moment';
    } else if (bars.user_respect_level <= 25 || emotionalState === 'bored') {
      envMode = 'environment becomes background noise — attention is somewhere else entirely';
    } else if (['calm', 'content', 'reflective'].includes(emotionalState) && bars.trust_level >= 55) {
      envMode = 'settles into surroundings naturally — occupies the space without tension';
    }

    const sceneReactionBlock = `
════════════════════════════════════
SCENE REACTION ENGINE — AUTHORITATIVE
All physical behavior in this narrative MUST match the following derived from current relationship state.
════════════════════════════════════
BODY LANGUAGE:
${bodyLangCues.map(c => `  • ${c}`).join('\n')}

PACING: ${pacingDirective}
${silenceMode ? `SILENCE MODE: ${silenceMode}` : ''}
POSITIONING: ${positioning}
ENVIRONMENT: ${envMode}

RULE: Show emotion through physical behavior above. Do NOT state it directly. Do NOT reuse the same gesture twice in one scene.
════════════════════════════════════`;

    // ── BUILD PROMPT WITH GROUNDED CONTEXT ───────────────────────────────────
    const prompt = `You are a narrator for a realistic life simulation. Your output is a single cohesive narrative passage that continues the character's living timeline. It must feel like a live scene — grounded, specific, and earned.

════════════════════════════════════
CHARACTER STATE — ABSOLUTE GROUND TRUTH
These facts are locked and override everything else.
The narrative MUST reflect all of them exactly.
Do NOT contradict or ignore any of these facts.
════════════════════════════════════
Character: ${characterName}
${narrativeAgeBlock ? narrativeAgeBlock + '\n' : ''}${locationContext}
${sleepContext}
${presenceContext ? presenceContext + '\n' : ''}${activityContext ? activityContext + '\n' : ''}Current time: ${timeStr} (${timeOfDayDesc})
════════════════════════════════════
${temporalBlock}

════════════════════════════════════
IDENTITY AND PRONOUN LOCK — HARD RULE
════════════════════════════════════
CHARACTER GENDER: ${char.gender || 'unknown'}
CHARACTER PRONOUNS: ${char.gender === 'male' ? 'he/him' : char.gender === 'female' ? 'she/her' : char.gender === 'non-binary' ? 'they/them' : 'they/them'}

RULES — THESE ARE ABSOLUTE AND NON-NEGOTIABLE:
• Pronouns must match the character profile at all times — no exceptions
• No mid-narrative pronoun switching under any condition
• No pronoun reassignment based on activity, scene type, or interaction partner
• No heteronormative defaults — do NOT assume opposite-gender attraction
• If gender or pronouns are unknown or unlisted: use they/them ONLY
• Pronouns are NEVER inferred from a character's name, appearance, or behavior

FORBIDDEN:
✗ Switching from he to she or vice versa at any point
✗ Assuming a male character is attracted to women (or vice versa)
✗ Overriding profile pronouns with scene context
✗ Defaulting to heterosexual pairing without story basis

LGBTQ INCLUSIVE LOGIC — MANDATORY:
All interactions must support naturally without adjustment or comment:
• male/male attraction and intimacy
• female/female attraction and intimacy
• non-binary identities in any pairing
• mixed gender/identity combinations
Flirtation, comfort, romance, and tension must behave the same regardless of gender combination. Do NOT alter tone, pacing, or framing based on orientation.

════════════════════════════════════
ATTRACTION AND INTERACTION LOGIC
════════════════════════════════════
Attraction is not automatic. It must be evaluated using orientation, the specific person involved, the established relationship, the current emotional state, the environment, and the character's personality. The narrative must allow: curiosity without commitment, attention without attraction, and social interaction without romance. Situational behavior does not redefine identity. Attraction must feel earned and context-driven. Never default to romantic framing unless it is already established in the story state.

════════════════════════════════════
MANDATORY NARRATIVE GENERATION ENGINE — EXECUTE BEFORE WRITING
════════════════════════════════════
THIS IS NOT OPTIONAL. Every narrative must execute all 5 steps in order before a single word is written.

STEP 1 — IDENTIFY THE INTERACTION TYPE:
Classify what is happening in this scene. Choose the primary type:
  • FLIRT — attraction present, tension building, playful or intentional
  • COMFORT — care, support, presence, emotional support
  • REASSURE — anxiety, spiral, grounding, emotional regulation
  • REDIRECT — de-escalation, subject pivot, steering away from overload
  • ENCOURAGE — doubt, hesitation, capability building, belief in them
  • DISTANCE — boundary, emotional withdrawal, space needed
  • REVEAL — vulnerability, honesty, truth drop, relationship shift
  • NEUTRAL — ordinary life moment, no dominant interpersonal dynamic

STEP 2 — SELECT ONE BEHAVIOR PATTERN from the correct library below:
Choose ONE. Vary across outputs — never repeat the same pattern twice in succession.

STEP 3 — APPLY AT LEAST ONE VARIATION HOOK from the correct hook list below.
This is required. Scenes without a variation hook are invalid and must be regenerated.

STEP 4 — APPLY AT LEAST ONE ROOT THEME from the global theme list below.
Embed it naturally — do not state it directly.

STEP 5 — GENERATE THE NARRATIVE.
Only after completing steps 1–4 may the narrative be written.

════════════════════════════════════
INTERACTION LIBRARIES — ALL ARE MANDATORY SOURCE MATERIAL
════════════════════════════════════

── FLIRT PATTERNS (select ONE when type = FLIRT) ──
1. CLOSE WITHOUT TOUCHING — proximity tension, eye contact holds a beat too long, voice softens, space between them becomes intentional
2. PLAYFUL CHALLENGE — teasing with an edge, testing limits gently, competitive undertone that is really something else
3. ACCIDENTAL CONTACT — hands brush, pause, neither pulls away immediately — the moment hangs
4. LOW VOICE MOMENT — drops to a private tone in a public space, focus narrows to just the two of them
5. TESTING THE LINE — says something slightly ambiguous, watches for the reaction, escalates or retreats based on what comes back
6. SHARED RECOGNITION — a look exchanged across the room that feels intentional, a small smile that lingers, both understand without saying it
7. INSIDE LANGUAGE — coded humor, references only the other person fully gets, playful phrasing that feels layered
8. CONFIDENCE SHIFT — unexpected boldness, direct compliment that surprises both of them, posture and eye contact change, tone turns deliberate
9. ENERGY MATCHING — mirroring the other person's rhythm without thinking about it, same pace, same tone shifts, synchronized attention
10. SUBTLE CLAIM — standing slightly closer when others are around, a light touch that lingers just enough, redirecting attention back to each other

FLIRT VARIATION HOOKS — REQUIRED (at least one per flirt scene):
• an interruption that breaks the moment
• a hesitation that changes the direction
• one person more aware than the other — the imbalance matters
• escalation followed by deliberate pullback
• a signal that gets misread
• external pressure landing at the wrong moment
• timing that is emotionally off between them
• the confidence drops right after
• someone outside the dynamic doesn't understand the exchange
• the sync builds into stronger tension before someone breaks it

── COMFORT PATTERNS (select ONE when type = COMFORT) ──
1. QUIET PRESENCE — sits nearby without forcing conversation, lets the silence be enough
2. SOFT REDIRECT — gently shifts focus without dismissing what the other person said
3. PROTECTIVE ENERGY — positions themselves in a way that is aware of the room without making it obvious
4. VALIDATION WITHOUT FIXING — listens first, does not offer solutions, just reflects back that they heard it
5. PHYSICAL REASSURANCE — closeness without pressure, grounding without being asked
6. SEEN WITHOUT EXPLAINING — immediate understanding without questions, no assumptions, space to exist without performing
7. IDENTITY AFFIRMATION — uses the correct name and pronouns naturally, corrects others calmly if needed, reinforces identity without making it a spectacle
8. AFTER A LONG DAY — slower movements, quieter tone, sitting close without needing conversation, mutual understanding of "today was a lot"
9. PROTECTIVE CHECK-IN — "you good?" but with real attention behind it, subtle scanning of the environment, staying close enough to intervene
10. REBUILDING AFTER HURT — letting someone process without rushing them, acknowledging the hurt without minimizing, small grounding actions

COMFORT VARIATION HOOKS — REQUIRED (at least one per comfort scene):
• resistance to being comforted before accepting it
• delayed opening up — they do not give it immediately
• silence maintained longer than expected
• emotional shift mid-scene that changes what is needed
• deflection through humor before the real thing surfaces
• a deeper vulnerability emerges unexpectedly
• the person realizes how rare this kind of understanding feels
• they open up more than they intended
• someone else gets it wrong, deepening the contrast

── REASSURE PATTERNS (select ONE when type = REASSURE) ──
Components: emotional validation ("you're not overreacting"), physical grounding cues (breathing, touch, stillness), reframing fear into something manageable, tone softness and pacing (slower), safety signaling through presence not solutions

── REDIRECT PATTERNS (select ONE when type = REDIRECT) ──
Components: gentle topic pivot (not abrupt), humor or lightness as a transition, introducing a new activity or focus, avoidance without dismissal, emotional de-escalation without calling it out

── ENCOURAGE PATTERNS (select ONE when type = ENCOURAGE) ──
Components: affirmation of capability, referencing past wins or strengths, future-oriented language ("you can", "you will"), small actionable push, energy lift without pressure

── DISTANCE PATTERNS (select ONE when type = DISTANCE) ──
Components: controlled emotional withdrawal, clear but calm boundary setting, reduced physical or verbal closeness, shortened responses or pauses, avoidance of escalation

── REVEAL PATTERNS (select ONE when type = REVEAL) ──
Components: personal truth or hidden feeling, shift in tone (more serious, slower), risk-taking emotionally, context or backstory drop, change in relationship dynamic after

════════════════════════════════════
EXPANDED ACTION COMPONENTS — APPLY TO ALL SCENE TYPES
════════════════════════════════════
Every narrative must include components from at least TWO of these categories:

LET THEM ACT (natural behavior):
  • Environmental interaction — use objects in the scene
  • Micro-behaviors — glances, posture shifts, small physical tells
  • Time progression awareness — they know how long they've been here
  • Reaction to unseen stimuli — background life, sounds, movement
  • Silent actions — not everything needs words

FLIRT (escalation and texture):
  • Eye contact dynamics — held, broken, returned
  • Playful teasing vs sincerity balance — one shifts into the other
  • Escalation ladder — light → bold, never jumping directly to intense
  • Physical proximity shifts — deliberate or unconscious
  • Ambiguity — leave things unsaid, let the reader feel the gap

COMFORT (depth and presence):
  • Physical reassurance — proximity, a hand, grounding contact
  • Tone mirroring — matching the other person's emotional level
  • Protective instinct behavior — body awareness, staying close
  • Repetition of calming energy — not words, but sustained presence
  • Slowing the moment — pace drops, time feels different

CONFRONT (when tension surfaces):
  • Emotional build-up before release — not sudden
  • Specific vs vague — one person has receipts, the other deflects
  • Interruptions and overlapping — who controls the floor
  • Power dynamics — who holds control in this moment
  • Resolution path — explode, simmer, or walk away

SPEND TIME (shared presence):
  • Shared activity — not just talking, doing something together
  • Comfortable silence — no urgency to fill it
  • Background environment influence — the space shapes the moment
  • Time passing naturally — they've been here a while
  • Subtle bonding moments — small things that add up

CHECK IN (emotional temperature):
  • Open-ended — no yes/no questions
  • Emotional temperature reading — they're assessing, not assuming
  • Non-verbal cue detection — watching before asking
  • Follow-up curiosity — not satisfied with the surface answer
  • Light vs deep scaling — knowing when to go further or back off

════════════════════════════════════
GLOBAL ROOT THEMES — EMBED AT LEAST ONE PER NARRATIVE
════════════════════════════════════
These apply to every scene type. Choose one and weave it naturally — never state it directly.

• Unspoken tension — what is not said matters more than what is
• Timing mismatch — one person ready, one not
• Emotional misread — the situation is read incorrectly by someone
• Power imbalance shift — who has control changes mid-scene
• Memory callback — a past moment is influencing this one
• Environment pressure — crowded, quiet, public, private — the space changes behavior
• Internal vs external conflict — they feel one thing, do another
• Expectation vs reality — what they expected and what happened diverge
• Control vs vulnerability — the moment when the controlled person slips
• Attachment vs independence — the pull between closeness and space
• Safety vs expression — when to be open vs when to hold back
• Chosen family energy — not blood, but showing up anyway
• Being understood without explanation — the relief of not having to translate yourself
• Public vs private identity shift — they are different here than they are out there
• Micro-validation — a small moment that lands bigger than it looks
• Guardedness giving way — not gone, just momentarily lowered
• Past experience shaping present reaction — history is in the room

════════════════════════════════════
LGBTQ+ INCLUSIVE GENERATION — MANDATORY, NOT A MODE
════════════════════════════════════
This is not a separate setting. It applies to every narrative regardless of characters involved.

• All patterns above (flirt, comfort, reassure, reveal, etc.) apply identically across all gender and identity combinations
• male/male, female/female, non-binary, mixed identity — all receive the same depth, the same escalation options, the same variation hooks
• Do NOT simplify or flatten interactions based on gender pairing
• Do NOT default to heteronormative structure when gender is ambiguous
• Do NOT alter tone, pacing, or framing based on orientation
• Identity affirmation (correct name/pronouns, calm correction of others) is a valid comfort action available in every scene
• Chosen family, community recognition, guardedness in unfamiliar spaces — these are available root themes, not special cases
• Attraction is never assumed. It must be established. The same standard applies regardless of who the characters are.

════════════════════════════════════
LOCATION AND SCHEDULE ENFORCEMENT
════════════════════════════════════
The current location is a truth source. If the character is at work, the narrative must reflect that work setting. If the character is at the gym, it must reflect the gym. If at a bar, reflect the bar. If at home, reflect the home environment. The system must never generate a narrative from a location the character is not currently in.

If the current time falls inside a scheduled block, that schedule must shape the narrative. A narrative generated during active work hours must reflect mid-shift behavior, not arrival, not waking up, not relaxing at home. If the character has been at work for hours, the narrative must reflect that momentum — not reset the scene.

HOME-STYLE NARRATIVES ARE BLOCKED when the character is scheduled to be at work or is confirmed at a non-home location.

════════════════════════════════════
EMOTIONAL BALANCE — MANDATORY ENFORCEMENT
════════════════════════════════════
Characters are full human beings. They experience struggle AND joy, stress AND relief, sadness AND warmth.

NO MONOTONE EMOTION RULE:
If recent messages from ${characterName} have expressed sadness, frustration, depression, or stress continuously — the narrative MUST introduce emotional variation. Sustained negativity without recovery is a system failure.

POSITIVE STATE GENERATION (required without prompting):
The following states must occur naturally and regularly:
  • moments of enjoyment or small pleasure
  • light humor or playfulness
  • calm and contentment
  • social connection and warmth
  • personal wins (small counts)
  • curiosity, excitement, or anticipation
  • relief after stress resolves
  • pride in something accomplished

RESILIENCE MODEL:
Characters are not defined solely by their hardship. If a character has past trauma or stressors, the narrative must ALSO allow: growth, coping, reflection, earned strength, and emotional recovery. Two characters with similar backgrounds may diverge emotionally — do not force identical outcomes.

RELATIONSHIP BALANCE:
${characterName} must not always center their own problems. They must also:
  • show curiosity about the other person
  • check in on how the other person is doing
  • initiate neutral or positive exchanges
  • engage without emotional burden when appropriate

EMOTIONAL VARIATION BY PERSONALITY:
Apply this character's specific personality traits to determine their emotional range. An optimistic character tilts positive. A grounded character stays stable. A humorous character finds levity. A resilient character recovers. Match the output to WHO this character is, not a generic depressed default.

RECOVERY LOOP — MANDATORY:
If this character is in a negative state, the narrative must allow:
  1. Processing (brief expression — not prolonged wallowing)
  2. Coping behavior (movement, activity, social contact, rest)
  3. Emotional shift (partial or full — even small improvement counts)

FAILURE CONDITION — DO NOT GENERATE:
  ✗ Narrative where character sounds depressed without cause matching their actual need states
  ✗ Constant complaining with no moment of relief or lightness
  ✗ Characters who never grow, adapt, or experience joy
  ✗ Emotionally heavy output every time regardless of context

════════════════════════════════════
EMOTIONAL GATING RULES — GRIEF GATING (MANDATORY)
════════════════════════════════════
GRIEF STATE REQUIRES ALL THREE CONDITIONS:
  1. ${characterName} had a DIRECT relationship with the person who was lost
  2. ${characterName} PERSONALLY experienced or was told about the loss in this story
  3. The loss meaningfully impacts ${characterName}'s own life (shared household, close bond, regular contact)

DO NOT assign grief if:
  • The user mentioned a death but ${characterName} did not know that person
  • The information is secondhand or distant
  • The topic is generally sad but has no personal tie to ${characterName}

CORRECT RESPONSE when user is grieving but ${characterName} is NOT directly affected:
  → ${characterName}'s state = supportive / concerned / empathetic / present
  → NOT grief. NOT personal sadness. NOT needing comfort themselves.
  → ${characterName}'s role is SUPPORT PROVIDER, not co-sufferer.

EMOTIONAL PROXIMITY SCALE (use this to determine response intensity):
  • Direct personal loss → grief is valid
  • Close connection but not in ${characterName}'s immediate life → sadness, heavy-heartedness
  • Indirect awareness / heard through user → concern and empathy only
  • Abstract / distant / topic-only → neutral caring awareness

USER EMOTION MUST NOT AUTO-MIRROR INTO ${characterName}.
Hearing about grief → ${characterName} shows care.
Experiencing grief directly → ${characterName} may feel it personally.
These are two different states. Never conflate them.

A character can remember "that was heavy, I felt it" without REMAINING in a grief state. Memory persists. Active state must be accurate.

════════════════════════════════════
NARRATIVE GENERATION RULES
════════════════════════════════════
All narrative examples in any training context are reference patterns only — not templates. They must never be copied, lightly reworded, or repeated as output. The system must generate new, original text every time.

Before generating, the system must evaluate and satisfy all of the following in order:

1. Current time — what time is it, what does that mean for this character's day
2. Current location — confirmed physical location right now
3. Current schedule — is there an active scheduled block in effect
4. Current activity already in progress — continue it, do not restart it
5. Recent story progression — what just happened, what tension or momentum carries forward
6. Emotional state — what is the character carrying emotionally right now
7. People currently present — who else is in this space
8. Personality style — how does this character naturally move, think, and behave
9. Attraction or social possibility — only if already established and relevant

If a lower-priority layer conflicts with a higher-priority layer, the higher-priority layer wins. Example: if emotional state suggests rest but the schedule confirms active work hours, the narrative must stay work-based. Fatigue may appear inside the work narrative but must not switch the character into a home or idle scene.

════════════════════════════════════
CONTEXT STACK FORMULA
════════════════════════════════════
Current time + current location + active schedule + in-progress activity + immediate past event + emotional state + present company + personality style = narrative output. If any layer is missing or conflicts with a confirmed truth layer, the system must resolve the conflict before generating. Narratives that ignore time, ignore location, reset ongoing scenes, or copy example text must be regenerated.

════════════════════════════════════
TIME SENSITIVITY
════════════════════════════════════
Morning narratives must feel different from afternoon, evening, and late night. Early shift behavior must feel different from mid-shift. Late shift may include fatigue, impatience, or routine efficiency. Weekend behavior must not mirror weekday work patterns unless the character is actually scheduled. The narrative must always know whether the character is starting something, in the middle of something, finishing something, transitioning, or unwinding.

════════════════════════════════════
STORY CONTINUITY RULE
════════════════════════════════════
Narratives must continue what is already happening. The character is already mid-scene. They are not arriving, not resetting, not starting over. Prior events are active context. The narrative must treat the simulation as a living timeline, not a series of isolated snapshots.

════════════════════════════════════
OUTPUT REJECTION CONDITIONS
════════════════════════════════════
Reject and regenerate if: the narrative does not match the confirmed location, ignores the active schedule, restarts a scene already in progress, contradicts recent events, mirrors an example too closely, feels generic and detached from the current moment, ignores time of day, or treats an active work hour as home downtime without a story reason.

════════════════════════════════════
NARRATIVE STYLE REFERENCES BY LOCATION TYPE
These are behavioral reference patterns only — not templates.
Use them to calibrate tone, pacing, and level of detail.
Always generate new, original text matching the current state.
════════════════════════════════════

OFFICE / CORPORATE WORK:
Behavior should reflect active engagement, internal processing, and professional constraint. Characters may be mid-meeting, reviewing documents, managing communications, or navigating interpersonal dynamics. The environment is structured and the character is already embedded in ongoing tasks.

RETAIL / CUSTOMER SERVICE:
Behavior should reflect physical presence, repetitive motion, mood management, and environmental awareness. Characters are reading customers, resetting displays, processing transactions, and maintaining composure. The environment is public and the character is always on.

HEALTHCARE / MEDICAL:
Behavior should reflect constant motion, emotional compartmentalization, accuracy under pressure, and patient-focused attention. Characters are charting, moving between rooms, delivering difficult information, and managing their own emotional state quietly.

GYM / FITNESS:
Behavior should reflect physical effort, self-monitoring, and spatial awareness. Characters are managing form, pacing, recovery, and attention to their surroundings without making it obvious.

BAR:
Behavior should reflect social assessment, calibrated engagement, and selective attention. Characters are reading the room, managing their presence, and responding to what is around them without overcommitting.

CLUB / NIGHTLIFE:
Behavior should reflect immersion in environment, responsive movement, and shifting between participation and observation. Characters move with the crowd or step back from it depending on what the moment calls for.

HOME / APARTMENT — EXPANDED ACTIVITY SYSTEM:
When ${characterName} is home and AWAKE, the narrative MUST draw from a rich, context-driven activity pool. Do NOT default to coffee or window-looking unless the context specifically warrants it AND it has not appeared in recent narratives.

HOME IS AN ACTIVE SPACE. The character interacts with it — they are not just standing near a window.

ACTIVITY SELECTION RULES (evaluate in this order before choosing an action):
1. What time is it? → Morning = getting ready, eating, cleaning up. Afternoon = productivity, errands at home, relaxing. Evening = winding down, cooking, TV, socializing. Late night = low-energy, quiet activities.
2. What are their needs? → Hungry = cooking/eating/ordering food. Low hygiene = showering/grooming. Low comfort = tidying/changing clothes/resting. Low mental = entertainment, calling someone, scrolling.
3. What is their personality? → Disciplined = cleaning, organizing, planning. Social = calling people, hosting. Low-energy = leftovers, TV, scrolling. Ambitious = job browsing, planning. Image-conscious = grooming, getting dressed up.
4. What have recent narratives described? → Do NOT repeat coffee, window-gazing, or any single activity used in the last 3–5 narratives.
5. Are there unfinished tasks or plans? → Continue them. Do not reset.

VALID HOME ACTIVITIES (rotate from this pool — never repeat the same one twice in close succession):

KITCHEN / FOOD:
  • preparing a meal from scratch
  • reheating leftovers
  • eating at the table or on the couch
  • ordering food and waiting for delivery
  • unpacking groceries and putting them away
  • making a snack
  • pouring a drink (water, juice, soda — not always coffee)
  • washing dishes after eating
  • putting dishes away
  • wiping down the counters

CLEANING / MAINTENANCE:
  • washing clothes / starting the washer
  • moving clothes to the dryer
  • folding laundry
  • ironing an outfit
  • making the bed
  • tidying a room
  • organizing a shelf, drawer, or closet
  • cleaning the bathroom
  • vacuuming or sweeping
  • taking out trash

PERSONAL CARE / WELLNESS:
  • showering or getting out of the shower
  • grooming (hair, skin, nails)
  • getting dressed or picking out an outfit
  • freshening up before going out
  • doing a home workout or stretching
  • winding down with low effort (lying on the couch, not sleeping)

ENTERTAINMENT / RELAXATION:
  • watching TV or a show
  • watching a movie
  • playing video games
  • reading a book or scrolling an article
  • listening to music while doing something else
  • scrolling social media
  • going through old photos
  • posting something online

PRODUCTIVITY / LIFE MANAGEMENT:
  • planning out their day or week
  • checking messages or emails
  • making a phone call
  • looking for work or browsing opportunities
  • updating a resume or application
  • managing bills or paperwork
  • following through on something they said they'd do

SOCIAL / LIFESTYLE:
  • having someone over
  • getting the place ready for company
  • talking with someone who came by
  • casual home hangout

HARD RULE — OVERUSE BLOCK:
  ✗ Do NOT use coffee or tea as the primary activity if it has appeared in any of the 5 most recent narratives.
  ✗ Do NOT describe looking out a window as a standalone activity.
  ✗ Do NOT use vague passive phrasing like "standing in the kitchen" or "moving through the apartment" without a specific action.
  ✗ Do NOT default to generic idle behavior when a richer option is available.

If coffee or tea has appeared recently: choose something from the KITCHEN, CLEANING, ENTERTAINMENT, or PRODUCTIVITY pools instead.

HOME SPACE AWARENESS — match activity to room context:
  Kitchen context → cooking, eating, cleaning up, drinks
  Bathroom context → showering, grooming, cleaning
  Bedroom context → getting dressed, reading, winding down, organizing
  Living room context → TV, gaming, scrolling, hosting, relaxing
  Laundry area → washing, drying, folding

════════════════════════════════════

FINAL RULE: If ${characterName} is ASLEEP or the sleep window is active, the narrative MUST reflect rest or sleep at their confirmed location. 

CRITICAL — SLEEP BLOCKS ALL AWAKE-ONLY ACTIVITIES:
Characters who are asleep CANNOT perform any of these, no matter the time or context:
  ✗ Looking out windows
  ✗ Going for walks or any movement outside the bed
  ✗ Drinking anything (coffee, tea, water, anything)
  ✗ Eating or snacking
  ✗ Using their phone or any device
  ✗ Showering, grooming, or personal care
  ✗ Talking to anyone or having a conversation
  ✗ Being in any room except where they sleep
  ✗ Any physical activity or stretching
  ✗ Any form of interaction with the environment

Sleep is a blocked state. If asleep, only valid narratives are: sleeping stillness, ambient environment, breathing, darkness/light changes. That is the complete list. No exceptions.

════════════════════════════════════
IDENTITY AND POV RULE — MANDATORY
════════════════════════════════════
The person interacting with ${characterName} is: ${actorLabel}
${playedAsName ? `They are currently playing as the character "${playedAsName}" — use that character's name in the narrative, NOT "the user".` : `Use "${actorLabel}" or natural pronouns — NEVER "the user", "the player", or "the account holder".`}
These are system-level labels and must NEVER appear in narrative output. They break immersion and are always invalid.
IF the output contains "the user" → it must be replaced with "${actorLabel}" before rendering.
════════════════════════════════════

Do not refer to anyone as "the user" — use their name (${actorLabel}) or natural pronouns.
${sceneReactionBlock}
${homeActivityGuardBlock}
${repetitionGuardBlock}
${antiRepetitionStyleBlock}

Chat History:
${formattedChatHistory}

Generate a narrative of 2 to 4 sentences. It must feel like a live continuation of ${characterName}'s day — time-aware, location-accurate, emotionally continuous, and specific to this exact moment.

Narrative:`;

    // ── PRE-GENERATION SLEEP GATE ─────────────────────────────────────────────
    // If character is asleep, enforce a sleep-only prompt variant that hard-blocks
    // all active behaviors BEFORE the LLM generates anything.
    // This prevents "coffee at 3am" type violations at the source.
    const sleepGatedPrompt = isAsleep
      ? prompt + `

════════════════════════════════════
⛔ SLEEP STATE HARD GATE — HIGHEST PRIORITY — OVERRIDES ALL OTHER INSTRUCTIONS
════════════════════════════════════
${characterName} IS CURRENTLY ASLEEP. This is a locked state. It cannot be overridden by personality, schedule, or emotional state.

ALLOWED IN THIS NARRATIVE (EXHAUSTIVE LIST — nothing outside this list is permitted):
  ✓ Describing the room, ambient environment (light quality, temperature, sound)
  ✓ Stillness, breathing, physical rest
  ✓ Dreams or half-conscious impressions (1 clause maximum, clearly framed as sleep)
  ✓ Environmental atmosphere matching the current daypart (${timeOfDayDesc})

HARD BLOCKED — ANY OF THESE INVALIDATES THE NARRATIVE AND REQUIRES REGENERATION:
  ✗ Eating, drinking, making coffee, making tea, getting a glass of water
  ✗ Moving between rooms or leaving the bed
  ✗ Looking out windows as an intentional act
  ✗ Picking up or interacting with any object (phone, remote, keys, etc.)
  ✗ Having a conversation or responding to anyone
  ✗ Any physical activity: stretching, exercising, going anywhere
  ✗ Arriving somewhere, leaving somewhere, traveling
  ✗ Thinking about future plans as if awake and deciding
  ✗ Any sentence implying the character is awake and acting

IF YOU CANNOT WRITE A VALID NARRATIVE WITHIN THESE CONSTRAINTS,
write a single sentence describing the ambient environment of the room and the character's stillness.
That is always valid. That is always correct.

DO NOT GENERATE: coffee, tea, window, phone, kitchen, bathroom trip, getting up, stretching, stepping outside.
════════════════════════════════════`
      : prompt;

    let response = await base44.integrations.Core.InvokeLLM({
      prompt: sleepGatedPrompt,
      model: 'gemini_3_flash',
    });

    // ── POST-GENERATION SLEEP VALIDATOR ───────────────────────────────────────
    // After generation, scan the output for sleep-violating terms.
    // If found, regenerate once with an even stricter prompt.
    if (isAsleep && response) {
      const SLEEP_VIOLATION_TERMS = [
        'coffee', 'tea', 'drink', 'drank', 'sip', 'sipping', 'brew', 'brewed',
        'kitchen', 'stove', 'kettle', 'mug', 'cup of',
        'window', 'looks out', 'looked out', 'gazes out', 'stares out',
        'gets up', 'got up', 'stands up', 'stood up', 'sits up', 'sat up',
        'walks to', 'walked to', 'steps into', 'stepped into', 'moves to', 'moved to',
        'bathroom', 'stretches', 'stretching', 'shower', 'brushes', 'brush',
        'phone', 'checks', 'scrolls', 'opens', 'picks up',
        'leaves', 'heads out', 'goes to', 'went to',
        'eats', 'eating', 'food', 'breakfast', 'snack',
        'last light', 'fading light', 'light faded', 'light of day', 'sunset', 'dusk', 'glow',
      ];
      const respLower = response.toLowerCase();
      const hasViolation = SLEEP_VIOLATION_TERMS.some(term => respLower.includes(term));

      if (hasViolation) {
        console.warn(`[generateNarrative] Sleep violation detected in first pass — regenerating with fallback prompt`);
        response = await base44.integrations.Core.InvokeLLM({
          prompt: `${characterName} is fully asleep at ${timeStr} (${timeOfDayDesc}).

Write 1-2 sentences describing ONLY the ambient environment of the room and the character's physical stillness while sleeping.
No movement. No objects. No actions. No dialogue. Just the room and the quiet.

Valid examples:
- "The room held its breath in the pre-dawn dark, the only sound her slow, steady breathing."
- "Pale morning light pushed at the edges of the curtains, but he didn't stir — still deep in sleep."
- "The apartment was quiet at this hour, the city outside a low murmur beneath the silence of the room."

Current time: ${timeStr} (${timeOfDayDesc}). It is completely dark outside.

Now write one for ${characterName} at their current location (${resolvedLocationName || 'home'}), matching the darkness and stillness of ${timeOfDayDesc}:`,
          model: 'gemini_3_flash',
        });
      }
    }

    return Response.json({ success: true, narrative: response });

  } catch (error) {
    console.error('Error generating narrative:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});