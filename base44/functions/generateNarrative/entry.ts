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
    const isAsleep = (() => {
      if (resolvedPresenceStatus === 'sleeping' || resolvedPresenceStatus === 'napping') return true;
      if (!char.sleep_start_time || !char.wake_up_time) return false;
      const sH = parseInt(char.sleep_start_time.split(':')[0], 10);
      const wH = parseInt(char.wake_up_time.split(':')[0], 10);
      return sH > wH ? (hourET >= sH || hourET < wH) : (hourET >= sH && hourET < wH);
    })();

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
    const settingsList = await base44.entities.UserSettings.filter({ created_by: user.email }).catch(() => []);
    const worldName = settingsList?.[0]?.fictional_world_name || null;
    const userLabel = worldName || 'them';

    const formattedChatHistory = chatHistory
      .map(m => `"${m.sender_type === 'user' ? (worldName || 'You') : characterName}": "${m.content}"`)
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

    // ── BUILD PROMPT WITH GROUNDED CONTEXT ───────────────────────────────────
    const prompt = `You are a narrator for a realistic life simulation. Your output is a single cohesive narrative passage that continues the character's living timeline. It must feel like a live scene — grounded, specific, and earned.

════════════════════════════════════
CHARACTER STATE — ABSOLUTE GROUND TRUTH
These facts are locked and override everything else.
The narrative MUST reflect all of them exactly.
Do NOT contradict or ignore any of these facts.
════════════════════════════════════
Character: ${characterName}
${locationContext}
${sleepContext}
${presenceContext ? presenceContext + '\n' : ''}${activityContext ? activityContext + '\n' : ''}Current time: ${timeStr} (${timeOfDayDesc})
════════════════════════════════════
${temporalBlock}

════════════════════════════════════
IDENTITY AND PRONOUN RULES
════════════════════════════════════
All pronouns used must be dynamically mapped to the character's confirmed gender identity and user-defined pronouns. Valid outputs are: he/him, she/her, they/them, or the character's name directly. If unknown, default to they/them. Sexual orientation is a core identity trait and must never be overridden, assumed, or reassigned. Attraction must never be forced, implied without story basis, or defaulted to heterosexual behavior. The system must not rewrite a character's orientation through narrative framing.

════════════════════════════════════
ATTRACTION AND INTERACTION LOGIC
════════════════════════════════════
Attraction is not automatic. It must be evaluated using orientation, the specific person involved, the established relationship, the current emotional state, the environment, and the character's personality. The narrative must allow: curiosity without commitment, attention without attraction, and social interaction without romance. Situational behavior does not redefine identity. Attraction must feel earned and context-driven. Never default to romantic framing unless it is already established in the story state.

════════════════════════════════════
LOCATION AND SCHEDULE ENFORCEMENT
════════════════════════════════════
The current location is a truth source. If the character is at work, the narrative must reflect that work setting. If the character is at the gym, it must reflect the gym. If at a bar, reflect the bar. If at home, reflect the home environment. The system must never generate a narrative from a location the character is not currently in.

If the current time falls inside a scheduled block, that schedule must shape the narrative. A narrative generated during active work hours must reflect mid-shift behavior, not arrival, not waking up, not relaxing at home. If the character has been at work for hours, the narrative must reflect that momentum — not reset the scene.

HOME-STYLE NARRATIVES ARE BLOCKED when the character is scheduled to be at work or is confirmed at a non-home location.

════════════════════════════════════
EMOTIONAL GATING RULES
════════════════════════════════════
A mention of death or grief is not sufficient by itself to assign a grieving state to ${characterName}. Grief requires a meaningful relationship to the subject, direct personal impact, and story-level justification. If the user is grieving but ${characterName} has no direct tie to the subject, the narrative must reflect care and support without assigning bereavement to the character. User emotion must not be automatically mirrored into the character's emotional state. Personal trigger responses are allowed only when there is an actual matching history, and must remain proportional and bounded. Major emotional state transitions must be earned by the story, not assumed from topic keywords.

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

════════════════════════════════════

FINAL RULE: If ${characterName} is ASLEEP or the sleep window is active, the narrative MUST reflect rest or sleep at their confirmed location. No active behavior, errands, social engagement, or movement is allowed during a confirmed sleep state.

Do not refer to anyone as "the user" — use their name (${userLabel}) or natural pronouns.
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
        'coffee', 'tea', 'drink', 'drank', 'sip', 'sipping',
        'kitchen', 'stove', 'kettle', 'mug', 'cup of',
        'window', 'looks out', 'looked out', 'gazes out', 'stares out',
        'gets up', 'got up', 'stands up', 'stood up', 'sits up', 'sat up',
        'walks to', 'walked to', 'steps into', 'stepped into', 'moves to', 'moved to',
        'bathroom', 'stretches', 'stretching', 'shower', 'brushes', 'brush',
        'phone', 'checks', 'scrolls', 'opens', 'picks up',
        'leaves', 'heads out', 'goes to', 'went to',
        'eats', 'eating', 'food', 'breakfast', 'snack',
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

Now write one for ${characterName} at their current location (${resolvedLocationName || 'home'}):`,
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