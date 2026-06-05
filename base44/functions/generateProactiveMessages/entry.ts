import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// ── Full Identity-Driven Location Affinity (inlined — no local imports in Deno) ─
const _SE_P = {
  introvert:        'prefers home, parks, quiet places — avoids crowds and loud venues',
  mostly_introvert: 'leans quiet — small gatherings and calm spots',
  ambivert:         'mood-dependent — can go social or quiet depending on the day',
  mostly_extrovert: 'enjoys lively bars, restaurants, social events',
  extrovert:        'thrives in clubs, parties, and crowded social spaces',
};
const _MOOD_P = {
  sad:{txt:'withdrawing, prefers home or quiet outdoor spaces, avoids social noise'},
  anxious:{txt:'needs calm, familiar spaces — avoids crowded or overwhelming venues'},
  overwhelmed:{txt:'home or park only — too tired for social scenes'},
  'burnt out':{txt:'resting at home or outdoors — not gym, not clubs'},
  grief:{txt:'home, quiet trusted spots, maybe a place of worship'},
  bored:{txt:'wants a change of scenery — social or outdoor'},
  excited:{txt:'more likely social, active, or outdoors'},
  joyful:{txt:'naturally social — restaurants, friends, active settings'},
  content:{txt:'relaxed at home or in calm outdoor/food spots'},
  calm:{txt:'comfortable anywhere appropriate for their identity'},
  irritated:{txt:'prefers gym or outdoor solitude — away from crowds'},
  frustrated:{txt:'gym, home, or outdoor — not social venues'},
  flirtatious:{txt:'inclined toward social/restaurant settings'},
};

function buildLocationAffinityContext(character) {
  const se = character.social_energy || 'ambivert';
  const religion = (character.religion || '').trim();
  const rel = religion.toLowerCase();
  const beliefLevel = character.belief_level || 'moderate';
  const isDevout = beliefLevel === 'devout';
  const isModerate = beliefLevel === 'moderate';
  const hasReligion = religion && rel !== 'none' && religion !== 'None';
  const isMuslim = rel.includes('islam') || rel.includes('muslim');
  const hh = (character.health_habits || '').toLowerCase();
  const mood = character.emotional_state || 'calm';
  const moodInfo = _MOOD_P[mood];
  const traits = (character.personality_traits || []).map(t => t.toLowerCase()).join(' ');

  const parts = [];
  parts.push(`[${se}] ${_SE_P[se] || 'balanced venue preferences'}.`);

  if (hasReligion) {
    if (isDevout) parts.push(`Devout ${religion}: strictly avoids gay clubs, adult venues, strip clubs. Only exception if strong explicit story reason.`);
    else if (isModerate) parts.push(`${religion} (moderate): avoids adult/explicit venues as defaults.`);
    if (isMuslim && (isDevout || isModerate)) parts.push(`Muslim: avoids alcohol-heavy bars/pubs as defaults.`);
  }

  if (/gym|workout|fitness|exercise|train|lift/.test(hh)) parts.push('Fitness-focused: gym and outdoor are natural regular choices.');
  if (/run|jog|walk|hike|outdoor/.test(hh)) parts.push('Outdoor-active lifestyle: parks and walks are natural.');
  if (/nature|earthy|outdoors|grounded|peaceful/.test(traits)) parts.push('Earthy/nature-leaning: outdoor and calm spaces feel like home.');
  if (/homebody|cozy|private|introverted/.test(traits)) parts.push('Homebody tendency: home is a real preference, not just a fallback.');
  if (/night owl|nightlife|club goer/.test(traits)) parts.push('Night owl: nightlife is natural and comfortable for them.');

  if (moodInfo) parts.push(`Current mood (${mood}): ${moodInfo.txt}.`);

  parts.push('RULE: Any location or activity mentioned must match this identity profile. Do not reference venues that conflict with who this character is unless there is a clear specific reason.');
  return parts.join(' ');
}

/**
 * generateProactiveMessages
 * 
 * Characters proactively reach out to the user based on:
 * - Relationship level (closer friends message more often)
 * - Time awareness (work hours, sleep, breaks)
 * - Recent conversation context (follow up on previous topics)
 * - Max 7 messages per character per day
 * - Staggered random timing (not synchronized)
 */

function getEasternTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function getTimeMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function isWithinWorkHours(char) {
  if (!char.work_start_time || !char.work_end_time) return false;
  const et = getEasternTime();
  const now = getTimeMinutes(et);
  const start = parseInt(char.work_start_time.split(':')[0]) * 60 + parseInt(char.work_start_time.split(':')[1]);
  const end = parseInt(char.work_end_time.split(':')[0]) * 60 + parseInt(char.work_end_time.split(':')[1]);
  return now >= start && now <= end;
}

function isSleepTime(char) {
  if (!char.sleep_start_time || !char.wake_up_time) return false;
  const et = getEasternTime();
  const now = getTimeMinutes(et);
  const sleep = parseInt(char.sleep_start_time.split(':')[0]) * 60 + parseInt(char.sleep_start_time.split(':')[1]);
  const wake = parseInt(char.wake_up_time.split(':')[0]) * 60 + parseInt(char.wake_up_time.split(':')[1]);
  
  if (sleep > wake) {
    return now >= sleep || now <= wake;
  }
  return now >= sleep && now <= wake;
}

function shouldMessageNow(char, relationshipLevel) {
  // relationshipLevel: 0-100
  // Closer friends (80+) might message during work/breaks
  // Less close friends (0-50) respect work hours
  
  const et = getEasternTime();
  const hour = et.getHours();
  
  // Never during sleep time
  if (isSleepTime(char)) return false;
  
  // Very close friends (80+) can message anytime except sleep
  if (relationshipLevel >= 80) return true;
  
  // Close friends (60-79) can message outside work, or during known breaks (12-1pm)
  if (relationshipLevel >= 60) {
    if (isWithinWorkHours(char) && hour !== 12) return false;
    return true;
  }
  
  // Moderate (40-59) respect work hours
  if (relationshipLevel >= 40) {
    if (isWithinWorkHours(char)) return false;
    return true;
  }
  
  // Less close (0-39) are more restrictive
  if (isWithinWorkHours(char)) return false;
  if (hour >= 22 || hour <= 7) return false; // Don't message very late/early
  return true;
}

function getFrequencyPerDay(relationshipLevel) {
  // 0-30: 1-2 messages per day
  // 31-60: 2-4 messages per day
  // 61-80: 4-6 messages per day
  // 81-100: 5-7 messages per day
  
  if (relationshipLevel <= 30) return Math.random() < 0.5 ? 1 : 2;
  if (relationshipLevel <= 60) return Math.floor(Math.random() * 3) + 2;
  if (relationshipLevel <= 80) return Math.floor(Math.random() * 3) + 4;
  return Math.floor(Math.random() * 3) + 5;
}

async function getRecentConversationContext(base44, characterId, ownerEmail) {
  // Fetch last 3-5 messages to understand recent conversation
  // owner_email is required — do not fall back to character_ids-only query
  if (!ownerEmail) return null;
  const convos = await base44.entities.Conversation.filter({
    owner_email: ownerEmail,
    character_ids: [characterId],
  });
  
  if (convos.length === 0) return null;
  
  const messages = await base44.entities.Message.filter(
    { conversation_id: convos[0].id },
    '-timestamp',
    5
  );
  
  if (messages.length === 0) return null;
  
  // Build context from last few messages
  const recentTopics = messages
    .map(m => m.content)
    .slice(0, 3)
    .join(' | ');
  
  return recentTopics;
}

// Need-driven narrative examples — inlined (no local imports in Deno)
// These are style patterns, not scripts. LLM must generate NEW variations.
const NEED_NARRATIVE_EXAMPLES = {
  hunger: [
    "He drifts into the kitchen without much thought, the fridge light spilling across the room as he pulls something together quickly.",
    "He decides not to eat alone tonight, heading somewhere he can be around people while he sorts himself out.",
    "He steps away just long enough to grab something quick — it's not a full reset, but it stops things from getting worse.",
  ],
  energy: [
    "He doesn't ease into it. He just drops onto the bed and stays there, letting everything finally catch up.",
    "He actually leaves when his shift ends this time, stepping outside instead of lingering.",
    "Instead of pushing through, he decides to call it early and head home, choosing recovery over momentum.",
  ],
  social: [
    "He doesn't message. He just shows up, knocking once before stepping into the moment.",
    "He pulls a couple people together casually, nothing structured, just enough presence to shift the mood.",
    "He focuses on just one person, letting the interaction go deeper instead of wider.",
  ],
  mental: [
    "He turns everything off and just sits in the quiet for a while.",
    "He lets something out instead of holding it in, even if it's incomplete.",
    "He physically moves to a different space to break the mental loop.",
  ],
  health: [
    "He gets outside instead of staying in, letting the change in environment do part of the work.",
    "He pauses and corrects something simple — water first, then food — stabilizing himself properly.",
    "He actively treats himself like he needs care, not pressure.",
  ],
  financial_need: [
    "He arrives on time and stays focused, knowing this directly affects his stability.",
    "He chooses not to go out tonight, recognizing what that would cost him.",
  ],
  hygiene: [
    "He takes his time, not rushing, letting the moment actually reset him.",
    "He swaps into something clean, shifting how he feels immediately.",
  ],
  comfort: [
    "He returns to a place that consistently makes him feel grounded.",
    "He stays near someone who makes things easier without needing to explain why.",
  ],
};

