import { Calendar } from "lucide-react";

/**
 * RotationSchedulePreview
 *
 * Shows "Tomorrow's scheduled outfit" for each rotation GROUP:
 *   Home | Daily Wear | Special Occasion | Activity
 *
 * One next-outfit preview per group (not per sub-category).
 * All outfits across the group's sub-categories compete in a single pool.
 *
 * Rules (permanent):
 *  - Purely based on rotation_number values — no weather, medical, or transitional modifiers
 *  - Manual overrides for today do NOT change tomorrow's sequence
 *  - "Tomorrow" = dayOfYear+1 (Eastern Time date) + characterId hash
 *  - Duplicates within the group pool → conflict warning
 *  - No numbered outfits → explains clearly
 *  - Rotation off → shows locked message
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

const GROUPS = [
  { key: "Home",             emoji: "🏠" },
  { key: "Daily Wear",       emoji: "👕" },
  { key: "Special Occasion", emoji: "✨" },
  { key: "Activity",         emoji: "🏋️" },
];

const GROUP_CATEGORIES = OUTFIT_CATEGORIES.reduce((acc, c) => {
  if (!acc[c.group]) acc[c.group] = [];
  acc[c.group].push(c.value);
  return acc;
}, {});

/** Eastern Time "tomorrow" day-of-year, deterministic */
function getTomorrowDayOfYear() {
  // Use Eastern Time date
  const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const etTomorrow = new Date(etNow);
  etTomorrow.setDate(etTomorrow.getDate() + 1);
  const start = new Date(etTomorrow.getFullYear(), 0, 0);
  return Math.floor((etTomorrow - start) / 86400000);
}

function idHash(characterId = '') {
  return characterId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
}

/**
 * Compute the "next scheduled" outfit for a group.
 * Returns: { state, outfit? }
 * States: 'scheduled' | 'no_outfits' | 'no_numbered' | 'conflict' | 'rotation_off'
 */
function getGroupPreview(groupKey, outfits, rotationEnabled, characterId) {
  const catValues = GROUP_CATEGORIES[groupKey] || [];
  const pool = outfits.filter(o => catValues.includes(o.category));

  if (pool.length === 0) return null; // group has no outfits at all — skip

  if (!rotationEnabled) return { state: 'rotation_off' };

  const numbered = pool
    .filter(o => o.rotation_number != null && o.rotation_number !== "")
    .sort((a, b) => Number(a.rotation_number) - Number(b.rotation_number));

  if (numbered.length === 0) return { state: 'no_numbered', total: pool.length };

  // Check for duplicate rotation numbers within the group pool
  const seen = new Set();
  let hasDuplicate = false;
  for (const o of numbered) {
    const n = Number(o.rotation_number);
    if (seen.has(n)) { hasDuplicate = true; break; }
    seen.add(n);
  }
  if (hasDuplicate) return { state: 'conflict' };

  const dayOfYear = getTomorrowDayOfYear();
  const hash = idHash(characterId);
  const idx = (dayOfYear + hash) % numbered.length;
  return { state: 'scheduled', outfit: numbered[idx] };
}

export default function RotationSchedulePreview({ character }) {
  if (!character) return null;

  const closet = character.character_closet || [];
  const outfits = closet.filter(
    item => item.type === 'outfit' || (!item.type && item.outfit_id && !item.piece_id?.startsWith('piece_'))
  );
  const rotationEnabled = character.outfit_rotation_enabled !== false;
  const characterId = character.id || '';

  // Build group previews, skip groups with no outfits at all
  const groupPreviews = GROUPS.map(g => ({
    ...g,
    preview: getGroupPreview(g.key, outfits, rotationEnabled, characterId),
  })).filter(g => g.preview !== null);

  if (groupPreviews.length === 0) return null;

  return (
    <div className="bg-secondary/30 border border-border rounded-xl p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Calendar className="w-3.5 h-3.5 text-primary" />
        <p className="text-[10px] font-semibold text-foreground uppercase tracking-wider">
          Tomorrow's Rotation Schedule
        </p>
      </div>

      <div className="space-y-1.5">
        {groupPreviews.map(({ key, emoji, preview }) => (
          <GroupPreviewRow key={key} groupName={key} emoji={emoji} preview={preview} />
        ))}
      </div>

      <p className="text-[9px] text-muted-foreground/50 leading-relaxed pt-0.5">
        Based on rotation numbers only — weather, medical, and manual overrides do not affect this schedule.
      </p>
    </div>
  );
}

function GroupPreviewRow({ groupName, emoji, preview }) {
  if (preview.state === 'scheduled') {
    const o = preview.outfit;
    const catDef = OUTFIT_CATEGORIES.find(c => c.value === o?.category);
    return (
      <div className="flex items-start gap-2 bg-card/60 rounded-lg px-2.5 py-2">
        <span className="text-xs mt-0.5 shrink-0">{catDef?.emoji || emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-[10px] text-muted-foreground shrink-0">Next {groupName}:</p>
            <p className="text-xs font-semibold text-foreground truncate">{o?.label || '—'}</p>
            {o?.rotation_number != null && o.rotation_number !== "" && (
              <span className="text-[9px] font-bold bg-primary/15 text-primary px-1.5 py-0.5 rounded-full shrink-0">
                #{o.rotation_number}
              </span>
            )}
          </div>
          {(o?.top || o?.full_description) && (
            <p className="text-[9px] text-muted-foreground/70 truncate mt-0.5">
              {o.top || o.full_description}
            </p>
          )}
          {catDef && (
            <p className="text-[9px] text-muted-foreground/50 mt-0.5">{catDef.label}</p>
          )}
        </div>
      </div>
    );
  }

  if (preview.state === 'no_numbered') {
    return (
      <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-secondary/50">
        <span className="text-xs shrink-0">{emoji}</span>
        <div>
          <p className="text-[10px] text-muted-foreground font-medium">{groupName}</p>
          <p className="text-[9px] text-muted-foreground/60">
            {preview.total} outfit{preview.total !== 1 ? 's' : ''} — no rotation numbers assigned
          </p>
        </div>
      </div>
    );
  }

  if (preview.state === 'conflict') {
    return (
      <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <span className="text-xs shrink-0">{emoji}</span>
        <div>
          <p className="text-[10px] text-amber-400 font-medium">{groupName}</p>
          <p className="text-[9px] text-amber-400/80">⚠ Duplicate rotation numbers — resolve conflicts to see tomorrow's outfit</p>
        </div>
      </div>
    );
  }

  if (preview.state === 'rotation_off') {
    return (
      <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-secondary/50">
        <span className="text-xs shrink-0">{emoji}</span>
        <div>
          <p className="text-[10px] text-muted-foreground font-medium">{groupName}</p>
          <p className="text-[9px] text-muted-foreground/60">Rotation disabled — outfit locked to current selection</p>
        </div>
      </div>
    );
  }

  return null;
}