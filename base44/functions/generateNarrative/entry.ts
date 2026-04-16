import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

    // ── DETERMINE SLEEP STATE ─────────────────────────────────────────────────
    const isAsleep = (() => {
      // If character has a resolved presence status that indicates sleeping
      if (resolvedPresenceStatus === 'sleeping' || resolvedPresenceStatus === 'napping') return true;

      if (!char.sleep_start_time || !char.wake_up_time) return false;
      const now = new Date();
      const hour = now.getHours();
      const sleepStart = parseInt(char.sleep_start_time.split(':')[0]);
      const wakeUp = parseInt(char.wake_up_time.split(':')[0]);
      if (sleepStart > wakeUp) {
        return hour >= sleepStart || hour < wakeUp;
      }
      return hour >= sleepStart && hour < wakeUp;
    })();

    // ── DETERMINE CURRENT TIME CONTEXT ───────────────────────────────────────
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hourET = nowET.getHours();
    const minET = nowET.getMinutes();
    const timeStr = `${hourET % 12 || 12}:${String(minET).padStart(2, '0')} ${hourET >= 12 ? 'PM' : 'AM'}`;
    let timeOfDayDesc = 'daytime';
    if (hourET >= 22 || hourET < 5) timeOfDayDesc = 'late night / deep night';
    else if (hourET >= 5 && hourET < 8) timeOfDayDesc = 'early morning';
    else if (hourET >= 8 && hourET < 12) timeOfDayDesc = 'morning';
    else if (hourET >= 12 && hourET < 17) timeOfDayDesc = 'afternoon';
    else if (hourET >= 17 && hourET < 20) timeOfDayDesc = 'evening';
    else if (hourET >= 20) timeOfDayDesc = 'night';

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

    // ── RESOLVE USER LABEL ────────────────────────────────────────────────────
    const settingsList = await base44.entities.UserSettings.list().catch(() => []);
    const worldName = settingsList?.[0]?.fictional_world_name || null;
    const userLabel = worldName || 'them';

    const formattedChatHistory = chatHistory
      .map(m => `"${m.sender_type === 'user' ? (worldName || 'You') : characterName}": "${m.content}"`)
      .join('\n');

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

Chat History:
${formattedChatHistory}

Generate a narrative of 2 to 4 sentences. It must feel like a live continuation of ${characterName}'s day — time-aware, location-accurate, emotionally continuous, and specific to this exact moment.

Narrative:`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      model: 'gemini_3_flash',
    });

    return Response.json({ success: true, narrative: response });

  } catch (error) {
    console.error('Error generating narrative:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});