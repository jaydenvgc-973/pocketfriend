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

export default function TravelCharacterSelector({ characters, currentUser, displayName, selectedIds, locationMap, onToggle, presenceEntities = [] }) {
  const avatarUrl = currentUser?.generated_avatar_urls?.[0] || currentUser?.reference_image_urls?.[0] || null;

  // ── DEDUPLICATION: by stable ID first, then normalized name as last resort ──
  // Prevents duplicate entries when a character appears via multiple parent family lists
  const deduped = (() => {
    const seenIds = new Set();
    const seenNames = new Set();
    const result = [];
    for (const c of characters) {
      // Dedupe by character ID (primary stable key)
      if (seenIds.has(c.id)) continue;
      seenIds.add(c.id);
      // Also dedupe by normalized name within same character_type (Leo Parker appearing twice)
      const nameKey = `${c.character_type}::${(c.name || '').trim().toLowerCase()}`;
      if (seenNames.has(nameKey)) {
        console.warn(`[TravelCharacterSelector] Deduped duplicate by name: ${c.name} (id=${c.id})`);
        continue;
      }
      seenNames.add(nameKey);
      result.push(c);
    }
    return result;
  })();

  // Build a presence entity lookup map for fast hydration by character ID
  const presenceById = Object.fromEntries(presenceEntities.map(e => [e.id, e]));

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

    // ── PRESENCE HYDRATION: use the unified presence entity (same source as location popup)
    // Fall back to raw character fields if entity not found.
    const presenceEntity = presenceById[char.id];
    const resolvedLocName = presenceEntity?.resolved_current_location_name || char.resolved_current_location_name;
    const resolvedStatus = presenceEntity?.resolved_presence_status || char.resolved_presence_status;
    const isHome = presenceEntity?.is_home ?? (resolvedStatus === 'home' || resolvedStatus === 'sleeping' || resolvedStatus === 'napping');
    const hasHomeId = !!(char.current_home_location_id || presenceEntity?.residence_location_id);

    let currentLocationLabel = null;
    if (isAvailable && resolvedLocName && !isHome) {
      currentLocationLabel = `At ${resolvedLocName}`;
    } else if (isAvailable && (isHome || hasHomeId)) {
      currentLocationLabel = 'At home';
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