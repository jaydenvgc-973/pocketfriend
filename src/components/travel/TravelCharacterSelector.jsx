import { Check, User } from "lucide-react";
import { getCharacterTravelAvailability } from "@/lib/travelAvailability";
import { Moon, Briefcase, BookOpen, AlertTriangle, Sparkles } from "lucide-react";

const STATUS_ICONS = {
  sleep: Moon,
  work: Briefcase,
  school: BookOpen,
  hospital: AlertTriangle,
  prayer: Sparkles,
};

/**
 * Build a canonical deduplication key for a character — especially NPC family members
 * who can appear under multiple parent family_members[] lists.
 *
 * Priority chain (per spec):
 *   1. real Character.id (strongest — stable DB identity)
 *   2. linked_character_id or npc_fictitious_character_id if present
 *   3. stable_family_member_id if present on the record
 *   4. normalized name + household_id (derived from current_home_location_id shared by parents)
 *   5. normalized name only (last resort)
 *
 * The key is type-scoped so "Leo Parker (npc_family_member)" never collides with
 * an unrelated "Leo Parker (active_created_character)".
 */
function buildCanonicalFamilyKey(char) {
  const type = char.character_type || 'unknown';
  const normName = (char.name || '').trim().toLowerCase().replace(/\s+/g, ' ');

  // Priority 1: real DB id — unique, always wins
  // (used as map key directly — this function builds the collision-detection key for synthesis)

  // Priority 2: explicit linked id (family NPC linked to a Character record)
  if (char.linked_character_id) return `${type}::linked::${char.linked_character_id}`;
  if (char.npc_fictitious_character_id) return `${type}::linked::${char.npc_fictitious_character_id}`;

  // Priority 3: stable family member id from family list metadata
  if (char.stable_family_member_id) return `${type}::fam::${char.stable_family_member_id}`;

  // Priority 4: normalized name + shared home (household key)
  // Two parents listing the same child will share the same home_location_id → same key
  if (char.current_home_location_id) {
    return `${type}::household::${char.current_home_location_id}::${normName}`;
  }

  // Priority 5: normalized name only (last resort safety net)
  return `${type}::name::${normName}`;
}

