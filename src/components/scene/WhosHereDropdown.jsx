import React, { useMemo } from "react";
import { Users, ChevronDown, UserPlus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getPresenceAtLocation } from "@/lib/travelPresenceResolver";

/**
 * WHO'S HERE DROPDOWN — UNIFIED PRESENCE SOURCE
 * 
 * Resolves real characters present at location from shared presence layer
 * (same source as Travel page map + popup, so always in sync).
 * 
 * Props:
 *   allPossibleNpcs: all NPCs available at this location (workers, ambient)
 *   unifiedPresenceEntities: normalized presence from shared resolver
 *   location: current location object
 *   selectedNpcs: user-selected NPCs from allPossibleNpcs
 *   onToggleNpc: handler to select/deselect NPC
 *   showDropdown: dropdown visibility
 *   onToggleDropdown: handler to show/hide dropdown
 *   onInviteClick: handler for "Invite someone here" button
 *   renderNpc: function to render individual NPC button
 */
export default function WhosHereDropdown({
  allPossibleNpcs = [],
  unifiedPresenceEntities = [],
  location = null,
  selectedNpcs = [],
  onToggleNpc = () => {},
  showDropdown = false,
  onToggleDropdown = () => {},
  onInviteClick = () => {},
  renderNpc = null,
}) {
  // Get real characters currently present at this location from unified resolver
  const presentRealCharacters = useMemo(() => {
    if (!location) return [];
    const presenceHere = getPresenceAtLocation(location, unifiedPresenceEntities);
    
    console.log(
      `[WhosHereDropdown] "${location.name}": `,
      `unifiedTotal=${unifiedPresenceEntities.length} |`,
      `present=${presenceHere.length} |`,
      `present chars: ${presenceHere.map(e => `${e.display_name}(type:${e.character_type})`).join(', ')}`
    );
    
    // Convert presence entities to NPC-picker format for consistent rendering
    return presenceHere.map(entity => ({
      id: entity.id,
      name: entity.display_name,
      avatar_url: entity.avatar_url,
      role: entity.resolved_presence_status === 'home' ? 'Resident' : 'Here now',
      isNpc: false,
      npcType: 'present',
      personality_summary: entity.personality_summary,
      emotional_state: entity.emotional_state,
    }));
  }, [location, unifiedPresenceEntities]);

  // Separate allPossibleNpcs into categories
  const realCharacters = allPossibleNpcs.filter(n => n.isNpc === false && n.npcType !== 'present');
  const staffChars = allPossibleNpcs.filter(n => n.isNpc === false && n.npcType === 'staff');
  const residentChars = allPossibleNpcs.filter(n => n.isNpc === false && n.npcType === 'resident');
  const residentNpcs = allPossibleNpcs.filter(n => n.isNpc !== false && n.npcType === "resident");
  const staffNpcs = allPossibleNpcs.filter(n => n.isNpc !== false && n.npcType === "staff");
  const customerNpcs = allPossibleNpcs.filter(n => n.isNpc !== false && n.npcType === "customer");

  const renderNpcWrapper = (npc) => {
    if (renderNpc) return renderNpc(npc);
    // Fallback minimal render
    return (
      <button
        key={npc.id}
        onClick={() => onToggleNpc(npc.id)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-secondary"
      >
        <span className="w-4 h-4 rounded-full bg-secondary">{npc.name?.[0]}</span>
        <span className="flex-1">{npc.name}</span>
      </button>
    );
  };

  return (
    <div className="relative z-50">
      <button
        onClick={() => onToggleDropdown(!showDropdown)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
          selectedNpcs.length > 0
            ? "bg-primary/10 border-primary/40 text-primary"
            : "bg-secondary border-border text-muted-foreground hover:text-foreground"
        }`}
        title="NPCs nearby"
      >
        <Users className="w-3.5 h-3.5" />
        <span>Who's here{selectedNpcs.length > 0 ? ` · ${selectedNpcs.length}` : ""}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${showDropdown ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1.5 w-52 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-border">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Talk to someone nearby</p>
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              {/* SECTION 1: Real characters PRESENT at this location (from unified resolver) */}
              {presentRealCharacters.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50">
                    <p className="text-[9px] font-semibold text-blue-400/80 uppercase tracking-wider">Here Now</p>
                  </div>
                  {presentRealCharacters.map(renderNpcWrapper)}
                </>
              )}

              {/* SECTION 2: Other real characters (workers, residents, etc.) */}
              {realCharacters.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-purple-400/80 uppercase tracking-wider">Characters</p>
                  </div>
                  {realCharacters.map(renderNpcWrapper)}
                </>
              )}

              {/* SECTION 3: Workers */}
              {staffChars.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-blue-400/80 uppercase tracking-wider">Working Here</p>
                  </div>
                  {staffChars.map(renderNpcWrapper)}
                </>
              )}

              {/* SECTION 4: Residents */}
              {residentChars.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-green-400/80 uppercase tracking-wider">Residents</p>
                  </div>
                  {residentChars.map(renderNpcWrapper)}
                </>
              )}

              {/* SECTION 5: NPC Residents */}
              {residentNpcs.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-green-400/80 uppercase tracking-wider">NPC Residents</p>
                  </div>
                  {residentNpcs.map(renderNpcWrapper)}
                </>
              )}

              {/* SECTION 6: NPC Staff */}
              {staffNpcs.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-blue-400/80 uppercase tracking-wider">Employees</p>
                  </div>
                  {staffNpcs.map(renderNpcWrapper)}
                </>
              )}

              {/* SECTION 7: Ambient People */}
              {customerNpcs.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-wider">People here</p>
                  </div>
                  {customerNpcs.map(renderNpcWrapper)}
                </>
              )}
            </div>

            {/* Invite someone here */}
            <div className="border-t border-border p-2">
              <button
                onClick={onInviteClick}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors text-left"
              >
                <UserPlus className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="text-xs font-medium">Invite someone here</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}