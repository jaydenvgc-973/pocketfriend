import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const ETHAN_ID = '69c0d59d7e382cc866ded9c9';
  const chars = await base44.asServiceRole.entities.Character.filter({ id: ETHAN_ID });
  const ethan = chars[0];
  if (!ethan) return Response.json({ error: 'Ethan not found' }, { status: 404 });

  // Get world name for this account
  const settings = await base44.asServiceRole.entities.UserSettings.filter({ created_by: user.email });
  const worldName = settings[0]?.fictional_world_name || 'Jayden';

  const relationships = ethan.fictional_relationships || [];
  const markRefs = [];
  let modified = false;

  const fixed = relationships.map(rel => {
    let changed = false;
    const newRel = { ...rel };

    // Check every string field for "Mark"
    for (const key of Object.keys(newRel)) {
      if (typeof newRel[key] === 'string' && /\bMark\b/i.test(newRel[key])) {
        markRefs.push({ field: key, original: newRel[key], rel_name: rel.person_name });
        newRel[key] = newRel[key].replace(/\bMark\b/gi, worldName);
        changed = true;
      }
    }
    if (changed) modified = true;
    return newRel;
  });

  // Also scan profile_summary, personality_summary, background_story, current_situation for "Mark"
  const textFields = ['profile_summary', 'personality_summary', 'background_story', 'current_situation', 'current_life_event', 'daily_micro_narration'];
  const fieldPatches = {};
  for (const field of textFields) {
    if (typeof ethan[field] === 'string' && /\bMark\b/i.test(ethan[field])) {
      markRefs.push({ field, original: ethan[field] });
      fieldPatches[field] = ethan[field].replace(/\bMark\b/gi, worldName);
    }
  }

  const updatePayload = {};
  if (modified) updatePayload.fictional_relationships = fixed;
  Object.assign(updatePayload, fieldPatches);

  if (Object.keys(updatePayload).length > 0) {
    await base44.asServiceRole.entities.Character.update(ETHAN_ID, updatePayload);
  }

  return Response.json({
    success: true,
    worldName,
    markRefsFound: markRefs.length,
    markRefs,
    fieldsPatched: Object.keys(updatePayload),
    relationshipsScanned: relationships.length,
    summary: markRefs.length === 0
      ? 'No "Mark" references found in Ethan\'s relationships or profile fields.'
      : `Found and fixed ${markRefs.length} "Mark" references.`
  });
});