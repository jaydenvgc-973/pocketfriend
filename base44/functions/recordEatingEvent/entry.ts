import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * recordEatingEvent
 *
 * Called whenever eating is confirmed — from chat dialogue, scene actions,
 * or image generation showing food consumption.
 *
 * Immediately updates hunger (and related needs) so the state reflects reality
 * before the next simulation tick. Narrative truth must equal system truth.
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

// Keywords that indicate eating in dialogue/text
export const EATING_KEYWORDS = [
  'i ate', "i'm eating", 'i just ate', 'i finished eating', 'i had', 'i grabbed',
  'eating', 'had a meal', 'had breakfast', 'had lunch', 'had dinner', 'had a snack',
  'just finished a meal', 'just ate', 'grabbed food', 'ordered food', 'got food',
  'ate a', 'eating a', 'eating some', 'had some food', 'had something to eat',
  'i cooked', 'made food', 'made a meal', 'heated up', 'takeout arrived',
  'delivery came', 'got takeout', 'ordered takeout', 'picked up food',
];

// Detect if text implies eating
export function detectsEating(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return EATING_KEYWORDS.some(kw => lower.includes(kw));
}

// Estimate meal size from text
function estimateMealSize(text) {
  if (!text) return 'meal';
  const lower = text.toLowerCase();
  if (lower.includes('snack') || lower.includes('bite') || lower.includes('chip') || lower.includes('cracker') || lower.includes('handful')) return 'snack';
  if (lower.includes('large') || lower.includes('feast') || lower.includes('full meal') || lower.includes('big meal') || lower.includes('thanksgiving') || lower.includes('thanksgiving')) return 'large_meal';
  return 'meal';
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

    const currentHunger = char.hunger_value ?? 70;
    const currentEnergy = char.energy_value ?? 75;
    const currentComfort = char.comfort_value ?? 70;

    const resolvedSize = mealSize || estimateMealSize(foodDescription || '');
    const recovery = HUNGER_RECOVERY[resolvedSize] || HUNGER_RECOVERY.meal;

    const newHunger  = clamp(currentHunger  + recovery.hunger);
    const newEnergy  = clamp(currentEnergy  + recovery.energy);
    const newComfort = clamp(currentComfort + recovery.comfort);

    const wasStarving = currentHunger < 15;
    const wasCritical = currentHunger < 30;

    // Validate: if hunger was already high (>= 85), eating barely moves it (satiated)
    const effectiveHungerGain = currentHunger >= 85 ? Math.min(recovery.hunger, 5) : recovery.hunger;
    const clampedHunger = clamp(currentHunger + effectiveHungerGain);

    // ── STATE SYNC WRITE ────────────────────────────────────────────────────────
    await sdk.entities.Character.update(characterId, {
      hunger_value: clampedHunger,
      energy_value: newEnergy,
      comfort_value: newComfort,
      last_need_simulated_at: new Date().toISOString(),
    });

    // ── MEMORY CREATION ──────────────────────────────────────────────────────────
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
      hungerAfter: clampedHunger,
      wasStarving,
      wasCritical,
      energyAfter: newEnergy,
      comfortAfter: newComfort,
    });

  } catch (error) {
    console.error('[recordEatingEvent]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});