import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const results = [];

    // ── STEP 1: Load test character ──────────────────────────────────────
    const allChars = await base44.entities.Character.filter(
      { owner_email: user.email, status: 'active', is_test_character: true },
      '-updated_date', 1
    );
    const testChar = allChars[0];

    if (!testChar) {
      return Response.json({ error: 'No test character found' }, { status: 404 });
    }
    results.push({ step: 'loaded_test_char', char_name: testChar.name });

    // ── STEP 2: Load locations ───────────────────────────────────────────
    const locations = await base44.entities.LocationReference.filter({ owner_email: user.email });
    const destLoc = locations.find(l => 
      l.id !== testChar.resolved_current_location_id && 
      l.category !== 'home'
    );

    if (!destLoc) {
      return Response.json({ error: 'No valid destination found' }, { status: 404 });
    }
    results.push({ step: 'found_destination', dest_name: destLoc.name });

    // ── STEP 3: Create TravelSession using asServiceRole ───────────────────
    const travelSession = await base44.asServiceRole.entities.TravelSession.create({
      character_id: testChar.id,
      destination_location_id: destLoc.id,
      travel_reason: 'proof_of_direct_creation',
      travel_source: 'autonomous_need',
      owner_email: testChar.owner_email,
    });

    results.push({ step: 'created_travel_session', session_id: travelSession.id });

    return Response.json({ success: true, results, travel_session_id: travelSession.id });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});