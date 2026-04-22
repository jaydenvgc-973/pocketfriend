import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// ── Full Identity-Driven Location Affinity (inlined — no local imports in Deno) ─
const _SE_N = {
  introvert:        { desc:'prefers home, parks, quiet places — avoids crowds', preferred:['home','outdoor','public'], conditional:['gym'], avoided:['social'] },
  mostly_introvert: { desc:'leans quiet, small gatherings', preferred:['home','outdoor','public','food_drink'], conditional:['social'], avoided:[] },
  ambivert:         { desc:'mood-dependent — alternates between social and quiet', preferred:['food_drink','outdoor','home','social'], conditional:[], avoided:[] },
  mostly_extrovert: { desc:'enjoys lively bars, restaurants, social events', preferred:['social','food_drink','gym','outdoor'], conditional:[], avoided:[] },
  extrovert:        { desc:'thrives in clubs, parties, crowded social spaces', preferred:['social','food_drink','outdoor'], conditional:['home'], avoided:[] },
};
const _CONS_FLAGS = ['gay','lgbt','queer','lgbtq','drag','strip club','adult club','adult entertainment','erotic','sex club','swinger','fetish'];
const _ALCO_FLAGS = ['brewery','distillery','wine bar','cocktail bar','pub'];
const _NIGHT_FLAGS = ['nightclub','night club','rave','dance club'];
const _hpat = (t, arr) => { const s=(t||'').toLowerCase(); return arr.some(p=>s.includes(p)); };

const _MOOD_N = {
  sad:{pull:'home/outdoor/religion',away:'social',isolating:true}, anxious:{pull:'home/outdoor',away:'social',isolating:true},
  overwhelmed:{pull:'home/outdoor',away:'social/gym',isolating:true}, reflective:{pull:'home/outdoor/religion',away:'social',isolating:false},
  'closed-off':{pull:'home',away:'social',isolating:true}, 'burnt out':{pull:'home/outdoor',away:'social/gym',isolating:true},
  grief:{pull:'home/religion/outdoor',away:'social',isolating:true}, bored:{pull:'social/food_drink/outdoor',away:'home',isolating:false},
  excited:{pull:'social/outdoor/gym',away:'',isolating:false}, joyful:{pull:'social/food_drink/outdoor',away:'',isolating:false},
  content:{pull:'home/outdoor/food_drink',away:'',isolating:false}, calm:{pull:'outdoor/home/food_drink',away:'',isolating:false},
  irritated:{pull:'outdoor/gym',away:'social',isolating:false}, frustrated:{pull:'gym/outdoor/home',away:'social',isolating:false},
  flirtatious:{pull:'social/food_drink',away:'home',isolating:false}, confident:{pull:'social/gym',away:'',isolating:false},
  loneliness:{pull:'social/food_drink',away:'home',isolating:false},
};

