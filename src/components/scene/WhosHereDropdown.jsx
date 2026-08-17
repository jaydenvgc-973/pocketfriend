import React from "react";
import { Users, ChevronDown, UserPlus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * WHO'S HERE DROPDOWN — UNIFIED PARTICIPANT SOURCE
 *
 * Groups participants by sceneRole — resolved ONCE at the Scene level and attached
 * to each participant. No independent reclassification here. Each participant has
 * exactly ONE role, so they appear in exactly ONE section. No deduplication needed.
 *
 * Props:
 *   allPossibleNpcs: all participants available at this location, each carrying sceneRole
 *   selectedNpcs: user-selected participants
 *   onToggleNpc: handler to select/deselect
 *   showDropdown: dropdown visibility
 *   onToggleDropdown: handler to show/hide
 *   onInviteClick: handler for "Invite someone here" button
 *   renderNpc: function to render individual participant button
 */
export default function WhosHereDropdown({
  allPossibleNpcs = [],
  selectedNpcs = [],
  onToggleNpc = () => {},
  showDropdown = false,
  onToggleDropdown = () => {},
  onInviteClick = () => {},
  renderNpc = null,
}) {
  // Group by sceneRole — consumed directly from the completed participant.
  // No independent classification, no presence resolver call, no PATIENT_STATUSES
  // or INMATE_STATUSES check. The participant already carries its role.
  const patients = allPossibleNpcs.filter((n) => n.sceneRole === 'patient');
  const inmates = allPossibleNpcs.filter((n) => n.sceneRole === 'inmate');
  const realEmployees = allPossibleNpcs.filter((n) => n.sceneRole === 'on-shift employee' && n.isNpc !== true);
  const npcEmployees = allPossibleNpcs.filter((n) => n.sceneRole === 'on-shift employee' && n.isNpc === true);
  const realResidents = allPossibleNpcs.filter((n) => n.sceneRole === 'home resident' && n.isNpc !== true);
  const npcResidents = allPossibleNpcs.filter((n) => n.sceneRole === 'home resident' && n.isNpc === true);
  const realVisitors = allPossibleNpcs.filter((n) => n.sceneRole === 'visitor' && n.isNpc !== true);
  const npcVisitors = allPossibleNpcs.filter((n) => n.sceneRole === 'visitor' && n.isNpc === true);

  const renderNpcWrapper = (npc) => {
    if (renderNpc) return renderNpc(npc);
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
              {/* Patients — hospitalized characters (sceneRole: patient) */}
              {patients.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50">
                    <p className="text-[9px] font-semibold text-rose-400/80 uppercase tracking-wider">Patients</p>
                  </div>
                  {patients.map(renderNpcWrapper)}
                </>
              )}

              {/* Inmates — incarcerated/confined characters (sceneRole: inmate) */}
              {inmates.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-amber-400/80 uppercase tracking-wider">Inmates</p>
                  </div>
                  {inmates.map(renderNpcWrapper)}
                </>
              )}

              {/* Here Now — real character visitors (sceneRole: visitor, not NPC) */}
              {realVisitors.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50">
                    <p className="text-[9px] font-semibold text-blue-400/80 uppercase tracking-wider">Here Now</p>
                  </div>
                  {realVisitors.map(renderNpcWrapper)}
                </>
              )}

              {/* Working Here — real character employees (sceneRole: on-shift employee, not NPC) */}
              {realEmployees.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-blue-400/80 uppercase tracking-wider">Working Here</p>
                  </div>
                  {realEmployees.map(renderNpcWrapper)}
                </>
              )}

              {/* Residents — real character residents (sceneRole: home resident, not NPC) */}
              {realResidents.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-green-400/80 uppercase tracking-wider">Residents</p>
                  </div>
                  {realResidents.map(renderNpcWrapper)}
                </>
              )}

              {/* NPC Residents (sceneRole: home resident, NPC) */}
              {npcResidents.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-green-400/80 uppercase tracking-wider">NPC Residents</p>
                  </div>
                  {npcResidents.map(renderNpcWrapper)}
                </>
              )}

              {/* NPC Employees (sceneRole: on-shift employee, NPC) */}
              {npcEmployees.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-blue-400/80 uppercase tracking-wider">Employees</p>
                  </div>
                  {npcEmployees.map(renderNpcWrapper)}
                </>
              )}

              {/* Ambient People — NPC visitors (sceneRole: visitor, NPC) */}
              {npcVisitors.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-wider">People here</p>
                  </div>
                  {npcVisitors.map(renderNpcWrapper)}
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