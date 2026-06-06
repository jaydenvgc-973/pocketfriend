import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * readMurqartVickForCopy
 * 
 * READ-ONLY diagnostic function.
 * Reads the canonical Vick Servicio character on murqart@gmail.com
 * using service role so we can copy the correct avatar, reference images,
 * and field values to reconstruct Vick on adobevgc@gmail.com.
 * 
 * DOES NOT MODIFY ANYTHING.
 * Admin only.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const MURQART_VICK_ID = '6a23580f06f68528940c6ddd';
    const MURQART_YARD_ID = '6a23580e6c67852d1b87d01e';

    // Read Vick character via service role — broad search across all npc_world_service
    const vickCandidates = await base44.asServiceRole.entities.Character.filter(
      { character_type: 'npc_world_service' },
      null, 50
    ).catch(() => []);

    console.log(`[readMurqartVickForCopy] Found ${vickCandidates.length} npc_world_service candidates`);
    vickCandidates.forEach(c => console.log(`  candidate: id=${c.id} name=${c.name} owner=${c.owner_email}`));

    const vick = vickCandidates.find(c => c.id === MURQART_VICK_ID) 
      || vickCandidates.find(c => c.owner_email === 'murqart@gmail.com')
      || null;

    // Read Recovery Yard via service role
    const yardResults = await base44.asServiceRole.entities.LocationReference.filter(
      { id: MURQART_YARD_ID },
      null, 1
    ).catch(() => []);

    const yard = yardResults[0] || null;

    if (!vick) {
      return Response.json({ success: false, error: 'Vick not found via service role' }, { status: 404 });
    }

    return Response.json({
      success: true,
      note: 'READ ONLY — no changes made. For copying to adobevgc@gmail.com.',
      vick: {
        id: vick.id,
        name: vick.name,
        primary_name: vick.primary_name,
        display_name: vick.display_name,
        full_name: vick.full_name,
        owner_email: vick.owner_email,
        character_type: vick.character_type,
        status: vick.status,
        is_world_service: vick.is_world_service,
        is_protected: vick.is_protected,
        protected_active: vick.protected_active,
        avatar_url: vick.avatar_url,
        image_avatar_url: vick.image_avatar_url,
        reference_image_urls: vick.reference_image_urls,
        appearance_notes: vick.appearance_notes,
        avatar_description_text: vick.avatar_description_text,
        gender: vick.gender,
        age: vick.age,
        appearance_age: vick.appearance_age,
        age_range: vick.age_range,
        ethnicities: vick.ethnicities,
        zodiac_sign: vick.zodiac_sign,
        occupation: vick.occupation,
        occupation_location_id: vick.occupation_location_id,
        occupation_location_name: vick.occupation_location_name,
        current_home_location_id: vick.current_home_location_id,
        resolved_current_location_id: vick.resolved_current_location_id,
        resolved_current_location_name: vick.resolved_current_location_name,
        profile_summary: vick.profile_summary,
        backstory: vick.backstory,
        current_situation: vick.current_situation,
        personality_summary: vick.personality_summary,
        communication_style: vick.communication_style,
        archetype: vick.archetype,
        style_identity: vick.style_identity,
        sleep_start_time: vick.sleep_start_time,
        wake_up_time: vick.wake_up_time,
        work_start_time: vick.work_start_time,
        work_end_time: vick.work_end_time,
        work_days: vick.work_days,
        exclude_from_homepage: vick.exclude_from_homepage,
      },
      yard: yard ? {
        id: yard.id,
        name: yard.name,
        owner_email: yard.owner_email,
        image_urls: yard.image_urls,
        zones: yard.zones,
        description: yard.description,
        features: yard.features,
        subtype: yard.subtype,
        operating_hours: yard.operating_hours,
      } : null,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});