function buildLocationAffinityContext(character) {
  const se = character.social_energy || 'ambivert';
  const sp = _SE_N[se] || _SE_N.ambivert;
  const religion = (character.religion || '').trim();
  const rel = religion.toLowerCase();
  const beliefLevel = character.belief_level || 'moderate';
  const isDevout = beliefLevel === 'devout';
  const isModerate = beliefLevel === 'moderate';
  const hh = (character.health_habits || '').toLowerCase();
  const mood = character.emotional_state || 'calm';
  const moodInfo = _MOOD_N[mood];
  const traits = (character.personality_traits || []).map(t => t.toLowerCase()).join(' ');
  const isMuslim = rel.includes('islam') || rel.includes('muslim');
  const hasReligion = religion && rel !== 'none' && religion !== 'None';

  const lines = [];
  lines.push(`SOCIAL ENERGY: ${se} — ${sp.desc}.`);
  lines.push(`Preferred venue types: ${sp.preferred.join(', ')}.`);
  if (sp.avoided.length) lines.push(`Naturally avoids: ${sp.avoided.join(', ')} (goes only with specific reason).`);
  if (sp.conditional.length) lines.push(`Conditional (mood-dependent): ${sp.conditional.join(', ')}.`);

  if (hasReligion) {
    if (isDevout) {
      lines.push(`BELIEFS: Devout ${religion}. MUST NOT casually appear at: ${_CONS_FLAGS.join(', ')}. Only with strong explicit contextual reason.`);
      if (isMuslim) lines.push(`As a devout Muslim, avoids alcohol-heavy venues (bars, pubs, breweries) unless context justifies.`);
    } else if (isModerate) {
      lines.push(`BELIEFS: Moderate ${religion}. Generally avoids adult/explicit venues (strip clubs, sex clubs). Other social venues acceptable.`);
      if (isMuslim) lines.push(`As a practicing Muslim, somewhat uncomfortable at heavily alcohol-focused venues.`);
    }
  }

  if (/gym|workout|fitness|exercise|train|lift/.test(hh)) lines.push(`HEALTH: Fitness-focused — gym and outdoor activity are regular choices, not occasional.`);
  if (/run|jog|walk|hike|trail|outdoor/.test(hh)) lines.push(`Active outdoor lifestyle — parks, trails, walks are natural.`);
  if (/yoga|meditat|wellness|mindful/.test(hh)) lines.push(`Wellness-oriented — calm, low-stress environments preferred.`);

  if (/nature|earthy|outdoors|grounded|peaceful/.test(traits)) lines.push(`TRAITS: Earthy/nature-loving — prefers parks, outdoor spaces, calm settings.`);
  if (/homebody|cozy|domestic|private/.test(traits)) lines.push(`Homebody tendency — home is a comfort zone, not just a fallback.`);
  if (/night owl|nightlife|club goer/.test(traits)) lines.push(`Night owl — nightlife and late venues are more natural for them.`);
  if (/fitness|athletic|active|disciplined/.test(traits)) lines.push(`Fitness-driven personality — gym aligns with identity.`);
  if (/intellectual|bookish|studious|curious/.test(traits)) lines.push(`Intellectual — libraries, quiet cafes, educational spaces feel natural.`);

  if (moodInfo) {
    lines.push(`CURRENT MOOD (${mood}): drawn toward ${moodInfo.pull}${moodInfo.away ? `, away from ${moodInfo.away}` : ''}.${moodInfo.isolating ? ' Isolating mode — prefers solitude or small trusted spaces.' : ''}`);
  }

  lines.push(`LOCATION RULE: Every venue choice in this narrative must match the above identity. Personality, beliefs, mood, and lifestyle all shape where this character goes. Exceptions are allowed but must feel intentional and character-specific — not random.`);
  return lines.join('\n');
}

