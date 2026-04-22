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

export default function TravelCharacterSelector({ characters, currentUser, displayName, selectedIds, locationMap, onToggle }) {
  const avatarUrl = currentUser?.generated_avatar_urls?.[0] || currentUser?.reference_image_urls?.[0] || null;

  // Sort: active created characters → NPC fictitious → NPC family members
  // Debug: log actual character types to diagnose filtering
  console.log('[TravelCharacterSelector Debug]', {
    totalCharacters: characters.length,
    types: characters.map(c => ({ name: c.name, type: c.character_type })),
  });
  
  const sortedCharacters = [
    ...characters.filter(c => c.character_type === 'active_created_character').sort((a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || '')),
    ...characters.filter(c => c.character_type === 'npc_fictitious').sort((a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || '')),
    ...characters.filter(c => c.character_type === 'npc_family_member').sort((a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || '')),
  ];
  
  console.log('[TravelCharacterSelector Debug]', { activeCreated: characters.filter(c => c.character_type === 'active_created_character').length, npcFictitious: characters.filter(c => c.character_type === 'npc_fictitious').length, npcFamily: characters.filter(c => c.character_type === 'npc_family_member').length, sortedTotal: sortedCharacters.length });

  // Build "Who's Coming" list: active_created_character, then npc_fictitious
  const selectedActiveCreated = selectedIds
    .map(id => characters.find(c => c.id === id && c.character_type === 'active_created_character'))
    .filter(Boolean)
    .sort((a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || ''));

  const selectedNpcFictitious = selectedIds
    .map(id => characters.find(c => c.id === id && c.character_type === 'npc_fictitious'))
    .filter(Boolean)
    .sort((a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || ''));

  const whosComing = [...selectedActiveCreated, ...selectedNpcFictitious];

  return (
    <div className="space-y-2">
      {/* Who's Coming list */}
      {whosComing.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Who's coming</p>
          <div className="space-y-2">
            {selectedActiveCreated.length > 0 && (
              <div className="space-y-1">
                {selectedActiveCreated.map(char => (
                  <div key={char.id} className="text-xs flex items-center gap-2 text-foreground">
                    <div className="w-5 h-5 rounded-full flex-shrink-0 overflow-hidden bg-primary/20 flex items-center justify-center">
                      {char.avatar_url ? (
                        <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] font-bold text-primary">{char.name?.[0]}</span>
                      )}
                    </div>
                    <span>{char.display_name || char.name}</span>
                  </div>
                ))}
              </div>
            )}
            {selectedNpcFictitious.length > 0 && (
              <div className="space-y-1">
                {selectedNpcFictitious.map(char => (
                  <div key={char.id} className="text-xs flex items-center gap-2 text-foreground">
                    <div className="w-5 h-5 rounded-full flex-shrink-0 overflow-hidden bg-secondary flex items-center justify-center">
                      {char.avatar_url ? (
                        <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] font-bold text-muted-foreground">{char.name?.[0]}</span>
                      )}
                    </div>
                    <span>{char.display_name || char.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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

      {/* Character cards */}
      {sortedCharacters.map(char => {
        let availability = { available: true, reason: null, availableAt: null };
        try {
          availability = getCharacterTravelAvailability(char, locationMap);
        } catch (e) {
          // fallback: treat as available
        }
        const isSelected = selectedIds.includes(char.id);
        const isAvailable = availability.available;
        const StatusIcon = STATUS_ICONS[availability.reason?.iconType];

        // SINGLE SOURCE OF TRUTH: derive sublabel from resolved_* fields directly from DB.
        // This ensures Travel selector always shows the same location as the Home card.
        const resolvedLocName = char.resolved_current_location_name;
        const resolvedStatus = char.resolved_presence_status;
        let currentLocationLabel = null;
        if (isAvailable && resolvedLocName && resolvedStatus !== 'home' && resolvedStatus !== 'sleeping' && resolvedStatus !== 'napping') {
          currentLocationLabel = `At ${resolvedLocName}`;
        } else if (isAvailable && resolvedStatus === 'home') {
          currentLocationLabel = 'At home';
        }

        return (
          <button
            key={char.id}
            onClick={() => onToggle(char.id)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
              isSelected
                ? "bg-primary/10 border-primary/40"
                : isAvailable
                ? "bg-card border-border hover:border-primary/30"
                : "bg-card border-border opacity-70"
            }`}
          >
            <div className={`relative w-10 h-10 rounded-full flex-shrink-0 overflow-hidden ${!isAvailable ? "grayscale opacity-60" : ""}`}>
              {char.avatar_url
                ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
                : (
                  <div className="w-full h-full bg-primary/20 flex items-center justify-center">
                    <span className="text-sm font-bold text-primary">{char.name?.[0]}</span>
                  </div>
                )
              }
            </div>

            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${isAvailable ? "text-foreground" : "text-muted-foreground"}`}>
                {char.name}
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                {!isAvailable && StatusIcon && (
                  <StatusIcon className={`w-3 h-3 ${availability.reason?.color}`} />
                )}
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

            {/* Selection indicator */}
            {isAvailable ? (
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                isSelected ? "bg-primary border-primary" : "border-border"
              }`}>
                {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
              </div>
            ) : (
              <div className="px-2 py-1 rounded-full bg-secondary border border-border flex-shrink-0">
                <span className="text-[10px] text-muted-foreground font-medium">Busy</span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}