import React from "react";
import { Users, ChevronDown, UserPlus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * WHO'S HERE DROPDOWN — UNIFIED PARTICIPANT SOURCE
 *
 * Present sections consume the authoritative completed sceneParticipants collection.
 * Candidate sections consume allPossibleNpcs filtered to exclude those already present.
 * sceneRole is already attached to each participant at the Scene level — no independent
 * classification happens here. Each participant appears in exactly ONE section.
 *
 * Props:
 *   presentParticipants: completed sceneParticipants (authoritative current presence + role + outfit)
 *   candidateNpcs: allPossibleNpcs not already in sceneParticipants (selection candidates)
 *   selectedNpcs: user-selected participants
 *   onToggleNpc: handler to select/deselect
 *   showDropdown: dropdown visibility
 *   onToggleDropdown: handler to show/hide
 *   onInviteClick: handler for "Invite someone here" button
 *   renderNpc: function to render individual participant button
 */
export default function WhosHereDropdown({
  presentParticipants = [],
  candidateNpcs = [],
  selectedNpcs = [],
  onToggleNpc = () => {},
  showDropdown = false,
  onToggleDropdown = () => {},
  onInviteClick = () => {},
  renderNpc = null,
}) {
  // Present people from authoritative sceneParticipants (excluding the user)
  const present = presentParticipants.filter((n) => !n.isUser);
  const patients = present.filter((n) => n.sceneRole === 'patient');
  const inmates = present.filter((n) => n.sceneRole === 'inmate');
  const realEmployees = present.filter((n) => n.sceneRole === 'on-shift employee' && n.isNpc !== true);
  const npcEmployees = present.filter((n) => n.sceneRole === 'on-shift employee' && n.isNpc === true);
  const realResidents = present.filter((n) => n.sceneRole === 'home resident' && n.isNpc !== true);
  const npcResidents = present.filter((n) => n.sceneRole === 'home resident' && n.isNpc === true);
  const realVisitors = present.filter((n) => n.sceneRole === 'visitor' && n.isNpc !== true);
  const npcVisitors = present.filter((n) => n.sceneRole === 'visitor' && n.isNpc === true);

  // Candidates from allPossibleNpcs (not already present)
  const candRealEmployees = candidateNpcs.filter((n) => n.sceneRole === 'on-shift employee' && n.isNpc !== true);
  const candNpcEmployees = candidateNpcs.filter((n) => n.sceneRole === 'on-shift employee' && n.isNpc === true);
  const candRealResidents = candidateNpcs.filter((n) => n.sceneRole === 'home resident' && n.isNpc !== true);
  const candNpcResidents = candidateNpcs.filter((n) => n.sceneRole === 'home resident' && n.isNpc === true);
  const candRealVisitors = candidateNpcs.filter((n) => n.sceneRole === 'visitor' && n.isNpc !== true);
  const candNpcVisitors = candidateNpcs.filter((n) => n.sceneRole === 'visitor' && n.isNpc === true);

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
              {/* PRESENT — from authoritative sceneParticipants */}
              {patients.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50">
                    <p className="text-[9px] font-semibold text-rose-400/80 uppercase tracking-wider">Patients</p>
                  </div>
                  {patients.map(renderNpcWrapper)}
                </>
              )}
              {inmates.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-amber-400/80 uppercase tracking-wider">Inmates</p>
                  </div>
                  {inmates.map(renderNpcWrapper)}
                </>
              )}
              {realVisitors.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50">
                    <p className="text-[9px] font-semibold text-blue-400/80 uppercase tracking-wider">Here Now</p>
                  </div>
                  {realVisitors.map(renderNpcWrapper)}
                </>
              )}
              {realEmployees.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-blue-400/80 uppercase tracking-wider">Working Here</p>
                  </div>
                  {realEmployees.map(renderNpcWrapper)}
                </>
              )}
              {realResidents.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-green-400/80 uppercase tracking-wider">Residents</p>
                  </div>
                  {realResidents.map(renderNpcWrapper)}
                </>
              )}
              {npcResidents.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-green-400/80 uppercase tracking-wider">NPC Residents</p>
                  </div>
                  {npcResidents.map(renderNpcWrapper)}
                </>
              )}
              {npcEmployees.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-blue-400/80 uppercase tracking-wider">Employees</p>
                  </div>
                  {npcEmployees.map(renderNpcWrapper)}
                </>
              )}
              {npcVisitors.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-wider">People here</p>
                  </div>
                  {npcVisitors.map(renderNpcWrapper)}
                </>
              )}

              {/* CANDIDATES — from allPossibleNpcs (not already present) */}
              {(candRealEmployees.length > 0 || candNpcEmployees.length > 0) && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-blue-400/60 uppercase tracking-wider">Available Staff</p>
                  </div>
                  {candRealEmployees.map(renderNpcWrapper)}
                  {candNpcEmployees.map(renderNpcWrapper)}
                </>
              )}
              {(candRealResidents.length > 0 || candNpcResidents.length > 0) && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-green-400/60 uppercase tracking-wider">Available Residents</p>
                  </div>
                  {candRealResidents.map(renderNpcWrapper)}
                  {candNpcResidents.map(renderNpcWrapper)}
                </>
              )}
              {(candRealVisitors.length > 0 || candNpcVisitors.length > 0) && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Available People</p>
                  </div>
                  {candRealVisitors.map(renderNpcWrapper)}
                  {candNpcVisitors.map(renderNpcWrapper)}
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