/**
 * triggerCharacterNarratives
 *
 * Autonomously generates and injects narrative messages into active character conversations.
 * Narratives are short, third-person scene-setting moments that ground the conversation
 * in real life — what the character is doing, something happening around them, a shift in mood.
 *
 * Rules:
 * - Only fires for characters with an active conversation (at least 3 messages)
 * - Max 2 narratives per character per day
 * - Only runs if the character has been active recently (message in last 24h)
 * - Random chance (40%) per eligible character to keep it feeling natural, not mechanical
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    // Allow scheduled invocation (no user token)
    try { await base44.auth.me(); } catch (_) {}

    console.log('[triggerCharacterNarratives] AUTOMATION STARTED');

    const allCharacters = await base44.asServiceRole.entities.Character.list();
    // HARD FILTER: Only active_created_character types are eligible for autonomous narratives
    const activeCharacters = allCharacters.filter(c => {
      const isActive = !c.status || c.status === 'active';
      const hasCreatedBy = !!c.created_by;
      const isTargetType = c.character_type === 'active_created_character';
      if (!isTargetType) {
        console.log(`[triggerCharacterNarratives] SKIPPED ${c.name} (id: ${c.id}) — character_type="${c.character_type}" is not "active_created_character"`);
      }
      return isActive && hasCreatedBy && isTargetType;
    });

    console.log(`[triggerCharacterNarratives] Filtered ${allCharacters.length} total characters → ${activeCharacters.length} eligible (active_created_character only)`);

    const results = [];
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    for (const character of activeCharacters) {
      try {
        console.log(`[triggerCharacterNarratives] Evaluating ${character.name} (type: ${character.character_type})`);

        // Find the most recent direct conversation for this character
        const convos = await base44.asServiceRole.entities.Conversation.filter(
          { character_ids: character.id, type: 'direct' },
          '-last_message_date',
          1
        );
        if (!convos.length) {
          console.log(`[triggerCharacterNarratives] SKIPPED ${character.name} — no direct conversation found`);
          continue;
        }

        const convo = convos[0];

        // Only proceed if the conversation has been active in the last 24h
        if (!convo.last_message_date || convo.last_message_date < oneDayAgo) {
          console.log(`[triggerCharacterNarratives] SKIPPED ${character.name} — conversation inactive (last: ${convo.last_message_date})`);
          continue;
        }

        // Check: no narrative sent in the last 2 hours
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
        const recentNarratives = await base44.asServiceRole.entities.Message.filter(
          { conversation_id: convo.id, is_narrative: true },
          '-timestamp',
          5
        );
        const narrativeRecently = recentNarratives.some(m => m.timestamp >= twoHoursAgo);
        if (narrativeRecently) {
          console.log(`[triggerCharacterNarratives] SKIPPED ${character.name} — narrative sent within last 2 hours`);
          results.push({ characterId: character.id, name: character.name, status: 'skipped', reason: 'narrative sent within last 2 hours' });
          continue;
        }

        // Get recent messages for context
        const recentMessages = await base44.asServiceRole.entities.Message.filter(
          { conversation_id: convo.id },
          '-timestamp',
          10
        );
        if (recentMessages.length < 3) {
          console.log(`[triggerCharacterNarratives] SKIPPED ${character.name} — fewer than 3 messages in conversation`);
          continue;
        }

        // Build context for narrative generation
        const recentText = recentMessages
          .slice(0, 5)
          .reverse()
          .map(m => `${m.sender_type === 'user' ? 'User' : character.name}: ${m.content}`)
          .join('\n');

        const lifeContext = character.current_life_event || '';
        const microNarration = character.daily_micro_narration || '';
        const emotionalState = character.emotional_state || 'calm';
        const city = [character.city, character.state].filter(Boolean).join(', ');
        const weather = character.weather_summary || '';
        const locationAffinity = buildLocationAffinityContext(character);

        const etNow = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'long' });

        const prompt = `You are writing a short, third-person narrative moment for a character named ${character.name}.

CHARACTER CONTEXT:
- Personality: ${character.personality_summary || 'no summary'}
- Current emotional state: ${emotionalState}
- What they're doing right now: ${microNarration || 'going about their day'}
- What's on their mind: ${lifeContext || 'nothing major'}
- Location: ${city || 'their area'}
- Current time: ${etNow} Eastern
${weather ? `- Weather: ${weather}` : ''}
- Location affinity: ${locationAffinity}

RECENT CONVERSATION:
${recentText}

TASK:
Write a short narrative moment (1–3 sentences, STRICTLY third person) that:
- Reflects something authentic happening in ${character.name}'s life RIGHT NOW
- Fits naturally after the conversation above — like a scene cut or life update
- Is grounded and real — NOT dramatic, NOT poetic, NOT over-written
- Feels like something a friend would text between messages, or a quiet narrator note
- NEVER mentions the user or addresses them directly
- Can be about a small action (making coffee, checking their phone), a thought, something they noticed, or a shift in mood
- STRICTLY third person — use "${character.name}" or pronouns (he/she/they). NEVER "I", "me", "my"

Examples of good tone:
"${character.name} sets his phone down and just sits with it for a second."
"She finishes getting ready, grabs her keys, and heads out without looking back."
"He's been a little off all day — nothing specific, just one of those days."

Return ONLY the narrative text, nothing else.`;

        console.log(`[triggerCharacterNarratives] ELIGIBLE: ${character.name} — generating narrative`);

        const narrativeContent = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt });

        if (!narrativeContent?.trim()) {
          console.log(`[triggerCharacterNarratives] FAILED: ${character.name} — empty narrative returned from LLM`);
          continue;
        }

        // Save as narrative message
        const createdMessage = await base44.asServiceRole.entities.Message.create({
          conversation_id: convo.id,
          sender_type: 'character',
          character_id: character.id,
          character_name: character.name,
          content: narrativeContent.trim(),
          is_narrative: true,
          is_read: false,
          timestamp: now.toISOString(),
        });

        console.log(`[triggerCharacterNarratives] MESSAGE CREATED: ${character.name} — msg_id: ${createdMessage?.id}, convo_id: ${convo.id}`);

        // Update conversation preview
        await base44.asServiceRole.entities.Conversation.update(convo.id, {
          last_message_preview: narrativeContent.trim().substring(0, 100),
          last_message_date: now.toISOString(),
        });

        console.log(`[triggerCharacterNarratives] SUCCESS: ${character.name} — narrative sent and conversation updated`);
        results.push({ characterId: character.id, name: character.name, status: 'sent', narrative: narrativeContent.trim().substring(0, 80) });

      } catch (charErr) {
        console.error(`[triggerCharacterNarratives] ERROR for ${character.name}:`, charErr.message);
        results.push({ characterId: character.id, name: character.name, status: 'error', error: charErr.message });
      }
    }

    console.log(`[triggerCharacterNarratives] AUTOMATION COMPLETE: ${results.length} characters processed`);
    return Response.json({ success: true, results });

  } catch (error) {
    console.error('[triggerCharacterNarratives]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});