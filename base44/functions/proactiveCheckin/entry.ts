import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Allow scheduled (no user) and admin triggers
  try {
    const user = await base44.auth.me();
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  } catch (_) {
    // Scheduled — no user token
  }

  const allCharacters = await base44.asServiceRole.entities.Character.list();
  const characters = allCharacters.filter(c => !c.status || c.status === 'active');

  // Fetch user settings for schedule notes
  const allSettings = await base44.asServiceRole.entities.UserSettings.list();
  const userSettings = allSettings?.[0] || {};
  const userScheduleNotes = userSettings.user_schedule_notes || null;

  const results = [];

  for (const character of characters) {
    try {
      // Find last conversation for this character
      const conversations = await base44.asServiceRole.entities.Conversation.filter({ character_ids: [character.id] });
      
      let hoursSinceLastMessage = Infinity;
      if (conversations.length > 0) {
        const sorted = conversations
          .filter(c => c.last_message_date)
          .sort((a, b) => new Date(b.last_message_date) - new Date(a.last_message_date));

        if (sorted.length > 0) {
          const lastDate = new Date(sorted[0].last_message_date);
          hoursSinceLastMessage = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60);
        }
      }

      const friendship = character.friendship_level ?? 75;
      const respect = character.user_respect_level ?? 50;
      const chosenFamily = character.chosen_family_level ?? 0;
      const romantic = character.romantic_level ?? 0;
      const emotionalState = character.emotional_state || 'calm';
      const archetype = character.archetype || '';
      const personalitySummary = character.personality_summary || '';

      // Closeness score influences base check-in frequency
      const closeness = (friendship + respect + chosenFamily + romantic * 0.5) / 3.5;
      let checkInAfterHours;
      if (closeness >= 70) checkInAfterHours = 18;
      else if (closeness >= 50) checkInAfterHours = 36;
      else if (closeness >= 30) checkInAfterHours = 60;
      else checkInAfterHours = 96;

      // --- EMOTIONAL STATE INFLUENCE ON FREQUENCY ---
      // Withdrawn/negative states = reaches out less / waits longer
      const withdrawnStates = ['irritated', 'defensive', 'closed-off', 'burnt out', 'overwhelmed', 'frustrated'];
      const eagerstates = ['joyful', 'excited', 'anxious', 'flirtatious'];
      const reflectiveStates = ['reflective', 'sad', 'content'];

      if (withdrawnStates.includes(emotionalState)) {
        checkInAfterHours *= 1.8; // much less likely to reach out
      } else if (eagerstates.includes(emotionalState)) {
        checkInAfterHours *= 0.7; // more eager to reach out
      } else if (reflectiveStates.includes(emotionalState)) {
        checkInAfterHours *= 1.1; // slightly less frequent
      }
      // anxious specifically: reaches out MORE (needier behavior)
      if (emotionalState === 'anxious') {
        checkInAfterHours *= 0.6;
      }

      if (hoursSinceLastMessage < checkInAfterHours) {
        results.push({ id: character.id, name: character.name, status: 'skipped', reason: `Only ${Math.round(hoursSinceLastMessage)}h elapsed, threshold is ${checkInAfterHours}h` });
        continue;
      }

      // Check if there's already an undelivered pending message
      const existing = await base44.asServiceRole.entities.PendingMessage.filter({ character_id: character.id, delivered: false });
      if (existing.length > 0) {
        results.push({ id: character.id, name: character.name, status: 'skipped', reason: 'Already has pending message' });
        continue;
      }

      const now = new Date();
      const timeOfDay = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
      const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
      const daysElapsed = Math.round(hoursSinceLastMessage / 24);

      const systemPrompt = character.system_prompt || '';

      // --- BUILD SCHEDULE CONTEXT ---
      let scheduleContext = '';
      if (userScheduleNotes) {
        scheduleContext = `\n\nUSER SCHEDULE: The person you're texting has this general schedule: "${userScheduleNotes}". Be mindful of this — don't text at times that feel intrusive. If it seems like a bad time given their schedule, you can still reach out but keep it brief and casual, not demanding of a response.`;
      } else {
        scheduleContext = `\n\nUSER SCHEDULE: You don't know the user's schedule. Based on your personality and how you're feeling, you might naturally weave in a curious question about when they're usually free — but ONLY if it genuinely fits the flow of what you'd say. Don't make it the main point unless your character would genuinely ask directly (e.g., a direct, blunt archetype). A more introverted or reserved character might hint at it softly or not ask at all.`;
      }

      // --- EMOTIONAL STATE TONE GUIDE ---
      const emotionToneGuides = {
        calm: "You're in a calm, balanced headspace. Your message is relaxed and natural — no urgency.",
        irritated: "You're a bit irritated right now. Your message might have a slightly sharp or impatient edge. You might vent a little or sound a bit short, but you're still reaching out.",
        defensive: "You're feeling defensive. You might reach out but it comes off a little guarded or tense. Keep it brief and don't overshare.",
        reflective: "You're in a reflective, introspective mood. Your message is thoughtful, maybe a little deep or melancholy. You might share something you've been thinking about.",
        "closed-off": "You're feeling closed off. This message is brief, maybe a bit cold or distant. You're reaching out but not opening up much.",
        flirtatious: "You're feeling playful and a little flirty. Your message has a fun, teasing energy.",
        bored: "You're bored out of your mind. You're reaching out mostly because you have nothing else going on. Your message shows it — casual, low-effort.",
        "burnt out": "You're exhausted and burnt out. Your message feels tired, maybe a bit defeated. Short and low energy.",
        joyful: "You're in a great mood! Your message is upbeat, warm, and enthusiastic.",
        anxious: "You're feeling anxious and a little on edge. You might be reaching out for reassurance or just company. There's a slight nervous energy in your words.",
        sad: "You're feeling sad or low. Your message might have a quiet, heavy tone. You're not fully yourself right now.",
        excited: "You're genuinely excited about something. Your message bursts with energy — you can barely contain it.",
        overwhelmed: "You're overwhelmed with everything going on. Your message might be a bit scattered or stressed.",
        content: "You're feeling peaceful and content. Your message is warm and easy — no pressure.",
        frustrated: "You're frustrated. Something's been bothering you. It may show in your tone — brief, maybe venting slightly.",
      };

      const toneGuide = emotionToneGuides[emotionalState] || emotionToneGuides['calm'];

      const prompt = `${systemPrompt}

---
SITUATION: It is ${dayOfWeek} at ${timeOfDay}. You haven't talked to the user in about ${daysElapsed} day${daysElapsed !== 1 ? 's' : ''}. You are deciding to reach out to them first.

RELATIONSHIP CONTEXT:
- Friendship: ${friendship}/100
- Respect: ${respect}/100
- Chosen Family: ${chosenFamily}/100
- Romantic feelings: ${romantic}/100
- Your current mood: ${emotionalState}
- Your personality/archetype: ${archetype || personalitySummary || 'not defined'}
- What's going on in your life right now: ${character.current_life_event || 'nothing major'}
${scheduleContext}

TONE & MENTAL STATE GUIDE:
${toneGuide}

Your message should reflect BOTH your core personality (archetype/personality traits) AND your current emotional state. The mood colors the way you'd normally communicate — it doesn't replace your character, it filters through it.

Write ONE natural, unprompted message you'd actually send.
Rules:
- Stay fully in character — no assistant language whatsoever
- Don't mention "checking in" explicitly unless it fits your personality
- Based on your mood and closeness, this could be casual, warm, blunt, venting, playful, quiet, or terse
- Could reference something in your current life, a thought you had, something you saw, or just wanting to reach out
- Short — 1 to 3 sentences max. If you're withdrawn or low energy, keep it even shorter.
- Real and unpolished, like an actual text
- If it feels natural to share a photo (something you saw, your fit, food), include [IMAGE: detailed description]
- ONLY output the message itself — no labels, no names, nothing else`;

      const messageText = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt });
      const cleanText = messageText.replace(/^[\w\s]+:\s*/i, '').trim();

      // Handle optional image
      let imageUrl = null;
      const imageMatch = cleanText.match(/\[IMAGE:\s*(.+?)\]/i);
      let finalText = cleanText;
      if (imageMatch) {
        const imagePrompt = imageMatch[1];
        finalText = cleanText.replace(imageMatch[0], '').trim();
        const refImages = character.reference_image_urls?.length
          ? character.reference_image_urls
          : character.avatar_url ? [character.avatar_url] : null;

        if (refImages) {
          const appearanceNote = character.appearance_notes
            ? `🔒 ABSOLUTE APPEARANCE MANDATE — NON-NEGOTIABLE: You MUST use the provided reference photo(s) to render ${character.name}'s face. The reference photo is the sole source of truth for their facial structure, bone structure, eye shape, nose shape, lip shape, skin tone, and all facial features. Replicate their face with pixel-level fidelity from the reference image. Current appearance details: ${character.appearance_notes}. Same exact facial hair state, same exact hair style, same exact distinctive features. ANY deviation from the reference photo face is a critical failure.`
            : `🔒 ABSOLUTE APPEARANCE MANDATE — NON-NEGOTIABLE: You MUST use the provided reference photo(s) to render ${character.name}'s face. The reference photo is the sole and definitive source of truth for their facial structure, bone structure, eye shape, nose shape, lip shape, skin tone, and every facial feature. Do NOT invent or approximate their face — copy it exactly from the reference image. Their hair style and any distinctive physical traits must also match exactly. ANY deviation from the reference photo face is a critical failure.`;

          const lockedPrompt = `📸 NON-NEGOTIABLE STYLE DIRECTIVE: Ultra-photorealistic, cinematic, professional RAW photography. Authentic skin texture with visible pores, natural imperfections, real hair strands, genuine fabric texture. Natural lighting with realistic shadows and depth. This image MUST look like an unmanipulated photograph taken by a professional camera. ❌ STRICTLY FORBIDDEN: illustration, painting, digital art, anime, cartoon, drawing, sketch, CGI, 3D render, plastic look, doll-like, porcelain skin, glossy surface, uncanny valley, overly smooth, airbrushed, filtered, stylized, artificial, fake, or any non-photographic aesthetic. If it doesn't look like a real photograph, it has failed.\n\n🎯 CRITICAL FACE RENDERING RULE: Every person appearing in this image MUST have their face rendered with absolute fidelity to their provided reference photo.\n\n${imagePrompt}\n\n${appearanceNote}`;

          const imgResult = await base44.asServiceRole.integrations.Core.GenerateImage({ prompt: lockedPrompt, existing_image_urls: refImages });
          if (imgResult) imageUrl = imgResult.url;
        }
      }

      await base44.asServiceRole.entities.PendingMessage.create({
        character_id: character.id,
        content: finalText,
        image_url: imageUrl || undefined,
        emotional_state: emotionalState,
        delivered: false,
      });

      results.push({ id: character.id, name: character.name, status: 'message_queued' });
    } catch (err) {
      results.push({ id: character.id, name: character.name, status: 'error', error: err.message });
    }
  }

  return Response.json({ results });
});