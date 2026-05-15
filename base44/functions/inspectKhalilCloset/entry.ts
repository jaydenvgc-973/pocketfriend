import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  // Search all characters for Khalil — use user scope since RLS requires auth
  let all = [];
  if (user) {
    all = await base44.entities.Character.list('-updated_date', 200);
  } else {
    all = await base44.asServiceRole.entities.Character.list('-updated_date', 200);
  }
  const khalil = all.find(c => c.name && c.name.toLowerCase().includes('khalil'));

  if (!khalil) {
    return Response.json({ error: 'Khalil not found', total_checked: all.length, names: all.map(c => c.name).sort() });
  }

  return Response.json({
    id: khalil.id,
    name: khalil.name,
    status: khalil.status,
    owner_email: khalil.owner_email,
    current_outfit: khalil.current_outfit,
    character_closet: khalil.character_closet,
    appearance_lock: khalil.appearance_lock,
    reference_image_urls: khalil.reference_image_urls,
    avatar_url: khalil.avatar_url,
    resolved_presence_status: khalil.resolved_presence_status,
    current_activity: khalil.current_activity,
  });
});