export default function TravelCharacterSelector({ characters, currentUser, displayName, selectedIds, locationMap, onToggle, presenceEntities = [] }) {
  const avatarUrl = currentUser?.generated_avatar_urls?.[0] || currentUser?.reference_image_urls?.[0] || null;

  // ── CANONICAL DEDUPLICATION ─────────────────────────────────────────────────
  // Two-pass dedup:
  //   Pass 1: by DB id (fastest, handles exact duplicates from merged query results)
  //   Pass 2: by canonical family key (handles same person synthesized from two parent lists)
  //           Uses the priority chain: linked_id > stable_id > household+name > name-only
  //
  // When a duplicate is found, the FIRST occurrence wins (it came from the stronger
  // source because travelCompanions is ordered: activeCreated → npcFictitious → npcFamilyMembers).
  const deduped = (() => {
    const seenIds = new Set();
    const seenCanonicalKeys = new Set();
    const result = [];

    for (const c of characters) {
      // Pass 1: hard id dedup
      if (seenIds.has(c.id)) {
        console.warn(`[TravelCharacterSelector] Deduped exact duplicate id: ${c.name} (id=${c.id})`);
        continue;
      }
      seenIds.add(c.id);

      // Pass 2: canonical family key dedup (same person via two parent lists)
      const canonKey = buildCanonicalFamilyKey(c);
      if (seenCanonicalKeys.has(canonKey)) {
        console.warn(`[TravelCharacterSelector] Deduped same-person via canonical key: ${c.name} (id=${c.id}, key=${canonKey})`);
        continue;
      }
      seenCanonicalKeys.add(canonKey);
      result.push(c);
    }

    console.log(`[TravelCharacterSelector] deduped: ${characters.length} input → ${result.length} output`);
    return result;
  })();

  // Build a presence entity lookup map for fast hydration:
  //   Primary: by character DB id
  //   Secondary: by normalized display name (for synthesized family members without id match)
  const presenceById = Object.fromEntries(presenceEntities.map(e => [e.id, e]));
  const presenceByNormName = Object.fromEntries(
    presenceEntities.map(e => [(e.display_name || e.name || '').trim().toLowerCase(), e])
  );

  const activeCreatedChars = deduped
    .filter(c => c.character_type === 'active_created_character')
    .sort((a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || ''));

  const npcFictitiousChars = deduped
    .filter(c => c.character_type === 'npc_fictitious')
    .sort((a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || ''));

  const npcFamilyChars = deduped
    .filter(c => c.character_type === 'npc_family_member')
    .sort((a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || ''));

  const renderCharCard = (char) => {
    let availability = { available: true, reason: null, availableAt: null };
    try { availability = getCharacterTravelAvailability(char, locationMap); } catch (e) {}
    const isSelected = selectedIds.includes(char.id);
    const isAvailable = availability.available;
    const StatusIcon = STATUS_ICONS[availability.reason?.iconType];

    // ── PRESENCE HYDRATION ──────────────────────────────────────────────────────
    // Source of truth: resolved_current_location_id / resolved_current_location_name ONLY.
    // current_home_location_id is NOT used for current-location display.
    // "Has a home" ≠ "currently at home."
    const charNormName = (char.display_name || char.name || '').trim().toLowerCase();
    const presenceEntity = presenceById[char.id] || presenceByNormName[charNormName] || null;
    // Use presence entity fields first (normalized), then raw character fields
    const resolvedLocId = presenceEntity?.resolved_current_location_id || char.resolved_current_location_id || null;
    const resolvedLocName = presenceEntity?.resolved_current_location_name || char.resolved_current_location_name || null;
    const resolvedStatus = presenceEntity?.resolved_presence_status || char.resolved_presence_status || null;
    const isCurrentlyPlaced = !!resolvedLocId;

    let currentLocationLabel = null;
    if (isAvailable && isCurrentlyPlaced && resolvedLocName) {
      // Use resolved_presence_status to derive the correct label
      if (resolvedStatus === 'sleeping' || resolvedStatus === 'napping') {
        currentLocationLabel = 'Sleeping';
      } else if (resolvedStatus === 'at_work') {
        currentLocationLabel = 'At work';
      } else if (resolvedStatus === 'at_school') {
        currentLocationLabel = 'At school';
      } else if (resolvedStatus === 'home') {
        currentLocationLabel = `At home · ${resolvedLocName}`;
      } else if (resolvedStatus === 'visiting') {
        currentLocationLabel = `Visiting · ${resolvedLocName}`;
      } else {
        currentLocationLabel = `Out · ${resolvedLocName}`;
      }
    } else if (isAvailable && !isCurrentlyPlaced) {
      currentLocationLabel = 'Available';
    }

    return (
      <button
        key={char.id}
        onClick={() => onToggle(char.id)}
        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
          isSelected ? "bg-primary/10 border-primary/40"
          : isAvailable ? "bg-card border-border hover:border-primary/30"
          : "bg-card border-border opacity-70"
        }`}
      >
        <div className={`relative w-10 h-10 rounded-full flex-shrink-0 overflow-hidden ${!isAvailable ? "grayscale opacity-60" : ""}`}>
          {char.avatar_url
            ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-primary/20 flex items-center justify-center"><span className="text-sm font-bold text-primary">{char.name?.[0]}</span></div>
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${isAvailable ? "text-foreground" : "text-muted-foreground"}`}>{char.name}</p>
          <div className="flex items-center gap-1 mt-0.5">
            {!isAvailable && StatusIcon && <StatusIcon className={`w-3 h-3 ${availability.reason?.color}`} />}
            <p className={`text-xs ${isAvailable ? "text-muted-foreground" : availability.reason?.color}`}>
              {isAvailable
                ? (currentLocationLabel || "Available")
                : availability.reason?.message?.replace(`${char.name} `, "").replace("can't join", "unavailable").split(".")[0]}
            </p>
          </div>
          {!isAvailable && availability.availableAt && (
            <p className="text-[10px] text-muted-foreground/70 mt-0.5">{availability.availableAt}</p>
          )}
        </div>
        {isAvailable ? (
          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? "bg-primary border-primary" : "border-border"}`}>
            {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
          </div>
        ) : (
          <div className="px-2 py-1 rounded-full bg-secondary border border-border flex-shrink-0">
            <span className="text-[10px] text-muted-foreground font-medium">Busy</span>
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-2">
      {/* User card — always available */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/10 border border-primary/30">
        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden flex-shrink-0">
          {avatarUrl
            ? <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
            : <User className="w-5 h-5 text-primary" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{displayName}</p>
          <p className="text-xs text-primary">You • Always going</p>
        </div>
        <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
          <Check className="w-3.5 h-3.5 text-white" />
        </div>
      </div>

      {/* Active created characters */}
      {activeCreatedChars.length > 0 && (
        <>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 pt-1">Characters</p>
          {activeCreatedChars.map(renderCharCard)}
        </>
      )}

      {/* NPC Fictitious — shown only if they exist */}
      {npcFictitiousChars.length > 0 && (
        <>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 pt-2">NPCs</p>
          {npcFictitiousChars.map(renderCharCard)}
        </>
      )}

      {/* NPC Family Members — shown only if they exist */}
      {npcFamilyChars.length > 0 && (
        <>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 pt-2">Family</p>
          {npcFamilyChars.map(renderCharCard)}
        </>
      )}

      {activeCreatedChars.length === 0 && npcFictitiousChars.length === 0 && npcFamilyChars.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">No characters available</p>
      )}
    </div>
  );
}