import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * recordEatingEvent
 *
 * Canonical hunger writer. Called whenever eating is confirmed — from chat
 * dialogue, scene actions, or narrative events.
 *
 * Immediately updates hunger (and related needs) so the state reflects reality
 * before the next simulation tick. Narrative truth must equal system truth.
 *
 * VICK EXCLUSION: Vick Servicio (npc_world_service) characters are NEVER
 * updated by this function. Vick is a world-service character with locked needs.
 *
 * Payload:
 *   characterId    — required
 *   mealSize       — "snack" | "meal" | "large_meal" (default: "meal")
 *   foodDescription — optional string for memory ("ate a burger at Esco's")
 *   locationName   — optional string for memory context
 */

const clamp = (v) => Math.max(0, Math.min(100, v));

const HUNGER_RECOVERY = {
  snack:      { hunger: 20, energy: 3,  comfort: 2 },
  meal:       { hunger: 40, energy: 5,  comfort: 4 },
  large_meal: { hunger: 60, energy: 7,  comfort: 6 },
};

/**
 * Check if a character is Vick Servicio (world-service character).
 * These characters have locked needs and must never receive hunger updates.
 */
function isWorldServiceCharacter(char) {
  if (!char) return false;
  if (char.character_type === 'npc_world_service') return true;
  if (char.is_world_service === true) return true;
  if (char.diagnostic_only === true) return true;
  const names = [char.name, char.display_name, char.primary_name]
    .filter(Boolean)
    .map(n => n.toLowerCase());
  return names.some(n => n.includes('vick servicio'));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let payload = {};
    try { payload = await req.json(); } catch (_) {}

    const { characterId, mealSize, foodDescription, locationName } = payload;

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // Allow both authenticated user calls and service-role calls (scene/automation)
    let sdk = base44;
    try {
      const user = await base44.auth.me();
      if (!user) sdk = base44.asServiceRole;
    } catch (_) {
      sdk = base44.asServiceRole;
    }

    const char = await sdk.entities.Character.get(characterId).catch(() => null);
    if (!char) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // ── VICK EXCLUSION ──────────────────────────────────────────────────────
    // Vick Servicio and other world-service characters have locked needs.
    // They must never receive hunger updates from eating events.
    if (isWorldServiceCharacter(char)) {
      return Response.json({
        success: false,
        skipped: true,
        reason: 'world_service_character_excluded',
        characterName: char.name,
      });
    }

    // ── HUNGER LOCK CHECK ──────────────────────────────────────────────────
    // If hunger_lock or needs_locks.hunger is true, skip the update.
    if (char.hunger_lock === true) {
      return Response.json({
        success: false,
        skipped: true,
        reason: 'hunger_lock_active',
        characterName: char.name,
      });
    }
    if (char.needs_locks?.hunger === true) {
      return Response.json({
        success: false,
        skipped: true,
        reason: 'hunger_needs_lock_active',
        characterName: char.name,
      });
    }

    const currentHunger = char.hunger_value ?? 70;
    const currentEnergy = char.energy_value ?? 75;
    const currentComfort = char.comfort_value ?? 70;

    const resolvedSize = mealSize || 'meal';
    const recovery = HUNGER_RECOVERY[resolvedSize] || HUNGER_RECOVERY.meal;

    const wasStarving = currentHunger < 15;
    const wasCritical = currentHunger < 30;

    // Validate: if hunger was already high (>= 85), eating barely moves it (satiated)
    const effectiveHungerGain = currentHunger >= 85 ? Math.min(recovery.hunger, 5) : recovery.hunger;
    const clampedHunger = clamp(currentHunger + effectiveHungerGain);
    const newEnergy = clamp(currentEnergy + recovery.energy);
    const newComfort = clamp(currentComfort + recovery.comfort);

    // ── STATE SYNC WRITE ────────────────────────────────────────────────────
    await sdk.entities.Character.update(characterId, {
      hunger_value: clampedHunger,
      energy_value: newEnergy,
      comfort_value: newComfort,
      last_need_simulated_at: new Date().toISOString(),
    });

    // ── MEMORY CREATION ──────────────────────────────────────────────────────
    const memoryDescription = foodDescription
      ? `${char.name} ate: ${foodDescription}${locationName ? ` at ${locationName}` : ''}.`
      : `${char.name} had a ${resolvedSize === 'snack' ? 'snack' : resolvedSize === 'large_meal' ? 'large meal' : 'meal'}${locationName ? ` at ${locationName}` : ''}.`;

    sdk.entities.Memory.create({
      character_id: characterId,
      title: foodDescription ? `Ate: ${foodDescription.slice(0, 40)}` : `Had a ${resolvedSize.replace('_', ' ')}`,
      description: memoryDescription,
      emotional_impact: wasStarving ? 'relief' : 'positive',
      timestamp: new Date().toISOString(),
      source_context: 'eating_event',
    }).catch(() => {});

    console.log(`[EATING_EVENT] ${char.name} | size=${resolvedSize} | hunger: ${Math.round(currentHunger)} → ${clampedHunger} | was_starving=${wasStarving}`);

    if (wasStarving) {
      console.warn(`[HUNGER_RECOVERY] ${char.name} was STARVING (${Math.round(currentHunger)}) — now ${clampedHunger} after eating`);
    }

    return Response.json({
      success: true,
      characterName: char.name,
      mealSize: resolvedSize,
      hungerBefore: Math.round(currentHunger),
      hungerAfter: Math.round(clampedHunger),
      wasStarving,
      wasCritical,
      energyAfter: Math.round(newEnergy),
      comfortAfter: Math.round(newComfort),
    });

  } catch (error) {
    console.error('[recordEatingEvent]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});