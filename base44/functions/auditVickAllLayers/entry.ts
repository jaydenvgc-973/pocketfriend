import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * auditVickAllLayers — READ ONLY, NO WRITES
 *
 * Direct ID lookups for each known Vick/Yard record.
 * No filter-based queries (which are blocked by RLS).
 * Uses .get() by ID via service role to bypass RLS field filters.
 */

const MURQART_VICK_ID    = '6a23580f06f68528940c6ddd';
const MURQART_YARD_ID    = '6a23580e6c67852d1b87d01e';
const ADOBEVGC_VICK_ID   = '6a2467b9a07bd221ece6abe2';
const ADOBEVGC_YARD_ID   = '6a2467b9ddf176aa4ec640c6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const pick = (obj, fields) => {
      if (!obj) return null;
      const out = {};
      fields.forEach(f => { out[f] = obj[f]; });
      return out;
    };

    // ── Direct ID reads via service role ──────────────────────────────────────
    const [murqartVick, murqartYard, adobeVick, adobeYard] = await Promise.all([
      base44.asServiceRole.entities.Character.get(MURQART_VICK_ID).catch(e => ({ _error: e.message })),
      base44.asServiceRole.entities.LocationReference.get(MURQART_YARD_ID).catch(e => ({ _error: e.message })),
      base44.asServiceRole.entities.Character.get(ADOBEVGC_VICK_ID).catch(e => ({ _error: e.message })),
      base44.asServiceRole.entities.LocationReference.get(ADOBEVGC_YARD_ID).catch(e => ({ _error: e.message })),
    ]);

    const characterFields = ['id','name','owner_email','character_type','status','is_world_service','is_protected','exclude_from_homepage','exclude_from_roster','current_home_location_id','occupation_location_id','created_date'];
    const yardFields = ['id','name','owner_email','owner_character_id','owner_character_name','worker_character_ids','resident_character_ids','created_date'];

    const murqartVickSummary = murqartVick?._error ? { error: murqartVick._error } : pick(murqartVick, characterFields);
    const murqartYardSummary = murqartYard?._error ? { error: murqartYard._error } : pick(murqartYard, yardFields);
    const adobeVickSummary   = adobeVick?._error   ? { error: adobeVick._error }   : pick(adobeVick, characterFields);
    const adobeYardSummary   = adobeYard?._error   ? { error: adobeYard._error }   : pick(adobeYard, yardFields);

    // ── Probe: what does fetchNPCsForUser return? (this feeds the NPC contact list) ──
    let npcListResult = null;
    try {
      npcListResult = await base44.asServiceRole.functions.invoke('fetchNPCsForUser', {});
    } catch (e) {
      npcListResult = { error: e.message };
    }

    // ── Find Vick entries in the NPC list ─────────────────────────────────────
    const npcVicks = [];
    if (npcListResult?.npcs) {
      for (const npc of npcListResult.npcs) {
        if ((npc.name || '').toLowerCase().includes('vick') || npc.character_type === 'npc_world_service') {
          npcVicks.push({ id: npc.id, name: npc.name, owner_email: npc.owner_email, character_type: npc.character_type, status: npc.status });
        }
      }
    }

    // ── Verdict ───────────────────────────────────────────────────────────────
    const problems = [];

    // murqart Vick must exist and be active
    if (murqartVickSummary?.error) problems.push(`murqart Vick NOT READABLE: ${murqartVickSummary.error}`);
    else if (murqartVickSummary?.status !== 'active') problems.push(`murqart Vick status is "${murqartVickSummary?.status}" — expected active`);
    else if (murqartVickSummary?.owner_email !== 'murqart@gmail.com') problems.push(`murqart Vick owner_email is "${murqartVickSummary?.owner_email}" — expected murqart@gmail.com`);

    // murqart yard must point to murqart Vick
    if (murqartYardSummary?.error) problems.push(`murqart Yard NOT READABLE: ${murqartYardSummary.error}`);
    else if (murqartYardSummary?.owner_character_id !== MURQART_VICK_ID) problems.push(`murqart Yard points to "${murqartYardSummary?.owner_character_id}" — expected ${MURQART_VICK_ID}`);

    // adobevgc Vick must NOT be active
    if (!adobeVickSummary?.error) {
      if (adobeVickSummary?.status === 'active') problems.push(`adobevgc Vick ${ADOBEVGC_VICK_ID} is still ACTIVE — must be soft_deleted`);
    }

    // adobevgc Yard — note its state
    const adobeYardState = adobeYardSummary?.error ? 'not_readable' : 'exists';

    // NPC list — must not contain adobevgc Vick
    const npcContainsAdobe = npcVicks.some(v => v.id === ADOBEVGC_VICK_ID);
    const npcContainsMurqart = npcVicks.some(v => v.id === MURQART_VICK_ID);
    if (npcContainsAdobe) problems.push(`NPC contact list still contains adobevgc Vick ${ADOBEVGC_VICK_ID}`);

    console.log(`[auditVickAllLayers] murqart Vick: ${JSON.stringify(murqartVickSummary)}`);
    console.log(`[auditVickAllLayers] murqart Yard: ${JSON.stringify(murqartYardSummary)}`);
    console.log(`[auditVickAllLayers] adobevgc Vick: ${JSON.stringify(adobeVickSummary)}`);
    console.log(`[auditVickAllLayers] adobevgc Yard: ${JSON.stringify(adobeYardSummary)}`);
    console.log(`[auditVickAllLayers] NPC list Vicks: ${JSON.stringify(npcVicks)}`);
    console.log(`[auditVickAllLayers] Problems: ${problems.length}`);

    return Response.json({
      read_only: true,
      no_writes_performed: true,
      problems_found: problems.length,
      problems,
      layer_1_character_table: {
        murqart_vick: murqartVickSummary,
        adobevgc_vick: adobeVickSummary,
      },
      layer_2_location_reference: {
        murqart_yard: murqartYardSummary,
        adobevgc_yard: adobeYardSummary,
        adobevgc_yard_state: adobeYardState,
      },
      layer_3_npc_contact_list: {
        total_vick_entries_in_npc_list: npcVicks.length,
        vick_entries: npcVicks,
        npc_list_contains_adobevgc_vick: npcContainsAdobe,
        npc_list_contains_murqart_vick: npcContainsMurqart,
        raw_npc_count: npcListResult?.npcs?.length ?? 'error',
      },
    });

  } catch (error) {
    console.error('[auditVickAllLayers]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});