import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Search, Home, Briefcase, BookOpen, Dumbbell, Wine, X, Loader2, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";

const CATEGORY_ICONS = {
  home: { icon: Home, color: "text-pink-400" },
  workplace: { icon: Briefcase, color: "text-blue-400" },
  gym: { icon: Dumbbell, color: "text-cyan-400" },
  food_drink: { icon: Wine, color: "text-amber-400" },
  school: { icon: BookOpen, color: "text-amber-400" },
  education: { icon: BookOpen, color: "text-amber-400" },
};

const DEFAULT_ICON = { icon: MapPin, color: "text-muted-foreground" };

function getCategoryIcon(category) {
  return CATEGORY_ICONS[category] || DEFAULT_ICON;
}

/**
 * CharacterTeleportPicker
 *
 * Renders a clickable location label. On click, opens a searchable dropdown
 * of all user locations. Selecting one calls updateCharacterLocation (which
 * writes ONLY resolved_* fields — home/work/school are untouched).
 */
export default function CharacterTeleportPicker({ character, currentLabel, currentColor, IconComponent, onTeleported }) {
   const [open, setOpen] = useState(false);
   const [search, setSearch] = useState("");
   const [sending, setSending] = useState(null); // locationId being sent to
   const [done, setDone] = useState(null);       // locationId just sent
   const triggerRef = useRef(null);
   const queryClient = useQueryClient();

   // VALIDATION: Character must have a valid location to teleport
   const hasValidLocation = !!(
     character.resolved_current_location_id || 
     character.current_home_location_id || 
     character.home_location_id ||
     character.temporary_housing_location_id
   );
   const isDisabled = !hasValidLocation || currentLabel === 'Away';

  // Use owner_email from the character to match the SAME queryKey as Home's location query.
  // This allows React Query to deduplicate — no second network call is made when Home
  // already has the data cached under ["locationReferences", ownerEmail].
  const ownerEmail = character.owner_email || null;

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ["locationReferences", ownerEmail],
    queryFn: async () => {
      const res = await base44.functions.invoke("fetchAllLocationsForUser", {});
      return res?.data?.locations || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    // Only fetch if cache is empty — otherwise serve from Home's already-loaded cache
    enabled: open && !!ownerEmail,
  });

  // Filter out locations that ARE the character's current resolved location
  const filtered = locations.filter(loc => {
    if (loc.id === character.resolved_current_location_id) return false;
    if (!search.trim()) return true;
    return loc.name?.toLowerCase().includes(search.toLowerCase());
  });

  const handleSelect = async (loc) => {
    if (sending) return;
    setSending(loc.id);
    try {
      await base44.functions.invoke("updateCharacterLocation", {
        characterId: character.id,
        locationId: loc.id,
        locationName: loc.name,
        presenceStatus: "visiting",
        locationType: "visit",
        sourceReason: "user_teleport",
      });
      setDone(loc.id);
      setTimeout(() => {
        setDone(null);
        setOpen(false);
        setSearch("");
        // Only invalidate the single character — do NOT invalidate the broad
        // "characters" list key or the Home page will refetch and blank out.
        queryClient.invalidateQueries({ queryKey: ["character", character.id] });
        onTeleported?.();
      }, 800);
    } catch (err) {
      console.error("[Teleport] Failed:", err.message);
    } finally {
      setSending(null);
    }
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target)) {
        const portal = document.getElementById("teleport-picker-portal");
        if (portal && portal.contains(e.target)) return;
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const Icon = IconComponent || MapPin;

  return (
    <div className="relative inline-flex items-center" ref={triggerRef}>
      {/* Clickable location label */}
      <button
        onClick={(e) => { 
          if (!hasValidLocation) return;
          e.stopPropagation(); 
          setOpen(v => !v); 
        }}
        disabled={!hasValidLocation}
        className={`flex items-center gap-1 transition-opacity group ${!hasValidLocation ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-70'}`}
        title={!hasValidLocation ? "No valid location assigned" : "Teleport character to another location"}
      >
        <Icon className={`w-3 h-3 ${currentColor || "text-muted-foreground"}`} />
        <span className={`text-xs ${currentColor || "text-muted-foreground"} ${!hasValidLocation ? '' : 'group-hover:underline'} underline-offset-2`}>
          {currentLabel}
        </span>
        {hasValidLocation && <MapPin className="w-2.5 h-2.5 text-primary/50 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5" />}
      </button>

      {/* Dropdown — rendered as portal to avoid clipping inside card */}
      {open && createPortal(
        <div id="teleport-picker-portal">
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              style={{
                position: "fixed",
                top: (() => {
                  const rect = triggerRef.current?.getBoundingClientRect();
                  return rect ? rect.bottom + 6 : 100;
                })(),
                left: (() => {
                  const rect = triggerRef.current?.getBoundingClientRect();
                  if (!rect) return 16;
                  const w = 260;
                  return Math.min(rect.left, window.innerWidth - w - 8);
                })(),
                width: 260,
                zIndex: 9999,
              }}
              className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-3 pt-3 pb-2">
                <p className="text-xs font-semibold text-foreground">Send to location</p>
                <button onClick={() => { setOpen(false); setSearch(""); }} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Search */}
              <div className="px-3 pb-2">
                <div className="flex items-center gap-2 bg-secondary rounded-xl px-3 py-1.5">
                  <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <input
                    autoFocus
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search locations..."
                    className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
                  />
                </div>
              </div>

              {/* Location list */}
              <div className="max-h-52 overflow-y-auto px-2 pb-2">
                {isLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No locations found</p>
                ) : (
                  filtered.map(loc => {
                    const { icon: LocIcon, color } = getCategoryIcon(loc.category);
                    const isSending = sending === loc.id;
                    const isDone = done === loc.id;
                    return (
                      <button
                        key={loc.id}
                        onClick={() => handleSelect(loc)}
                        disabled={!!sending}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-secondary transition-colors text-left disabled:opacity-60"
                      >
                        <LocIcon className={`w-3.5 h-3.5 flex-shrink-0 ${color}`} />
                        <span className="flex-1 text-xs text-foreground truncate">{loc.name}</span>
                        {isSending && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary flex-shrink-0" />}
                        {isDone && <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>,
        document.body
      )}
    </div>
  );
}