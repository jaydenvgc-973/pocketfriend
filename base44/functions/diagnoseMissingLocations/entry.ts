import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Just call fetchAllLocationsForUser logic directly and return name list
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const allLocations = await base44.asServiceRole.entities.LocationReference.list('-created_date', 500);
  const userCharacters = await base44.entities.Character.filter({ created_by: user.email }, '-created_date', 500);
  const userCharacterIds = new Set(userCharacters.map(c => c.id));
  userCharacterIds.add(user.id); // user's own built-in entity ID (covers Jayden's Place)

  const charLinkedLocationIds = new Set();
  for (const char of userCharacters) {
    if (char.occupation_location_id) charLinkedLocationIds.add(char.occupation_location_id);
    if (char.education_location_id) charLinkedLocationIds.add(char.education_location_id);
    if (char.current_home_location_id) charLinkedLocationIds.add(char.current_home_location_id);
    if (char.resolved_current_location_id) charLinkedLocationIds.add(char.resolved_current_location_id);
    if (char.current_work_location_id) charLinkedLocationIds.add(char.current_work_location_id);
    if (char.current_school_location_id) charLinkedLocationIds.add(char.current_school_location_id);
  }

  const relevant = allLocations.filter(loc => {
    if (loc.owner_email && loc.owner_email === user.email) return true;
    if (!loc.owner_email && loc.created_by === user.email) return true;
    const isCharSpecificType = loc.location_type === 'character_specific' || loc.scope === 'character_specific';
    if (isCharSpecificType) {
      if (loc.owner_character_id && userCharacterIds.has(loc.owner_character_id)) return true;
      if (loc.assigned_character_id && userCharacterIds.has(loc.assigned_character_id)) return true;
      if (loc.character_id && userCharacterIds.has(loc.character_id)) return true;
      if (loc.resident_character_ids?.some(id => userCharacterIds.has(id))) return true;
    }
    if (charLinkedLocationIds.has(loc.id)) {
      const locOwner = loc.owner_email || null;
      if (!locOwner || locOwner === user.email) return true;
      return false;
    }
    if (loc.resident_character_ids?.some(id => userCharacterIds.has(id))) {
      if (!loc.owner_email || loc.owner_email === user.email) return true;
    }
    const isAdminCreated = loc.created_by_role === 'admin' || loc.is_generic_shared === true;
    const isSharedScope = loc.scope === 'shared' || loc.location_type === 'shared';
    if (isAdminCreated && isSharedScope) return true;
    if (!loc.owner_email && loc.scope !== 'account_global' && loc.location_type !== 'character_specific') return true;
    return false;
  });

  relevant.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const excluded = allLocations.filter(loc => !relevant.find(r => r.id === loc.id));

  return Response.json({
    user_email: user.email,
    user_id: user.id,
    total_in_db: allLocations.length,
    included_count: relevant.length,
    excluded_count: excluded.length,
    included_names: relevant.map(l => l.name),
    excluded: excluded.map(l => ({ name: l.name, owner_email: l.owner_email, owner_character_id: l.owner_character_id, location_type: l.location_type })),
  });
});