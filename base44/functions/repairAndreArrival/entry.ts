/**
 * repairAndreArrival
 *
 * Repairs Andre Rivera's stuck travel state using his existing TravelSession destination.
 * Uses user-scoped update (base44.entities) since asServiceRole.Character.update hits RLS too.
 * The user calling this function is the owner, so user-scoped write is correct.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ANDRE_ID = '69cd1c421ecd8b69850b3a6a';
    const SESSION_ID = '6a0ee95057b83e3a9fcc7aa6';
    const JOJOS_ID = '69d7221e5e3dafcc7357fc35';
    const ARRIVAL_TIME = '2026-05-21T12:56:24.857Z';

    // BEFORE state — user-scoped read (owner's query, works for owned characters)
    const allChars = await base44.entities.Character.filter({ owner_email: user.email }, '-updated_date', 200);
    const charBefore = allChars.find(c => c.id === ANDRE_ID);
    
    if (!charBefore) {
      return Response.json({ success: false, error: 'Andre Rivera not found for this user' }, { status: 404 });
    }

    const sessionBefore = (await base44.asServiceRole.entities.TravelSession.filter({ id: SESSION_ID }, null, 1))?.[0];

    console.log(`[repairAndreArrival] BEFORE: location=${charBefore.resolved_current_location_name}, travel_status=${charBefore.travel_status}, traveling_to=${charBefore.traveling_to_location_name}`);

    // Update using user-scoped API — this is the owner's request, RLS allows it
    await base44.entities.Character.update(ANDRE_ID, {
      resolved_current_location_id: JOJOS_ID,
      resolved_current_location_name: "JoJo's Bar & Grill ",
      resolved_presence_status: 'visiting',
      resolved_location_type: 'visit',
      resolved_source_reason: `repaired_from_failed_arrival:${SESSION_ID}`,
      resolved_last_updated_at: ARRIVAL_TIME,
      last_arrived_time: ARRIVAL_TIME,
      travel_status: 'not_traveling',
      traveling_to_location_id: null,
      traveling_to_location_name: null,
      travel_destination_location_id: null,
    });

    // Read back verification (user-scoped)
    const allCharsAfter = await base44.entities.Character.filter({ owner_email: user.email }, '-updated_date', 200);
    const charAfter = allCharsAfter.find(c => c.id === ANDRE_ID);

    const verifyOk = charAfter?.resolved_current_location_id === JOJOS_ID
      && charAfter?.travel_status === 'not_traveling'
      && !charAfter?.traveling_to_location_id;

    console.log(`[repairAndreArrival] AFTER: location=${charAfter?.resolved_current_location_name}, travel_status=${charAfter?.travel_status}, traveling_to=${charAfter?.traveling_to_location_name}`);
    console.log(`[repairAndreArrival] Verification: ${verifyOk ? 'PASS ✅' : 'FAIL ❌'}`);

    return Response.json({
      success: verifyOk,
      before: {
        location: charBefore.resolved_current_location_name,
        travel_status: charBefore.travel_status,
        traveling_to: charBefore.traveling_to_location_name,
        session_status: sessionBefore?.route_status,
      },
      after: {
        location: charAfter?.resolved_current_location_name,
        travel_status: charAfter?.travel_status,
        traveling_to: charAfter?.traveling_to_location_name || null,
      },
      verified: verifyOk,
    });

  } catch (error) {
    console.error('[repairAndreArrival]', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});