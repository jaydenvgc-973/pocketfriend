import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditAvailableLocationsForMurqart
 * 
 * Check what locations are actually available and why some might be filtered out
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const targetEmail = 'murqart@gmail.com';
    const now = new Date();
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

    // Get all locations
    const [userLocations, sharedLocations] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.filter({ created_by: targetEmail }),
      base44.asServiceRole.entities.LocationReference.filter({ scope: 'shared' }),
    ]);

    const allLocations = [...userLocations, ...sharedLocations];

    // Check each location the user mentioned
    const targetNames = ['Escalita', 'Central Park', 'Jojo', 'BGC Medical'];
    const results = [];

    for (const loc of allLocations) {
      const matches = targetNames.some(name => 
        loc.name?.toLowerCase().includes(name.toLowerCase())
      );

      if (matches || loc.name?.includes('Park') || loc.name?.includes('Escalita') || loc.name?.includes('Jojo') || loc.name?.includes('BGC')) {
        // Check filtering rules from distributeVGCTowersNPCs
        const isVGCTowers = loc.id === '69e5af3008e572cf82f0b1b5'; // the newly created one
        const isHome = loc.category === 'home';
        const isCharacterSpecific = loc.location_type === 'character_specific' || loc.scope === 'character_specific';
        const isUserOwned = loc.created_by === targetEmail;
        const isShared = loc.scope === 'shared';

        // Check if closed
        let isClosed = false;
        if (loc.operating_hours && loc.operating_hours.length > 0) {
          const dayOfWeek = nowET.getDay();
          const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
          const todayHours = loc.operating_hours.filter(h => h.day_of_week === dayOfWeek);
          const dayAgnostic = loc.operating_hours.filter(h => h.day_of_week == null);
          const entries = todayHours.length > 0 ? todayHours : dayAgnostic;
          if (entries.length > 0) {
            isClosed = !entries.some(h => {
              const [oh, om] = h.open_time?.split(':').map(Number) || [0, 0];
              const [ch, cm] = h.close_time?.split(':').map(Number) || [23, 59];
              const openMin = oh * 60 + om;
              const closeMin = ch * 60 + cm;
              if (openMin <= closeMin) return currentMin >= openMin && currentMin <= closeMin;
              return currentMin >= openMin || currentMin <= closeMin;
            });
          }
        }

        const wouldBeFiltered = isVGCTowers || isHome || isCharacterSpecific || (!isUserOwned && !isShared) || isClosed;

        results.push({
          name: loc.name,
          id: loc.id,
          category: loc.category,
          scope: loc.scope,
          isVGCTowers,
          isHome,
          isCharacterSpecific,
          isUserOwned,
          isShared,
          isClosed,
          wouldBeFiltered,
          filterReason: wouldBeFiltered ? (
            isVGCTowers ? 'VGC Towers' :
            isHome ? 'Home category' :
            isCharacterSpecific ? 'Character-specific' :
            (!isUserOwned && !isShared) ? 'Not owned or shared' :
            isClosed ? 'Closed now' : 'Unknown'
          ) : 'VALID',
        });
      }
    }

    return Response.json({
      targetEmail,
      currentTimeET: nowET.toLocaleString('en-US', { timeZone: 'America/New_York' }),
      locations_checked: results,
      valid_social_locations: results.filter(r => !r.wouldBeFiltered).map(r => r.name),
    });
  } catch (error) {
    console.error('[auditAvailableLocationsForMurqart]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});