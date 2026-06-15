import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── OUTIFT CATEGORIES (inlined — Deno cannot import from lib/) ──────────────────
const OUTFIT_CATEGORIES = [
  { value: "lounge" }, { value: "sleepwear" }, { value: "bath" },
  { value: "daily_casual" }, { value: "work" }, { value: "school" },
  { value: "outdoor" }, { value: "nightlife" }, { value: "formal" },
  { value: "date_night" }, { value: "church" }, { value: "special" },
  { value: "gym" }, { value: "swimwear" },
];

// ── ACTIVITY → OUTFIT CATEGORY ──────────────────────────────────────────────────
const ACTIVITY_CATEGORY_MAP = [
  { activities: ['bathing', 'showering', 'shower', 'bath', 'hot tub', 'grooming', 'getting ready'], cat: 'bath' },
  { activities: ['swimming', 'pool', 'beach', 'water park', 'sunbathing', 'swim', 'snorkeling', 'surfing'], cat: 'swimwear' },
  { activities: ['gym', 'workout', 'working out', 'exercise', 'lifting', 'cardio', 'yoga', 'jogging', 'running', 'training', 'rehearsing_dance', 'rehearsing dance', 'dance rehearsal'], cat: 'gym' },
  { activities: ['sleeping', 'asleep', 'napping', 'sleep', 'nap', 'bed time', 'bedtime', 'going to sleep'], cat: 'sleepwear' },
  { activities: ['church', 'service', 'worship', 'mass', 'prayer', 'praying'], cat: 'church' },
  { activities: ['wedding', 'funeral', 'gala', 'graduation', 'ceremony', 'black tie', 'formal event'], cat: 'formal' },
  { activities: ['club', 'nightclub', 'party', 'going out', 'night out', 'bar hopping', 'lounge bar'], cat: 'nightlife' },
  { activities: ['working', 'at work', 'work shift', 'on the clock', 'office', 'shift'], cat: 'work' },
  { activities: ['school', 'class', 'campus', 'lecture', 'study', 'college', 'university'], cat: 'school' },
  { activities: ['relaxing', 'relaxed', 'home', 'chilling', 'hanging at home', 'lounging', 'watching tv', 'cleaning', 'cooking at home'], cat: 'lounge' },
  { activities: ['date', 'date night', 'romantic dinner', 'anniversary'], cat: 'date_night' },
];

const LOCATION_CATEGORY_TO_OUTFIT = {
  gym: 'gym', religion: 'church', school: 'school', workplace: 'work',
  business: 'work', social: 'nightlife', home: 'lounge', outdoor: 'outdoor',
};

// ── TARGET CATEGORY RESOLVER ─────────────────────────────────────────────────────
function resolveTargetCategory(character) {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const presence = character.resolved_presence_status || character.location_status || 'home';
  const activity = (character.current_activity || '').toLowerCase();

  for (const mapping of ACTIVITY_CATEGORY_MAP) {
    if (mapping.activities.some(a => activity.includes(a))) return mapping.cat;
  }

  const isSleeping = presence === 'sleeping' || presence === 'napping';
  if (isSleeping) return 'sleepwear';

  if (character.sleep_start_time) {
    const [sh, sm] = character.sleep_start_time.split(':').map(Number);
    const sleepMin = sh * 60 + sm;
    const nowMin = hour * 60 + minute;
    const diff = sleepMin > nowMin ? sleepMin - nowMin : (sleepMin + 1440) - nowMin;
    if (diff <= 60 && diff >= 0) return 'sleepwear';
  }

  if (presence === 'at_work') return 'work';
  if (presence === 'at_school') return 'school';

  const locCat = LOCATION_CATEGORY_TO_OUTFIT[character.resolved_location_type];
  if (locCat) return locCat;

  if (presence === 'home') return (hour >= 19 || hour < 7) ? 'lounge' : 'daily_casual';

  return 'daily_casual';
}

// ── FALLBACK CHAIN ──────────────────────────────────────────────────────────────
const FALLBACK_CHAINS = {
  bath: ['bath', 'sleepwear', 'lounge'], sleepwear: ['sleepwear', 'lounge', 'daily_casual'],
  swimwear: ['swimwear', 'gym', 'daily_casual'], gym: ['gym', 'outdoor', 'daily_casual'],
  work: ['work', 'formal', 'daily_casual'], formal: ['formal', 'work', 'daily_casual'],
  church: ['church', 'formal', 'work', 'daily_casual'], nightlife: ['nightlife', 'date_night', 'special', 'daily_casual'],
  date_night: ['date_night', 'nightlife', 'formal', 'daily_casual'], school: ['school', 'daily_casual', 'work'],
  lounge: ['lounge', 'daily_casual', 'sleepwear'], outdoor: ['outdoor', 'daily_casual'],
  special: ['special', 'formal', 'daily_casual'], daily_casual: ['daily_casual', 'outdoor', 'lounge'],
};

function pickFromPool(pool, characterId) {
  if (pool.length === 0) return null;
  const numbered = pool.filter(o => o.rotation_number != null && o.rotation_number !== "").sort((a, b) => Number(a.rotation_number) - Number(b.rotation_number));
  if (numbered.length > 0) {
    const now = new Date();
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const idHash = characterId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const idx = (dayOfYear + idHash) % numbered.length;
    return numbered[idx];
  }
  const favs = pool.filter(o => o.is_favorite);
  const candidates = favs.length > 0 ? favs : pool;
  if (candidates.length === 0) return null;
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const idHash = characterId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return candidates[(dayOfYear + idHash) % candidates.length];
}

function resolveOutfit(character) {
  const closet = character.character_closet || [];
  const outfits = closet.filter(item => item.type === 'outfit' || (!item.piece_id?.startsWith('piece_') && item.outfit_id));
  if (outfits.length === 0) return null;

  const rotationEnabled = character.outfit_rotation_enabled !== false;

  // Rotation off: keep current outfit if set
  if (!rotationEnabled && character.current_outfit?.outfit_id) {
    const locked = outfits.find(o => o.outfit_id === character.current_outfit.outfit_id);
    if (locked) return locked;
  }

  const target = resolveTargetCategory(character);
  const fallback = FALLBACK_CHAINS[target] || ['daily_casual', 'lounge', 'outdoor'];

  for (const cat of fallback) {
    const pool = outfits.filter(o => o.category === cat);
    if (pool.length > 0) return pickFromPool(pool, character.id);
  }

  return pickFromPool(outfits, character.id);
}

// ── MAIN ─────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;
    const nowIso = new Date().toISOString();

    const characters = await base44.asServiceRole.entities.Character.filter(
      { owner_email: ownerEmail, status: 'active', character_type: 'active_created_character' },
      null, 200
    ).catch(() => []);

    let rotated = 0;
    const results = [];

    for (const char of characters) {
      const resolved = resolveOutfit(char);
      if (!resolved) continue;

      const currentId = char.current_outfit?.outfit_id || null;
      if (resolved.outfit_id === currentId) continue;

      // Different outfit needed — apply rotation
      await base44.asServiceRole.entities.Character.update(char.id, {
        current_outfit: {
          ...resolved,
          last_changed_at: nowIso,
          change_reason: 'rotation_context_change',
        },
      });

      rotated++;
      results.push(`${char.name || char.id}: ${currentId || 'none'} → ${resolved.label} [${resolved.category}]`);
    }

    return Response.json({ success: true, rotated, results, timestamp: nowIso });
  } catch (error) {
    console.error('[rotateCharacterOutfits]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});