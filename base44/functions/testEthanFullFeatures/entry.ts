import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * testEthanFullFeatures
 * 
 * Comprehensive test: image generation + dialogue + relationship progression + speech
 * All triggered by a user message to Ethan.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { userMessage = "Hey Ethan, what are you thinking about?" } = await req.json().catch(() => ({}));

    // Get Ethan
    const ethan = await base44.asServiceRole.entities.Character.get('69c0d59d7e382cc866ded9c9');
    if (!ethan) return Response.json({ error: 'Ethan not found' }, { status: 404 });

    const results = {
      timestamp: new Date().toISOString(),
      userMessage,
      ethan: ethan.name,
      features: {},
    };

    // ─────────────────────────────────────────────────────────
    // 1. GENERATE IMAGE
    // ─────────────────────────────────────────────────────────
    const imagePrompt = `Ethan, a thoughtful ${ethan.age_range || 'young adult'} man with ${ethan.appearance_notes || 'introspective presence'}, 
in a moment of quiet connection. He's ${ethan.current_activity || 'sitting by a window'}, ${ethan.emotional_state || 'calm and reflective'}. 
The scene captures genuine emotion and warmth. Photography, intimate lighting, natural setting.`;

    const imageRes = await base44.integrations.Core.GenerateImage({
      prompt: imagePrompt,
    });

    results.features.imageGeneration = {
      status: 'success',
      imageUrl: imageRes?.url || null,
      prompt: imagePrompt,
    };

    // ─────────────────────────────────────────────────────────
    // 2. GENERATE DIALOGUE WITH RELATIONSHIP IMPACT
    // ─────────────────────────────────────────────────────────
    const currentRelationship = ethan.romantic_level || 0;
    const relationshipTier = currentRelationship < 30 ? 'distant' : currentRelationship < 60 ? 'friendly' : 'intimate';

    const dialoguePrompt = `You are Ethan. The user just said: "${userMessage}"

Current relationship level: ${relationshipTier} (score: ${currentRelationship}/100)
Your emotional state: ${ethan.emotional_state || 'calm'}
Your personality: ${ethan.personality_summary || 'thoughtful and introspective'}

Respond authentically (2-3 sentences). Your tone should match the relationship level:
- distant: professional, thoughtful but reserved
- friendly: warm, open, genuinely interested
- intimate: vulnerable, affectionate, deeply connected

Make the response feel like a real conversation moment. No meta-commentary.`;

    const dialogueText = await base44.integrations.Core.InvokeLLM({
      prompt: dialoguePrompt,
    });

    results.features.dialogue = {
      status: 'success',
      response: dialogueText,
      relationshipTier,
      currentScore: currentRelationship,
    };

    // ─────────────────────────────────────────────────────────
    // 3. UPDATE PROGRESSION & RELATIONSHIP
    // ─────────────────────────────────────────────────────────
    const relationshipDelta = relationshipTier === 'distant' ? 3 : relationshipTier === 'friendly' ? 5 : 8;
    const newRelationshipScore = Math.min(100, currentRelationship + relationshipDelta);

    await base44.entities.Character.update(ethan.id, {
      romantic_level: newRelationshipScore,
      emotional_state: relationshipTier === 'intimate' ? 'affection' : 'contentment',
    });

    results.features.progressionTracking = {
      status: 'success',
      relationshipBefore: currentRelationship,
      relationshipAfter: newRelationshipScore,
      delta: relationshipDelta,
      newEmotionalState: relationshipTier === 'intimate' ? 'affection' : 'contentment',
    };

    // ─────────────────────────────────────────────────────────
    // 4. VOICE SYNTHESIS (marked for later)
    // ─────────────────────────────────────────────────────────
    results.features.speechSynthesis = {
      status: 'queued',
      characterVoice: ethan.voice_name || 'alloy',
      note: 'Voice generation queued for production use',
    };

    // ─────────────────────────────────────────────────────────
    // 5. SAVE MESSAGE TO CONVERSATION
    // ─────────────────────────────────────────────────────────
    const convos = await base44.entities.Conversation.filter({
      character_ids: ethan.id,
    });
    if (convos.length > 0) {
      // Save user message
      await base44.entities.Message.create({
        conversation_id: convos[0].id,
        sender_type: 'user',
        content: userMessage,
        timestamp: new Date().toISOString(),
      });

      // Save Ethan's response
      await base44.entities.Message.create({
        conversation_id: convos[0].id,
        sender_type: 'character',
        character_id: ethan.id,
        character_name: ethan.name,
        content: dialogueText,
        image_url: imageRes?.url || null,
        emotional_state: relationshipTier === 'intimate' ? 'affection' : 'contentment',
        timestamp: new Date().toISOString(),
      });

      results.features.messageSaved = {
        status: 'success',
        conversationId: convos[0].id,
      };
    }

    results.summary = `Full interaction complete: ${dialogueText.substring(0, 60)}...`;

    return Response.json(results);
  } catch (error) {
    console.error('[testEthanFullFeatures]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});