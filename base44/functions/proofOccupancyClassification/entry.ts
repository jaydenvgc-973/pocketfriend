/**
 * proofOccupancyClassification
 *
 * Runs the EXACT occupancy classification logic from generateImageAsync
 * against real LocationReference records on the authenticated account.
 * Does NOT generate any images. Returns the resolved occupancy rule
 * for each real location/zone combination so the canonical prompt output
 * can be verified before any live image request.
 *
 * POST {} — uses requesting user's own account locations only.
 * Optional: { locationId, zoneName } to test a specific record.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── Exact copy of occupancy classification logic from generateImageAsync ──────
// Any change to generateImageAsync must be reflected here and vice versa.
function classifyOccupancy({ locationName, zoneName, locCategory, promptCue, isIso }) {
  const lnL = (locationName || '').toLowerCase();
  const zn  = (zoneName || '').toLowerCase();
  const lcCat = (locCategory || '').toLowerCase();

  const isConfinement = lcCat === 'jail_prison';
  const _PUB = ['social','food_drink','gym','religion','workplace','community','outdoor','business','medical','grocery','government','public'];
  const _znDorm = /\b(dorm|dormitory|residence hall|student housing|shared housing|open bay|pod|bunk)\b/.test(zn);
  const _znPub  = /\b(lobby|classroom|cafeteria|quad|library|hallway|lounge|dining|auditorium|reception|conference|ballroom|pool|rec center)\b/.test(zn);
  const _hotelPriv    = (lcCat === 'hotel')   && (!zn || /\b(room|suite|studio|private floor)\b/.test(zn)) && !_znPub;
  const _shelterPriv  = (lcCat === 'shelter') && (!zn || /\b(room|private room|single room)\b/.test(zn))   && !_znDorm && !_znPub;
  const _shelterShared= (lcCat === 'shelter') && (_znDorm || /\b(shared|common|bunk|communal)\b/.test(zn));
  const _schoolDorm   = (lcCat === 'school' || lcCat === 'education') && _znDorm;
  const _schoolPub    = (lcCat === 'school' || lcCat === 'education') && !_schoolDorm;

  const pLow = (promptCue || '').toLowerCase();

  const isResid = !isIso && !isConfinement && (
    lcCat === 'home' || _hotelPriv || _shelterPriv || _schoolDorm ||
    (lcCat !== 'hotel' && lcCat !== 'shelter' && lcCat !== 'school' && lcCat !== 'education' &&
     !_PUB.includes(lcCat) &&
     (/\b(home|apartment|bedroom|hotel room|residential suite|private residence)\b/.test(lnL) ||
      /\b(bedroom|living room|kitchen|bathroom|backyard|home office|residential)\b/.test(zn)))
  );

  const isPub = !isIso && !isConfinement && !isResid && (
    _PUB.includes(lcCat) || _schoolPub || (lcCat === 'hotel' && !_hotelPriv) || _shelterShared ||
    (lcCat !== 'home' && lcCat !== 'hotel' && lcCat !== 'shelter' &&
     (/\b(bar|nightclub|lounge|restaurant|diner|cafe|coffee shop|church|school|college|university|gym|fitness|park|stadium|arena|theater|cinema|venue|concert hall|mall|airport|shop|store|workplace|office|hospital|clinic|library|museum|casino|community center|sports bar)\b/.test(lnL) ||
      /\b(pool party|club|concert|beach party|festival|crowd)\b/i.test(pLow)))
  );

  const isStaffZone = !isConfinement && /\b(stockroom|stock room|back office|storage|break room|service area|staff area)\b/.test(zn);
  const isCrowded = isPub && /\b(packed|crowded|busy|swamped|lively|people everywhere|full house|standing room|sold out|noisy|loud|dance floor is full|line at the bar|shoulder to shoulder|wall to wall)\b/.test(pLow);

  // Confinement zone sub-classification
  const _jS  = isConfinement && /\b(solitary|isolation|iso|shu|special housing|the hole)\b/.test(zn);
  const _jSt = isConfinement && !_jS && /\b(staff|security|guard station|control room|warden|administrative)\b/.test(zn);
  const _jC  = isConfinement && !_jS && !_jSt && /\b(cell|holding cell|single cell|two.?man cell)\b/.test(zn);
  const _jD  = isConfinement && !_jS && !_jSt && /\b(dorm|dormitory|shared housing|open bay|pod)\b/.test(zn);
  const _jCm = isConfinement && !_jS && !_jSt && /\b(day room|common room|commons|dayroom|rec room)\b/.test(zn);
  const _jY  = isConfinement && !_jS && !_jSt && /\b(yard|recreation yard|exercise yard|weight room|outdoor rec)\b/.test(zn);
  const _jV  = isConfinement && !_jS && !_jSt && /\b(visitation|visiting room|visiting area|visitor|transport|intake|processing|medical bay|chapel)\b/.test(zn);

  const _jRule = _jS  ? 'SOLITARY/ISOLATION: ⛔ ZERO background people. Subject completely alone. No silhouettes, no other bodies.'
    : _jSt ? 'STAFF/SECURITY ZONE: Correctional officers only in background. ⛔ No incarcerated persons unless escorted. ⛔ No "customers," "patrons," or civilian crowd language.'
    : _jC  ? 'INDIVIDUAL CELL: Subject alone unless zone/prompt states shared/double-bunked. ⛔ No invented cellmate.'
    : _jD  ? 'DORMITORY/HOUSING UNIT: Background incarcerated persons at low controlled density — bunks, seated. Institutional calm. Not a crowd.'
    : _jCm ? 'DAY ROOM/COMMON AREA: Background incarcerated persons at moderate institutional activity — seated, TV, slow movement. Blurred, subordinate. Not party-packed.'
    : _jY  ? 'YARD/GYM/RECREATION: Background incarcerated persons at moderate density — exercising, standing. Institutional context. No party energy.'
    : _jV  ? 'VISITATION/INTAKE/MEDICAL: Staff, visitors, or incarcerated persons may be present if context supports. Controlled institutional setting.'
    : 'CONFINEMENT—UNSPECIFIED: Sparse institutional background. Low density if shared space implied. Default minimal. ⛔ No "customers," "patrons," or civilian crowd language.';

  const occRule = isIso ? 'ISOLATION ACTIVE: zero humans total. No hands, silhouettes, or reflections.'
    : isConfinement ? _jRule
    : isResid ? 'PRIVATE RESIDENTIAL: ⛔ DO NOT invent strangers, neighbors, visitors, or filler people. Occupancy = actual known presence only. Subject is alone unless otherwise established.'
    : isStaffZone ? 'STAFF-ONLY ZONE: Only appropriate staff/employees in background. ⛔ NO customers, patrons, or members of the public.'
    : isPub ? (isCrowded
        ? 'PUBLIC SOCIAL — ACTIVE CROWD: ✅ Background crowd IS part of scene reality — blurred, subordinate figures. ⛔ DO NOT erase the crowd.'
        : 'PUBLIC SOCIAL: Context-appropriate background figures permitted as out-of-focus environmental texture. Match natural activity level. ⛔ Do not make an active venue appear sterile.')
    : 'CONTEXT-APPROPRIATE: Active public spaces may have background figures (blurred, subordinate). Private/quiet spaces: minimal or none.';

  return {
    branch: isIso ? 'isolation' : isConfinement ? 'confinement' : isResid ? 'private_residential' : isStaffZone ? 'staff_zone' : isPub ? (isCrowded ? 'public_crowd' : 'public_social') : 'context_appropriate',
    occupancy_rule: occRule,
    flags: { isIso, isConfinement, isResid, isPub, isStaffZone, isCrowded, _hotelPriv, _shelterPriv, _shelterShared, _schoolDorm, _schoolPub, _znDorm, _znPub, _jS, _jSt, _jC, _jD, _jCm, _jY, _jV },
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { locationId: targetId, zoneName: targetZone, promptCue } = body;

    // ── Load locations for this user's account only ────────────────────────────
    const locations = await base44.asServiceRole.entities.LocationReference.filter(
      { owner_email: user.email }, '-updated_date', 200
    ).catch(() => []);

    // Also load shared locations
    const sharedLocs = await base44.asServiceRole.entities.LocationReference.filter(
      { scope: 'shared' }, '-updated_date', 100
    ).catch(() => []);

    const allLocs = [...locations, ...sharedLocs];

    if (allLocs.length === 0) {
      return Response.json({ error: 'No locations found for this account', user_email: user.email });
    }

    // ── If a specific location requested, test it with all its zones ──────────
    if (targetId) {
      const loc = allLocs.find(l => l.id === targetId);
      if (!loc) return Response.json({ error: `Location ${targetId} not found on account` });

      const zones = (loc.zones || []).map(z => z.zone_name).filter(Boolean);
      const testZones = targetZone ? [targetZone] : (zones.length > 0 ? zones : [null]);

      const results = testZones.map(zn => {
        const result = classifyOccupancy({
          locationName: loc.name,
          zoneName: zn || '',
          locCategory: loc.category || 'generic',
          promptCue: promptCue || '',
          isIso: false,
        });
        return {
          location: loc.name,
          location_id: loc.id,
          category: loc.category,
          zone: zn || '(no zone)',
          description_snippet: loc.description ? loc.description.substring(0, 80) : null,
          ...result,
        };
      });

      return Response.json({ tested: results.length, results, location_zones: zones });
    }

    // ── Auto-test: find representative locations across all categories ─────────
    const TARGET_CATEGORIES = [
      'home', 'hotel', 'shelter', 'social', 'food_drink', 'religion',
      'education', 'school', 'gym', 'workplace', 'business', 'jail_prison',
      'medical', 'grocery', 'community', 'outdoor', 'government', 'public', 'generic',
    ];

    const results = [];

    for (const cat of TARGET_CATEGORIES) {
      const matching = allLocs.filter(l => l.category === cat);
      if (matching.length === 0) continue;

      // Use the first matching location
      const loc = matching[0];
      const zones = (loc.zones || []).map(z => z.zone_name).filter(Boolean);

      // Test with no zone
      results.push({
        location: loc.name,
        location_id: loc.id,
        category: cat,
        zone: '(no zone)',
        description_snippet: loc.description ? loc.description.substring(0, 80) : null,
        ...classifyOccupancy({ locationName: loc.name, zoneName: '', locCategory: cat, promptCue: promptCue || '', isIso: false }),
      });

      // Test each named zone
      for (const zn of zones) {
        results.push({
          location: loc.name,
          location_id: loc.id,
          category: cat,
          zone: zn,
          description_snippet: loc.description ? loc.description.substring(0, 80) : null,
          ...classifyOccupancy({ locationName: loc.name, zoneName: zn, locCategory: cat, promptCue: promptCue || '', isIso: false }),
        });
      }
    }

    // ── Also surface the description gap ──────────────────────────────────────
    // Find any location where description exists and category/zone alone may be insufficient.
    // This is the "location description not used" gap the user flagged.
    const descriptionGapCandidates = allLocs.filter(l =>
      l.description && l.description.length > 20 &&
      (!l.category || l.category === 'generic') &&
      (!l.zones || l.zones.length === 0)
    ).slice(0, 5);

    const descGapResults = descriptionGapCandidates.map(loc => ({
      location: loc.name,
      location_id: loc.id,
      category: loc.category || 'generic',
      zone: '(no zone)',
      description_full: loc.description,
      note: 'DESCRIPTION_GAP: This location has a description but category=generic and no zones. The occupancy classifier cannot read the description — it will fall through to CONTEXT-APPROPRIATE. If the description implies a specific space type, the category or zones should be set accordingly.',
      ...classifyOccupancy({ locationName: loc.name, zoneName: '', locCategory: loc.category || 'generic', promptCue: '', isIso: false }),
    }));

    // ── Summary by branch ─────────────────────────────────────────────────────
    const branchCounts = {};
    for (const r of results) {
      branchCounts[r.branch] = (branchCounts[r.branch] || 0) + 1;
    }

    return Response.json({
      account: user.email,
      total_locations_loaded: allLocs.length,
      test_cases_run: results.length,
      branch_summary: branchCounts,
      description_gap_candidates: descGapResults.length,
      results,
      description_gap_locations: descGapResults,
      classification_note: 'Location description is NOT currently read by the classifier. The classifier uses: (1) category, (2) zone name keywords, (3) prompt cue keywords, (4) location name keywords as fallback. If a location has meaningful description but generic/missing category and no zones, it will fall to CONTEXT-APPROPRIATE. Fix: set the correct category and add named zones to the LocationReference record.',
    });

  } catch (error) {
    console.error('[proofOccupancyClassification]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});