import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * FINAL LOCATION TRUTH VERIFICATION
 * Lightweight check of card + registry + travel consistency
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Lightweight query
    const chars = await base44.entities.Character.filter(
      { created_by: user.email, status: 'active', character_type: 'active' },
      '-updated_date',
      10
    );
    
    const locs = await base44.entities.LocationReference.list();
    const locMap = Object.fromEntries(locs.map(l => [l.id, l]));

    const results = chars.map((char) => {
      // Authoritative location
      const authLocId = char.occupation_location_id || char.education_location_id || char.current_home_location_id;
      const authLoc = authLocId ? locMap[authLocId] : null;

      // Current location field
      const currentLocId = char.current_location_id;
      const currentLoc = currentLocId ? locMap[currentLocId] : null;

      // Card display
      const cardLabel = authLoc ? `at ${authLoc.name}` : 'available';

      // Registry check
      const registered = authLoc && (
        authLoc.resident_character_ids?.includes(char.id) ||
        authLoc.worker_character_ids?.includes(char.id)
      );

      // Cohesive if: current_location is set AND matches authoritative AND registered in that location
      const cohesive = currentLocId === authLocId && registered;

      return {
        name: char.name,
        authLoc: authLoc?.name || 'none',
        currentLoc: currentLoc?.name || 'none',
        cardWillShow: cardLabel,
        registeredInLoc: registered,
        cohesive
      };
    });

    const cohesiveCount = results.filter(r => r.cohesive).length;

    return Response.json({
      timestamp: new Date().toISOString(),
      results,
      cohesiveCount: `${cohesiveCount}/${results.length}`,
      allCoherent: cohesiveCount === results.length,
      verdict: cohesiveCount === results.length ? 'LOCATION_TRUTH_UNIFIED' : 'STILL_REPAIRING'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});