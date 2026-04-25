import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * STRICT DISCOVERY: active_created_character ONLY
 * 
 * Returns ONLY records where:
 * - character_type === "active_created_character"
 * - owner_email === current user email
 * - is_test_character !== true
 * - diagnostic_only !== true
 * - exclude_from_homepage !== true
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    console.log('=== STRICT ACTIVE_CREATED_CHARACTER DISCOVERY ===');
    console.log('User:', user.email);

    // Query ONLY active_created_character with owner_email filter
    console.log('\n[QUERY] Filtering: character_type="active_created_character" AND owner_email=user.email');
    
    const characters = await base44.entities.Character.filter({
      character_type: "active_created_character",
      owner_email: user.email
    }, "-created_date", 100);

    console.log(`Raw query returned: ${characters.length} characters`);

    // Apply exclusion filters
    const filtered = characters.filter(c => {
      if (c.is_test_character === true) {
        console.log(`  EXCLUDED: ${c.name} (is_test_character=true)`);
        return false;
      }
      if (c.diagnostic_only === true) {
        console.log(`  EXCLUDED: ${c.name} (diagnostic_only=true)`);
        return false;
      }
      if (c.exclude_from_homepage === true) {
        console.log(`  EXCLUDED: ${c.name} (exclude_from_homepage=true)`);
        return false;
      }
      console.log(`  ✅ INCLUDED: ${c.name}`);
      return true;
    });

    console.log(`\nFinal filtered count: ${filtered.length}`);

    // Show each character with full details
    const details = filtered.map((c, idx) => ({
      rank: idx + 1,
      name: c.name,
      id: c.id,
      character_type: c.character_type,
      owner_email: c.owner_email,
      is_test_character: c.is_test_character,
      diagnostic_only: c.diagnostic_only,
      exclude_from_homepage: c.exclude_from_homepage,
      current_location: c.resolved_current_location_name,
      location_id: c.resolved_current_location_id,
      status: c.status,
    }));

    return Response.json({
      user: user.email,
      query_filter: {
        character_type: "active_created_character",
        owner_email: user.email,
      },
      exclusions: [
        "is_test_character = true",
        "diagnostic_only = true",
        "exclude_from_homepage = true"
      ],
      results: {
        raw_query_count: characters.length,
        after_filter_count: filtered.length,
        characters: details
      },
      ready_for_movement_test: filtered.length > 0 ? `✅ ${filtered.length} characters available` : '❌ No eligible characters'
    });

  } catch (error) {
    console.error('Discovery error:', error);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});