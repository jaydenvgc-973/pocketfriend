import { Calendar } from "lucide-react";

/**
 * RotationSchedulePreview
 *
 * Shows "Tomorrow's scheduled outfit" for each rotation group (Home, Daily Wear,
 * Special Occasion, Activity). Computed purely from saved rotation_number values.
 * Weather, medical, and transitional override systems are intentionally excluded.
 * Manual outfit overrides for today do NOT shift tomorrow's sequence.
 *
 * Rules:
 *  - Rotation groups are: Home, Daily Wear, Special Occasion, Activity
 *  - Within each group, each category is previewed independently
 *  - Only categories that actually have outfits with rotation_number are shown
 *  - "Tomorrow" = dayOfYear + 1, same characterId hash used by the engine
 *  - If duplicates exist in a category → show conflict warning
 *  - If no numbered outfits → show explanatory message
 *  - Rotation off → show locked message per category
 */

const OUTFIT_CATEGORIES = [
  { value: "lounge",       label: "Lounge / Home",       emoji: "🛋️", group: "Home" },
  { value: "sleepwear",    label: "Sleepwear",            emoji: "😴", group: "Home" },
  { value: "bath",         label: "Bath / Robe",          emoji: "🛁", group: "Home" },
  { value: "daily_casual", label: "Daily Casual",         emoji: "👕", group: "Daily Wear" },
  { value: "work",         label: "Work",                 emoji: "👔", group: "Daily Wear" },
  { value: "school",       label: "School",               emoji: "🎒", group: "Daily Wear" },
  { value: "outdoor",      label: "Outdoor / Errands",    emoji: "🌳", group: "Daily Wear" },
  { value: "nightlife",    label: "Nightlife / Party",    emoji: "🌃", group: "Daily Wear" },
  { value: "formal",       label: "Formal",               emoji: "🎩", group: "Special Occasion" },
  { value: "date_night",   label: "Date Night",           emoji: "💘", group: "Special Occasion" },
  { value: "church",       label: "Church / Religious",   emoji: "🛐", group: "Special Occasion" },
  { value: "special",      label: "Special / Statement",  emoji: "✨", group: "Special Occasion" },
  { value: "gym",          label: "Gym / Workout",        emoji: "🏋️", group: "Activity" },
  { value: "swimwear",     label: "Swimwear",             emoji: "🏊", group: "Activity" },
];

const GROUP_ORDER = ["Home", "Daily Wear", "Special Occasion", "Activity"];

/**
 * Deterministically pick the next (tomorrow's) outfit from a pool of numbered outfits.
 * Mirrors the engine's pickFromPool logic but uses dayOfYear+1 for "tomorrow".
 */
function pickTomorrowFromPool(numbered, characterId = '') {
  if (numbered.length === 0) return null;
  const now = new Date();
  // tomorrow's dayOfYear
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayOfYear = Math.floor((tomorrow - new Date(tomorrow.getFullYear(), 0, 0)) / 86400000);
  const idHash = characterId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const idx = (dayOfYear + idHash) % numbered.length;
  return numbered[idx];
}

/**
 * Analyze one category's outfits and return a preview descriptor.
 * States: 'scheduled' | 'no_numbered' | 'conflict' | 'rotation_off'
 */
function getCategoryPreview(catValue, outfits, rotationEnabled, characterId) {
  const pool = outfits.filter(o => o.category === catValue);
  if (pool.length === 0) return null; // category has no outfits at all — skip

  if (!rotationEnabled) {
    return { state: 'rotation_off' };
  }

  const numbered = pool
    .filter(o => o.rotation_number != null && o.rotation_number !== "")
    .sort((a, b) => Number(a.rotation_number) - Number(b.rotation_number));

  if (numbered.length === 0) {
    return { state: 'no_numbered', total: pool.length };
  }

  // Check for duplicates
  const numSet = new Set();
  let hasDuplicate = false;
  for (const o of numbered) {
    const n = Number(o.rotation_number);
    if (numSet.has(n)) { hasDuplicate = true; break; }
    numSet.add(n);
  }
  if (hasDuplicate) {
    return { state: 'conflict' };
  }

  const tomorrow = pickTomorrowFromPool(numbered, characterId);
  return { state: 'scheduled', outfit: tomorrow };
}

