import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { User, DollarSign, MapPin, ChevronDown, LogOut, Check } from "lucide-react";
import { useUserPresence } from "@/hooks/useUserPresence";

export default function UserCard({ user, settings, settingsId, locations = [], isLocationsLoading = false }) {
  const displayName = settings?.fictional_world_name || user?.full_name || "You";
  const avatarUrl = user?.generated_avatar_urls?.[0] || user?.reference_image_urls?.[0] || null;
  const balance = settings?.user_balance ?? 6000;

  const { userPresence, setUserLocation, setUserAway } = useUserPresence(user, settings, settingsId);
  const [showDropdown, setShowDropdown] = useState(false);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  // Position the portal dropdown below the trigger button
  const updateDropdownPos = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left });
  };

  // Close on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e) => {
      const inTrigger = triggerRef.current?.contains(e.target);
      const inDropdown = dropdownRef.current?.contains(e.target);
      if (!inTrigger && !inDropdown) setShowDropdown(false);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [showDropdown]);

  const handleSelectLocation = (loc) => {
    setShowDropdown(false);
    setUserLocation(loc.id, loc.name); // optimistic — no await needed
  };

  const handleSetAway = () => {
    setShowDropdown(false);
    setUserAway(); // optimistic — no await needed
  };

  const presenceLabel = userPresence.isAway
    ? "Away"
    : (userPresence.locationName || "Somewhere");

  const presenceColor = userPresence.isAway ? "text-muted-foreground" : "text-primary";
  const dotColor = userPresence.isAway ? "bg-muted-foreground/40" : "bg-primary";

  // Sort locations: home first, then alphabetically
  const sortedLocations = [...locations].sort((a, b) => {
    if (a.category === "home" && b.category !== "home") return -1;
    if (b.category === "home" && a.category !== "home") return 1;
    return (a.name || "").localeCompare(b.name || "");
  });

  return (
    <motion.div
      whileTap={{ scale: 0.99 }}
      className="bg-card border border-border rounded-2xl p-4 hover:border-primary/30 transition-colors"
    >
      <div className="flex items-center gap-3">
        {/* Avatar — links to profile */}
        <Link to="/my-profile" className="flex-shrink-0">
          <div className="w-14 h-14 rounded-full bg-primary/20 ring-2 ring-primary/30 flex items-center justify-center overflow-hidden">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <User className="w-6 h-6 text-primary" />
            )}
          </div>
        </Link>

        {/* Name + presence */}
        <div className="flex-1 min-w-0">
          <Link to="/my-profile" className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">{displayName}</h3>
            <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">You</span>
          </Link>

          {/* Presence label — clickable to open portal dropdown */}
          <div className="relative mt-0.5">
            <button
              ref={triggerRef}
              onClick={() => {
                updateDropdownPos();
                setShowDropdown(v => !v);
              }}
              className="flex items-center gap-1.5 group"
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
              <span className={`text-xs font-medium ${presenceColor} group-hover:text-foreground transition-colors flex items-center gap-0.5`}>
                {presenceLabel}
                <ChevronDown className={`w-3 h-3 transition-transform ${showDropdown ? "rotate-180" : ""}`} />
              </span>
            </button>

            {/* Portal: renders above ALL other elements, never clipped */}
            <AnimatePresence>
              {showDropdown && createPortal(
                <motion.div
                  ref={dropdownRef}
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.12 }}
                  style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999 }}
                  className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden min-w-[220px]"
                >
                  {/* Away option */}
                  <button
                    onClick={handleSetAway}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-secondary transition-colors ${
                      userPresence.isAway ? "bg-secondary/50" : ""
                    }`}
                  >
                    <LogOut className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">Away</p>
                      <p className="text-[10px] text-muted-foreground">Outside the app world</p>
                    </div>
                    {userPresence.isAway && <Check className="w-3 h-3 text-primary flex-shrink-0" />}
                  </button>

                  <div className="border-t border-border/50">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-3 pt-2 pb-1">Locations</p>
                    {isLocationsLoading ? (
                      <div className="flex items-center gap-2 px-3 py-3">
                        <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin flex-shrink-0" />
                        <p className="text-xs text-muted-foreground">Loading locations...</p>
                      </div>
                    ) : sortedLocations.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-3 py-2">No locations loaded. Add locations in Places.</p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto">
                        {sortedLocations.map(loc => {
                          const isSelected = !userPresence.isAway && userPresence.locationId === loc.id;
                          return (
                            <button
                              key={loc.id}
                              onClick={() => handleSelectLocation(loc)}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary transition-colors ${
                                isSelected ? "bg-primary/10" : ""
                              }`}
                            >
                              <MapPin className={`w-3 h-3 flex-shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                              <div className="flex-1 min-w-0">
                                <p className={`text-xs font-medium truncate ${isSelected ? "text-primary" : "text-foreground"}`}>{loc.name}</p>
                                <p className="text-[10px] text-muted-foreground capitalize">{loc.category?.replace("_", " ")}</p>
                              </div>
                              {isSelected && <Check className="w-3 h-3 text-primary flex-shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </motion.div>,
                document.body
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Balance */}
        <div className="flex items-center gap-1 bg-green-500/10 px-2.5 py-1 rounded-full flex-shrink-0">
          <DollarSign className="w-3 h-3 text-green-400" />
          <span className="text-xs font-semibold text-green-400">{balance.toLocaleString()}</span>
        </div>
      </div>
    </motion.div>
  );
}