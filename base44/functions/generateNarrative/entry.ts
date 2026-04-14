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
    const prompt = `You are a narrator for a realistic life simulation. Generate a concise narrative (max 3 sentences) based on the chat history below.

════════════════════════════════════
CHARACTER STATE — ABSOLUTE GROUND TRUTH
These facts are locked. The narrative MUST reflect them exactly.
Do NOT contradict or ignore any of these facts.
════════════════════════════════════
Character: ${characterName}
${locationContext}
${sleepContext}
${presenceContext ? presenceContext + '\n' : ''}${activityContext ? activityContext + '\n' : ''}Current time: ${timeStr} (${timeOfDayDesc})
════════════════════════════════════

CRITICAL RULES:
- If ${characterName} is ASLEEP, the narrative MUST reflect that they are asleep/resting at their current location. They CANNOT be described as doing anything active (going out, getting coffee, running errands, talking, etc.).
- The narrative MUST be consistent with the current location. If they are home, they are home — not at a bar, café, gym, or anywhere else.
- Do NOT hallucinate actions or locations that contradict the character's actual state above.
- The narrative should feel like a game master setting the scene — grounded, specific, and true to reality.
- Do not refer to anyone as "the user" — use their name (${userLabel}) or natural pronouns.

Chat History:
${formattedChatHistory}

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