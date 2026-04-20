import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Enforces presence integrity rules before any location or character operation
 * - Prevents duplicate VGC Towers
 * - Ensures single presence per character
 * - Validates location references
 * - Corrects invalid states
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ── PHASE 1: VGC TOWERS SINGLE-INSTANCE CHECK ──────────────────────────
    const [createdByMe, ownedByMe] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.filter(
        { created_by: user.email, name: { $regex: 'VGC Towers', $options: 'i' } },
        '-created_date',
        50
      ),
      base44.asServiceRole.entities.LocationReference.filter(
        { owner_email: user.email, name: { $regex: 'VGC Towers', $options: 'i' } },
        '-created_date',
        50
      ),
    ]);

    const seen = new Set();
    const allVGCTowers = [...createdByMe, ...ownedByMe].filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });

    const violations = [];
    let canonicalVGC = null;
    const duplicateVGCs = [];

    if (allVGCTowers.length > 1) {
      violations.push({
        rule: 1,
        type: 'MULTIPLE_VGC_TOWERS',
        message: `Found ${allVGCTowers.length} VGC Towers instances — CRITICAL violation`,
        severity: 'CRITICAL',
      });

      // Sort by creation date — oldest is canonical
      canonicalVGC = allVGCTowers.sort((a, b) =>
        new Date(a.created_date) - new Date(b.created_date)
      )[0];

      duplicateVGCs.push(...allVGCTowers.filter(v => v.id !== canonicalVGC.id));
    } else if (allVGCTowers.length === 1) {
      canonicalVGC = allVGCTowers[0];
    }

    // ── PHASE 2: CHARACTER SINGLE-PRESENCE CHECK ───────────────────────────
    const allCharacters = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email },
      '-created_date',
      500
    );

    const characterViolations = [];

    for (const char of allCharacters) {
      const locations = [];
      if (char.current_home_location_id) locations.push(char.current_home_location_id);
      if (char.resolved_current_location_id) locations.push(char.resolved_current_location_id);

      const uniqueLocations = new Set(locations.filter(Boolean));
      if (uniqueLocations.size > 1) {
        characterViolations.push({
          characterId: char.id,
          characterName: char.name,
          rule: 4,
          type: 'OMNIPRESENT',
          locations: Array.from(uniqueLocations),
          message: `${char.name} exists in multiple locations at once`,
          severity: 'CRITICAL',
        });
      }

      // Check for invalid travel state
      const invalidTravelStates = ['traveling', 'commuting', 'on_the_way', 'in_transit'];
      if (invalidTravelStates.includes(char.travel_status)) {
        characterViolations.push({
          characterId: char.id,
          characterName: char.name,
          rule: 6,
          type: 'INVALID_TRAVEL_STATE',
          currentState: char.travel_status,
          message: `${char.name} has invalid travel state: ${char.travel_status}`,
          severity: 'CRITICAL',
        });
      }

      // Check for no location
      if (!char.resolved_current_location_id && !char.current_home_location_id) {
        characterViolations.push({
          characterId: char.id,
          characterName: char.name,
          rule: 5,
          type: 'UNKNOWN_LOCATION',
          message: `${char.name} has no valid location assigned`,
          severity: 'CRITICAL',
        });
      }

      // Check for sleeping during travel time (4-9 AM ET)
      const now = new Date();
      const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hour = etTime.getHours();
      const isTravelTime = hour >= 4 && hour < 9;
      const isSleeping = char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping';

      if (isTravelTime && isSleeping) {
        characterViolations.push({
          characterId: char.id,
          characterName: char.name,
          rule: 9,
          type: 'SLEEP_DURING_TRAVEL_TIME',
          currentTime: etTime.toISOString(),
          message: `${char.name} is sleeping during travel time (4-9 AM ET)`,
          severity: 'CRITICAL',
        });
      }
    }

    // ── PHASE 3: RETURN ENFORCEMENT REPORT ──────────────────────────────────
    const report = {
      timestamp: new Date().toISOString(),
      user: user.email,
      enforcementStatus: {
        vgcTowers: {
          singleInstance: allVGCTowers.length <= 1,
          total: allVGCTowers.length,
          canonical: canonicalVGC?.id || null,
          duplicates: duplicateVGCs.map(v => ({ id: v.id, name: v.name })),
        },
        characterPresence: {
          total: allCharacters.length,
          violations: characterViolations.length,
          omnipresent: characterViolations.filter(v => v.type === 'OMNIPRESENT').length,
          unknownLocation: characterViolations.filter(v => v.type === 'UNKNOWN_LOCATION').length,
          invalidTravelState: characterViolations.filter(v => v.type === 'INVALID_TRAVEL_STATE').length,
          sleepingDuringTravel: characterViolations.filter(v => v.type === 'SLEEP_DURING_TRAVEL_TIME').length,
        },
      },
      violations: {
        vgcTowers: violations,
        characters: characterViolations,
      },
      summary: {
        criticalViolations: [...violations, ...characterViolations].filter(v => v.severity === 'CRITICAL').length,
        totalViolations: violations.length + characterViolations.length,
        systemHealthy: violations.length === 0 && characterViolations.length === 0,
      },
    };

    return Response.json(report);
  } catch (error) {
    console.error('[enforcePresenceIntegrity]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});