export default function RotationSchedulePreview({ character }) {
  if (!character) return null;

  const closet = character.character_closet || [];
  const outfits = closet.filter(
    item => item.type === 'outfit' || (!item.type && item.outfit_id && !item.piece_id?.startsWith('piece_'))
  );
  const rotationEnabled = character.outfit_rotation_enabled !== false;
  const characterId = character.id || '';

  // Build previews per category, group by group
  const groupedPreviews = {};
  for (const cat of OUTFIT_CATEGORIES) {
    const preview = getCategoryPreview(cat.value, outfits, rotationEnabled, characterId);
    if (!preview) continue; // no outfits in this category — skip entirely
    if (!groupedPreviews[cat.group]) groupedPreviews[cat.group] = [];
    groupedPreviews[cat.group].push({ ...cat, preview });
  }

  const groups = GROUP_ORDER.filter(g => groupedPreviews[g]?.length > 0);
  if (groups.length === 0) return null;

  return (
    <div className="bg-secondary/30 border border-border rounded-xl p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Calendar className="w-3.5 h-3.5 text-primary" />
        <p className="text-[10px] font-semibold text-foreground uppercase tracking-wider">
          Tomorrow's Rotation Schedule
        </p>
      </div>

      {groups.map(group => (
        <div key={group} className="space-y-1.5">
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">{group}</p>
          {groupedPreviews[group].map(({ value, label, emoji, preview }) => (
            <CategoryPreviewRow
              key={value}
              emoji={emoji}
              label={label}
              preview={preview}
            />
          ))}
        </div>
      ))}

      <p className="text-[9px] text-muted-foreground/50 leading-relaxed">
        Schedule is based on rotation numbers only. Weather, medical, and manual overrides do not affect tomorrow's sequence.
      </p>
    </div>
  );
}

function CategoryPreviewRow({ emoji, label, preview }) {
  if (preview.state === 'scheduled') {
    const o = preview.outfit;
    const numBadge = o?.rotation_number != null && o.rotation_number !== ""
      ? `#${o.rotation_number}`
      : null;
    return (
      <div className="flex items-start gap-2 bg-card/60 rounded-lg px-2.5 py-2">
        <span className="text-xs mt-0.5 shrink-0">{emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-[10px] text-muted-foreground shrink-0">{label}:</p>
            <p className="text-xs font-semibold text-foreground truncate">{o?.label || '—'}</p>
            {numBadge && (
              <span className="text-[9px] font-bold bg-primary/15 text-primary px-1.5 py-0.5 rounded-full shrink-0">
                {numBadge}
              </span>
            )}
          </div>
          {(o?.top || o?.full_description) && (
            <p className="text-[9px] text-muted-foreground/70 truncate mt-0.5">
              {o.top || o.full_description}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (preview.state === 'no_numbered') {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-secondary/40">
        <span className="text-xs shrink-0">{emoji}</span>
        <p className="text-[10px] text-muted-foreground/60 italic">
          {label}: no rotation numbers assigned ({preview.total} outfit{preview.total !== 1 ? 's' : ''})
        </p>
      </div>
    );
  }

  if (preview.state === 'conflict') {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <span className="text-xs shrink-0">{emoji}</span>
        <p className="text-[10px] text-amber-400 font-medium">
          {label}: ⚠ duplicate rotation numbers — resolve conflicts to enable preview
        </p>
      </div>
    );
  }

  if (preview.state === 'rotation_off') {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-secondary/40">
        <span className="text-xs shrink-0">{emoji}</span>
        <p className="text-[10px] text-muted-foreground/60 italic">
          {label}: rotation disabled
        </p>
      </div>
    );
  }

  return null;
}