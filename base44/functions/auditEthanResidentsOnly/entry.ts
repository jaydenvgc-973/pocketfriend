import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditEthanResidentsOnly
 * Returns ONLY the characters pointing to Ethan's personal home,
 * and the family-named characters with their exact home fields.
 * Minimal payload to avoid truncation.
 * NO WRITES.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const PERSONAL_HOME_ID = '69d03c56a5e65c211c8a6105'; // Ethan Thompson's Home
    const FAMILY_HOME_ID   = '69d03c5558a81a27afb716eb'; // Ethan's Family Home

    const all = await base44.entities.Character.list('-updated_date', 100);

    const fmt = (c) => ({
      id: c.id,
      name: c.name,
      character_type: c.character_type,
      current_home_location_id: c.current_home_location_id,
      home_location_id: c.home_location_id || null,
      resolved_current_location_id: c.resolved_current_location_id,
      resolved_current_location_name: c.resolved_current_location_name,
      resolved_source_reason: c.resolved_source_reason,
    });

    const pointingToPersonal = all.filter(c =>
      c.current_home_location_id === PERSONAL_HOME_ID ||
      c.home_location_id === PERSONAL_HOME_ID
    );

    const pointingToFamily = all.filter(c =>
      c.current_home_location_id === FAMILY_HOME_ID ||
      c.home_location_id === FAMILY_HOME_ID
    );

    const resolvedAtPersonal = all.filter(c =>
      c.resolved_current_location_id === PERSONAL_HOME_ID
    );

    const withCorrupted = all.filter(c =>
      c.resolved_source_reason === 'fixed_corrupted_home_id'
    );

    const familyNamed = all.filter(c =>
      ['stephanie', 'sarah', 'larry', 'linda', 'thomas', 'vanessa', 'marisol'].some(n =>
        c.name?.toLowerCase().includes(n)
      )
    );

    return Response.json({
      total_chars: all.length,
      pointing_to_PERSONAL_home: {
        count: pointingToPersonal.length,
        characters: pointingToPersonal.map(fmt),
      },
      pointing_to_FAMILY_home: {
        count: pointingToFamily.length,
        characters: pointingToFamily.map(fmt),
      },
      resolved_AT_personal_home: {
        count: resolvedAtPersonal.length,
        characters: resolvedAtPersonal.map(fmt),
      },
      corrupted_home_flag: {
        count: withCorrupted.length,
        characters: withCorrupted.map(fmt),
      },
      family_named_characters: {
        count: familyNamed.length,
        characters: familyNamed.map(fmt),
      },
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});