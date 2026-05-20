import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Returns the 6 characters pointing to personal home as compact list only.
 * NO WRITES.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const PERSONAL_HOME_ID = '69d03c56a5e65c211c8a6105';
    const FAMILY_HOME_ID   = '69d03c5558a81a27afb716eb';

    const all = await base44.entities.Character.list('-updated_date', 100);

    const pointingToPersonal = all.filter(c =>
      c.current_home_location_id === PERSONAL_HOME_ID ||
      c.home_location_id === PERSONAL_HOME_ID
    );

    // For each character, determine where they SHOULD live based on:
    // 1. Their original pre-corruption home (if any backup exists)
    // 2. Whether the Family Home location record lists them
    // 3. Whether they're in Ethan's family_members array

    // Read Ethan's character to check his family_members field
    const ethanId = '69c0d59d7e382cc866ded9c9';
    const ethanArr = all.filter(c => c.id === ethanId);
    const ethan = ethanArr[0] || null;

    const ethanFamilyMembers = ethan?.family_members || [];

    return Response.json({
      personal_home_id: PERSONAL_HOME_ID,
      family_home_id: FAMILY_HOME_ID,
      total_characters: all.length,
      ethan_family_members_array: ethanFamilyMembers.map(fm => ({
        name: fm.name,
        character_id: fm.character_id || fm.id || null,
        relationship_type: fm.relationship_type,
      })),
      pointing_to_personal_home: pointingToPersonal.map(c => ({
        id: c.id,
        name: c.name,
        character_type: c.character_type,
        current_home_location_id: c.current_home_location_id,
        resolved_current_location_id: c.resolved_current_location_id,
        resolved_current_location_name: c.resolved_current_location_name,
        resolved_source_reason: c.resolved_source_reason,
        // Is this character mentioned in Ethan's family_members array?
        in_ethan_family_members: ethanFamilyMembers.some(fm =>
          fm.character_id === c.id || fm.id === c.id || fm.name === c.name
        ),
        // Is the character Ethan himself?
        is_ethan: c.id === ethanId,
      })),
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});