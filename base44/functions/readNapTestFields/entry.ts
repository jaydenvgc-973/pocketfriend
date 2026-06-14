/**
 * TEMPORARY diagnostic function for nap behavior verification.
 * Reads only the specific fields needed for TEST 1-6 verification.
 * Does NOT alter any data.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TARGET_FIELDS = [
  'id',
  'name',
  'resolved_presence_status',
  'current_activity',
  'last_nap_start',
  'last_nap_time',
  'last_sleep_start',
  'last_wake_time',
  'last_need_simulated_at',
  'updated_date',
  'sleep_start_time',
  'wake_up_time',
  'energy_value',
  'sleep_lock',
  'hunger_lock',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { characterId } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    let chars = await base44.entities.Character.filter(
      { id: characterId },
      null,
      1
    ).catch(() => []);

    if (chars.length === 0) {
      chars = await base44.asServiceRole.entities.Character.filter(
        { id: characterId },
        null,
        1
      ).catch(() => []);
    }

    if (!chars || chars.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const char = chars[0];
    const result = {};
    for (const field of TARGET_FIELDS) {
      result[field] = char[field] ?? null;
    }

    return Response.json({
      character_id: char.id,
      character_name: char.name,
      fields: result,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});