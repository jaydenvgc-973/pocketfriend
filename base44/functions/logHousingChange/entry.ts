import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, ownerEmail, housingType, timing, notes } = await req.json();
    if (!characterId) return Response.json({ error: 'Missing characterId' }, { status: 400 });

    // Verify character belongs to this user (owner_email authoritative, created_by fallback)
    let chars = await base44.asServiceRole.entities.Character.filter({ id: characterId, owner_email: user.email });
    if (!chars || chars.length === 0) {
      chars = await base44.asServiceRole.entities.Character.filter({ id: characterId, created_by: user.email });
    }
    const character = chars?.[0];
    if (!character) return Response.json({ error: 'Character not found or access denied' }, { status: 404 });

    const isHomeless = housingType === 'homeless';
    const isShelter = housingType === 'shelter';
    const isHotel = housingType === 'hotel';

    // Build character update payload
    const updatePayload = {
      is_homeless: isHomeless,
      housing_context: isHomeless
        ? 'homeless_unsheltered'
        : isShelter
          ? 'temporary_shelter'
          : 'stable_home',
    };

    // Clear temporary housing if moving to a permanent home
    if (housingType === 'home') {
      updatePayload.temporary_housing_location_id = null;
    }

    // Only update presence immediately if timing === 'immediate'
    if (timing === 'immediate') {
      if (isHomeless) {
        updatePayload.resolved_presence_status = 'home';
        updatePayload.resolved_current_location_name = 'No fixed address';
        updatePayload.resolved_current_location_id = null;
      }
    }

    await base44.asServiceRole.entities.Character.update(characterId, updatePayload);

    // Log as a LifeEvent for memory continuity
    const eventDesc = notes
      ? `${character.name} had a housing change (${housingType}). ${notes}`
      : `${character.name} had a housing change: ${housingType}.`;

    await base44.asServiceRole.entities.LifeEvent.create({
      character_id: characterId,
      character_name: character.name,
      event_type: 'location_change_event',
      valence: isHomeless ? 'negative' : 'neutral',
      severity: isHomeless ? 'significant' : 'moderate',
      title: `Housing change: ${housingType}`,
      description: eventDesc,
      emotional_impact: isHomeless ? 'Significant disruption to stability.' : 'A change in living situation.',
      triggered_by: 'user_message',
      timestamp: new Date().toISOString(),
      systems_updated: ['memory'],
    });

    return Response.json({ success: true, housingType, timing });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});