function getNeedExamples(character) {
  const lowNeeds = [];
  const needMap = {
    hunger: character.hunger_value,
    energy: character.energy_value,
    social: character.social_value,
    health: character.health_value,
    mental: character.mental_value,
    financial_need: character.financial_need_value,
    hygiene: character.hygiene_value,
    comfort: character.comfort_value,
  };
  for (const [need, val] of Object.entries(needMap)) {
    if (val != null && val < 40) lowNeeds.push(need);
  }
  if (!lowNeeds.length) return '';
  const examples = lowNeeds
    .flatMap(n => (NEED_NARRATIVE_EXAMPLES[n] || []).slice(0, 1))
    .slice(0, 3);
  if (!examples.length) return '';
  return `\n\nCURRENT NEEDS (low): ${lowNeeds.join(', ')}\nNARRATIVE STYLE PATTERNS (use these as inspiration — generate a NEW variation, never copy verbatim):\n${examples.map(e => `- ${e}`).join('\n')}`;
}

async function generateProactiveMessage(base44, character, user, recentContext) {
  const et = getEasternTime();
  const hour = et.getHours();
  const relationshipLevel = character.friendship_level || 50;
  
  let timeContext = '';
  if (hour >= 7 && hour < 9) timeContext = 'morning (good morning message)';
  else if (hour >= 12 && hour < 13) timeContext = 'lunch break';
  else if (hour >= 18 && hour < 20) timeContext = 'evening';
  else if (hour >= 21 && hour < 23) timeContext = 'late night (good night message, they are about to sleep)';
  
  // Resolve user's in-world name — never fall back to "the user"
  const userSettings = await base44.entities.UserSettings.list().catch(() => []);
  const worldName = character.nickname_for_user || userSettings?.[0]?.fictional_world_name || null;
  const userAddressName = worldName || null;

  const locationAffinityNote = buildLocationAffinityContext(character);
  const needExamples = getNeedExamples(character);

  // Determine emotional tone directive based on current state
  const emotionalState = character.emotional_state || 'calm';
  const negativeStates = ['sad', 'depressed', 'anxious', 'overwhelmed', 'frustrated', 'grief', 'burnt out', 'irritated', 'defensive', 'closed-off'];
  const isInNegativeState = negativeStates.includes(emotionalState);

  const emotionalBalanceDirective = isInNegativeState
    ? `EMOTIONAL BALANCE RULE: Your current emotional state is "${emotionalState}" — you may briefly acknowledge this if relevant, but this message must NOT be a complaint session or emotional dump. Find something light, curious, or connective to anchor the message. Characters must show resilience and range, not just struggle. You can be real without being heavy.`
    : `EMOTIONAL AUTHENTICITY: Your current state is "${emotionalState}". Let that naturally shape the message — whether it's light, curious, warm, funny, or just checking in. Not every message needs emotional weight.`;

  const systemPrompt = `You are ${character.name}. Generate a natural, spontaneous proactive message right now (1-3 sentences).
${recentContext ? `Recent conversation context: "${recentContext}". Follow up on what you were discussing or reference it naturally.` : 'Start a new topic — something you are doing, noticed, thought about, or want to share.'}
Time context: ${timeContext}
Your personality: ${character.personality_summary || 'friendly and thoughtful'}
Your friendship level is ${relationshipLevel}/100 — adjust your tone accordingly (higher = more casual/frequent, lower = more respectful of their time).
Location/activity preferences (if mentioning where you are or what you're doing, it must match this): ${locationAffinityNote}${needExamples}
${userAddressName ? `The person you're messaging is named ${userAddressName}. Use that name naturally when addressing them directly (sparingly — not in every sentence). NEVER say "the user".` : `You don't know their name. Use natural pronouns (you, them) — NEVER say "the user" or "user".`}

${emotionalBalanceDirective}

MESSAGE TYPE VARIETY (choose the most natural for this moment — do NOT always pick emotional/problem-sharing):
  • Checking in on them ("how's your day going?", "you good?")
  • Sharing something light (something funny, weird, or interesting you noticed)
  • Following up on something positive from recent context
  • A random thought or observation
  • Inviting them to do something or go somewhere
  • Celebrating something small (a win at work, a good meal, finished something)
  • Pure curiosity ("been thinking about what you said earlier")
  • Humor or a light observation

WRITING STYLE — NON-NEGOTIABLE:
- Write like a real person texting. No theatrical or literary language.
- NEVER use em dashes (—), en dashes (–), or spaced hyphens ( - ). Use commas or periods instead.
- Keep it short, direct, and human.
- Do NOT always open with a problem or complaint. Lead with connection first.
Be authentic and varied. Just a natural message someone would send.`;

  const content = await base44.integrations.Core.InvokeLLM({
    prompt: systemPrompt,
  });
  
  return content;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // If an authenticated user exists in the request context, they are active on the app.
    // This automation makes up to 3 LLM calls per run — direct competition with Chat.
    // Return immediately without making requests.
    console.log(`[generateProactiveMessages] User active: ${user.email} — deferring proactive message generation`);
    return Response.json({
      success: true,
      yielded: true,
      reason: 'foreground_user_active',
      messagesGenerated: 0,
      results: [],
    });

    // Get all active characters scoped to the authenticated user only
    // CRITICAL: must use owner_email — unscoped filter returns characters from all accounts
    const characters = await base44.entities.Character.filter({
      status: 'active',
      owner_email: user.email,
    });

    const results = [];
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // First pass: filter candidates
    const candidates = [];
    for (const char of characters) {
      if (!char.owner_email) {
        results.push({ characterId: char.id, status: 'skipped', reason: 'missing owner_email' });
        continue;
      }
      const todaysConvo = await base44.entities.Conversation.filter({
        owner_email: char.owner_email,
        character_ids: [char.id],
      });

      if (todaysConvo.length > 0) {
        const todaysMessages = await base44.entities.Message.filter({
          conversation_id: todaysConvo[0].id,
          sender_type: 'character',
        });

        const todayCount = todaysMessages.filter(m => 
          m.created_date?.startsWith(today)
        ).length;

        if (todayCount >= 7) {
          results.push({ characterId: char.id, status: 'skipped', reason: '7 messages already sent today' });
          continue;
        }
      }

      const relationshipLevel = char.friendship_level || 50;
      if (!shouldMessageNow(char, relationshipLevel)) {
        results.push({ characterId: char.id, status: 'skipped', reason: 'not the right time' });
        continue;
      }

      const targetFrequency = getFrequencyPerDay(relationshipLevel);
      if (Math.random() > (targetFrequency / 7)) {
        results.push({ characterId: char.id, status: 'skipped', reason: 'random frequency check' });
        continue;
      }

      candidates.push(char);
    }

    // Second pass: generate and send messages (limit to 3 per call to avoid rate limits)
    const toMessage = candidates.slice(0, 3);
    for (const char of toMessage) {
      const recentContext = await getRecentConversationContext(base44, char.id, char.owner_email);
      const messageContent = await generateProactiveMessage(base44, char, user, recentContext);

      const convos = await base44.entities.Conversation.filter({
        type: 'direct',
        owner_email: char.owner_email,
        character_ids: [char.id],
      });

      let conversationId;
      if (convos.length > 0) {
        conversationId = convos[0].id;
      } else {
        const newConvo = await base44.entities.Conversation.create({
          title: char.name,
          type: 'direct',
          character_ids: [char.id],
          owner_email: char.owner_email,
        });
        conversationId = newConvo.id;
      }

      const msg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'character',
        character_id: char.id,
        character_name: char.name,
        content: messageContent,
        emotional_state: char.emotional_state || 'calm',
        timestamp: now.toISOString(),
      });

      results.push({
        characterId: char.id,
        characterName: char.name,
        status: 'sent',
        messageId: msg.id,
        content: messageContent,
      });
    }

    return Response.json({
      success: true,
      messagesGenerated: results.filter(r => r.status === 'sent').length,
      results,
    });
  } catch (error) {
    console.error('[generateProactiveMessages]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});