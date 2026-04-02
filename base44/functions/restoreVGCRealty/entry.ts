import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Check if VGC Realty already exists
    const existing = await base44.asServiceRole.entities.LocationReference.filter(
      { created_by: user.email, name: 'VGC Realty' }
    );

    if (existing.length > 0) {
      return Response.json({ success: true, id: existing[0].id, message: 'VGC Realty already exists' });
    }

    // Create VGC Realty location
    const vgcRealty = await base44.asServiceRole.entities.LocationReference.create({
      name: 'VGC Realty',
      location_type: 'global',
      category: 'business',
      description: 'Real estate office where NPCs and characters work and gather.',
      owner_is_npc: true,
      owner_npc_name: 'VGC Realty Manager',
      owner_role: 'manager',
      resident_character_ids: [],
      resident_character_names: [],
      zones: [
        { zone_name: 'Office', image_urls: [] },
        { zone_name: 'Lobby', image_urls: [] },
      ],
    });

    return Response.json({ success: true, id: vgcRealty.id, message: 'VGC Realty restored' });
  } catch (error) {
    console.error('[restoreVGCRealty]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});