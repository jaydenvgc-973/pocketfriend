import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * revertActiveCharactersFromVGC
 * 
 * Remove the 5 active creative characters from VGC Towers resident_family_members
 * They should NOT be lumped with true NPCs—they have homes of their own
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

    // Identify active creative characters (7+ creative indicators)
    const activeCreativeChars = [];

    for (const char of allChars) {
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

      if (creativeIndicators >= 7 && char.character_type === 'active') {
        activeCreativeChars.push({
          id: char.id,
          name: char.name,
          current_home_location_id: char.current_home_location_id,
        });
      }
    }

    // Get VGC Towers
    const vgcList = await base44.asServiceRole.entities.LocationReference.filter({
      created_by: targetEmail,
      name: 'VGC Towers',
    });

    const vgc = vgcList[0];
    if (!vgc) {
      return Response.json({ error: 'VGC Towers not found' }, { status: 400 });
    }

    // Remove active creative characters from resident_family_members
    const currentFamilyMembers = vgc.resident_family_members || [];
    const filteredMembers = currentFamilyMembers.filter(member => {
      const isActiveChar = activeCreativeChars.some(c => c.name === member.name);
      return !isActiveChar;
    });

    await base44.asServiceRole.entities.LocationReference.update(vgc.id, {
      resident_family_members: filteredMembers,
    });

    return Response.json({
      account_email: targetEmail,
      vgc_towers_id: vgc.id,
      active_creative_chars_reverted: activeCreativeChars.map(c => ({
        name: c.name,
        id: c.id,
        home_location_id: c.current_home_location_id,
      })),
      total_removed_from_vgc: activeCreativeChars.length,
      remaining_family_members_in_vgc: filteredMembers.length,
      success: true,
    });
  } catch (error) {
    console.error('[revertActiveCharactersFromVGC]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});