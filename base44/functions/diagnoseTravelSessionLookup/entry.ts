/**
 * diagnoseTravelSessionLookup
 * Determines which SDK pattern successfully retrieves a Character by ID
 * so createTravelSession can use the correct lookup method.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    const { characterId, ownerEmail } = await req.json();
    const reqEmail = user?.email || ownerEmail;

    const results = {};

    // Test 1: asServiceRole filter by id
    try {
      const r = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1);
      results.sr_filter_id = { count: r.length, found: r.length > 0, name: r[0]?.name };
    } catch(e) { results.sr_filter_id = { error: e.message }; }

    // Test 2: user-scoped filter by id
    if (user) {
      try {
        const r = await base44.entities.Character.filter({ id: characterId }, null, 1);
        results.user_filter_id = { count: r.length, found: r.length > 0, name: r[0]?.name };
      } catch(e) { results.user_filter_id = { error: e.message }; }
    }

    // Test 3: asServiceRole filter by owner_email + id
    try {
      const r = await base44.asServiceRole.entities.Character.filter({ id: characterId, owner_email: reqEmail }, null, 1);
      results.sr_filter_id_and_owner = { count: r.length, found: r.length > 0, name: r[0]?.name };
    } catch(e) { results.sr_filter_id_and_owner = { error: e.message }; }

    // Test 4: asServiceRole list all, find by id in JS
    try {
      const all = await base44.asServiceRole.entities.Character.list('-created_date', 200);
      const match = all.find(c => c.id === characterId);
      results.sr_list_find = { total_loaded: all.length, found: !!match, name: match?.name, owner_email: match?.owner_email };
    } catch(e) { results.sr_list_find = { error: e.message }; }

    // Test 5: asServiceRole filter by owner_email, find by id in JS
    if (reqEmail) {
      try {
        const all = await base44.asServiceRole.entities.Character.filter({ owner_email: reqEmail }, '-created_date', 200);
        const match = all.find(c => c.id === characterId);
        results.sr_filter_owner_find = { total_loaded: all.length, found: !!match, name: match?.name };
      } catch(e) { results.sr_filter_owner_find = { error: e.message }; }
    }

    // Test 6: LocationReference by id
    const locId = '69cecbca52ebe4c0bef7719e'; // VGC Gym
    try {
      const r = await base44.asServiceRole.entities.LocationReference.filter({ id: locId }, null, 1);
      results.loc_sr_filter_id = { count: r.length, found: r.length > 0, name: r[0]?.name };
    } catch(e) { results.loc_sr_filter_id = { error: e.message }; }

    // Test 7: LocationReference list and find
    try {
      const all = await base44.asServiceRole.entities.LocationReference.list('-created_date', 100);
      const match = all.find(l => l.id === locId);
      results.loc_sr_list_find = { total_loaded: all.length, found: !!match, name: match?.name };
    } catch(e) { results.loc_sr_list_find = { error: e.message }; }

    return Response.json({ reqEmail, characterId, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});