import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * manualOverrideNeeds
 *
 * Directly sets any combination of need values for a character.
 * Used by the ManualNeedsEditor component and deepNeedsAudit repair flows.
 * Accessible by admin only OR by the character's owner.
 */

const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v))));

const NEED_KEYS = ['hunger', 'energy', 'social', 'health', 'mental', 'hygiene', 'comfort', 'financial'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, needs, action } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    // Load character to verify ownership
    const chars = await base44.entities.Character.filter({ id: characterId });
    const char = chars?.[0];
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

    const isOwner = char.created_by === user.email || char.owner_email === user.email;
    const isAdmin = user.role === 'admin';
    if (!isOwner && !isAdmin) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const now = new Date().toISOString();

    // action = 'stabilize' → set everything to 65
    // action = 'refill'    → set everything to 90
    // action = 'reset'     → set everything to default baseline
    // action = 'custom'    → apply provided needs object
    let updateData = {};

    if (action === 'stabilize') {
      for (const key of NEED_KEYS) {
        updateData[`${key}_value`] = 65;
      }
      updateData.financial_need_value = 65;
    } else if (action === 'refill') {
      updateData = {
        hunger_value: 90,
        energy_value: 90,
        social_value: 80,
        health_value: 90,
        mental_value: 85,
        hygiene_value: 85,
        comfort_value: 85,
        financial_need_value: char.financial_need_value ?? 60,
      };
    } else if (action === 'reset_baseline') {
      updateData = {
        hunger_value: 70,
        energy_value: 75,
        social_value: 65,
        health_value: 80,
        mental_value: 70,
        hygiene_value: 75,
        comfort_value: 70,
        financial_need_value: char.financial_need_value ?? 60,
      };
    } else {
      // Custom override — only set fields that were provided
      if (!needs || typeof needs !== 'object') {
        return Response.json({ error: 'needs object required for custom action' }, { status: 400 });
      }
      for (const key of NEED_KEYS) {
        if (needs[key] !== undefined && needs[key] !== null) {
          const dbKey = key === 'financial' ? 'financial_need_value' : `${key}_value`;
          updateData[dbKey] = clamp(needs[key]);
        }
      }
    }

    // Always bump last_need_simulated_at so next scheduled sim starts from now
    updateData.last_need_simulated_at = now;
    updateData.needs_initialized = true;

    await base44.entities.Character.update(characterId, updateData);

    console.log(`[manualOverrideNeeds] ${char.name} | action=${action || 'custom'} | fields=${Object.keys(updateData).join(', ')} | by=${user.email}`);

    return Response.json({
      success: true,
      character_id: characterId,
      character_name: char.name,
      action: action || 'custom',
      applied: updateData,
    });

  } catch (error) {
    console.error('[manualOverrideNeeds]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});