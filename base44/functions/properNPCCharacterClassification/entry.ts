import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * properNPCCharacterClassification
 * 
 * Analyze each character on murqart@gmail.com to determine if they are actual NPCs
 * vs. fully-developed creative characters with extensive backstories, system prompts, etc.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const targetEmail = 'murqart@gmail.com';

    // Get all characters
    const allChars = await base44.asServiceRole.entities.Character.filter({
      created_by: targetEmail,
    });

    const classification = {
      total_characters: allChars.length,
      likely_npcs: [],
      likely_active_creative_characters: [],
      needs_manual_review: [],
    };

    for (const char of allChars) {
      // Metrics to determine if character is a real creative character
      const hasSystemPrompt = !!char.system_prompt_url;
      const hasExtensiveBackstory = char.backstory && char.backstory.length > 200;
      const hasFamilyHistory = char.family_history && char.family_history.length > 100;
      const hasEmotionalTriggers = 
        (char.emotional_triggers_high?.length > 0) ||
        (char.emotional_triggers_medium?.length > 0) ||
        (char.emotional_triggers_deep?.length > 0);
      const hasPersonalityTraits = char.personality_traits && char.personality_traits.length > 0;
      const hasCommunicationStyle = !!char.communication_style;
      const hasQuirks = char.quirks && char.quirks.length > 0;
      const hasCurrentSituation = !!char.current_situation;
      const hasCharacterType = char.character_type === 'active';
      const hasRelationships = char.fictional_relationships && char.fictional_relationships.length > 3;
      const hasCloset = char.character_closet && char.character_closet.length > 0;
      const hasAvatarUrl = !!char.image_avatar_url || !!char.avatar_url;

      // Count creative indicators
      const creativeIndicators = [
        hasSystemPrompt,
        hasExtensiveBackstory,
        hasFamilyHistory,
        hasEmotionalTriggers,
        hasPersonalityTraits,
        hasCommunicationStyle,
        hasQuirks,
        hasCurrentSituation,
        hasCharacterType,
        hasRelationships,
        hasCloset,
        hasAvatarUrl,
      ].filter(Boolean).length;

      const analysis = {
        character_name: char.name,
        character_id: char.id,
        character_type: char.character_type,
        creative_indicators: creativeIndicators,
        has_system_prompt: hasSystemPrompt,
        has_extensive_backstory: hasExtensiveBackstory,
        has_family_history: hasFamilyHistory,
        has_emotional_triggers: hasEmotionalTriggers,
        has_personality_traits: hasPersonalityTraits,
        has_communication_style: hasCommunicationStyle,
        has_quirks: hasQuirks,
        has_current_situation: hasCurrentSituation,
        has_relationships: hasRelationships,
        has_closet: hasCloset,
        has_avatar: hasAvatarUrl,
        current_home_location_id: char.current_home_location_id,
        resolved_location_name: char.resolved_current_location_name,
      };

      // Classification logic
      if (creativeIndicators >= 7) {
        classification.likely_active_creative_characters.push(analysis);
      } else if (creativeIndicators <= 2) {
        classification.likely_npcs.push(analysis);
      } else {
        classification.needs_manual_review.push(analysis);
      }
    }

    return Response.json(classification);
  } catch (error) {
    console.error('[properNPCCharacterClassification]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});