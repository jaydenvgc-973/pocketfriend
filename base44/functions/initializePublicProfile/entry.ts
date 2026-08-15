import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    let payload = {};
    try { payload = await req.json(); } catch (_) {}
    const { character_id, owner_email, initial_values } = payload;

    if (!character_id) return Response.json({ error: 'character_id required' }, { status: 400 });
    const effectiveOwnerEmail = owner_email || user?.email;
    if (!effectiveOwnerEmail) return Response.json({ error: 'owner_email required' }, { status: 401 });

    // Check for existing profile
    const existing = await base44.asServiceRole.entities.PublicProfile.filter(
      { character_id, owner_email: effectiveOwnerEmail }, null, 1
    );
    if (existing[0]) return Response.json({ public_profile: existing[0], created: false });

    // Load character name
    const chars = await base44.asServiceRole.entities.Character.filter({ id: character_id }, null, 1);
    const charName = chars[0]?.name || chars[0]?.display_name || 'Character';

    const profile = await base44.asServiceRole.entities.PublicProfile.create({
      character_id,
      character_name: charName,
      owner_email: effectiveOwnerEmail,
      recognition_level: initial_values?.recognition_level || 'unknown',
      recognition_scope: initial_values?.recognition_scope || 'none',
      recognition_locked: initial_values?.recognition_locked || false,
      current_attention: initial_values?.current_attention || 0,
      attention_scope: initial_values?.attention_scope || 'none',
      respect_level: initial_values?.respect_level || 0,
      respect_contexts: initial_values?.respect_contexts || {},
      notoriety_level: initial_values?.notoriety_level || 0,
      infamy_level: initial_values?.infamy_level || 0,
      reputation_contexts: initial_values?.reputation_contexts || {},
      public_image: initial_values?.public_image || null,
      public_persona: initial_values?.public_persona || null,
      known_for: initial_values?.known_for || [],
      world_perception: null,
      world_perception_insufficient: true,
      public_record: [],
      locks: {},
      last_attention_decay_at: new Date().toISOString(),
    });

    return Response.json({ public_profile: profile, created: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});