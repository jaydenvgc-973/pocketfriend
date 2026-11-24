import React from "react";
import { Users, ChevronDown, UserPlus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import DwellingUnitGroups, { splitByDwellingUnit } from "@/components/scene/DwellingUnitGroups";

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
  residentialUnits = [],
  locationCategory = "home",
}) {
  // Present people from authoritative sceneParticipants (excluding the user)
  const present = presentParticipants.filter((n) => !n.isUser);

  // Multidwelling properties: present characters are organized by the dwelling
  // assignments already stored on the location (Places). Only people who are
  // actually here are grouped — an absent resident is never listed.
  const { groups: unitGroups, order: unitOrder, unassigned: presentWithoutUnit } = splitByDwellingUnit(present, residentialUnits);

  // THE DIRECTORY IS THE WHOLE PROPERTY. People listed in another room — a patient in
  // their room, a resident in another apartment, an inmate in their cell — are grouped
  // by the same existing assignment as the people in this room, so the user can see who
  // is where without opening every room. Being listed here is not participation: the
  // purple highlight still means selected for the current scene.
  const { groups: candidateUnitGroups, unassigned: candidatesWithoutSpace } = splitByDwellingUnit(candidateNpcs, residentialUnits);
  const spaceGroups = {};
  const spaceOrder = [...unitOrder];
  Object.keys(candidateUnitGroups).forEach((name) => {
    if (!spaceOrder.includes(name)) spaceOrder.push(name);
    spaceGroups[name] = [...candidateUnitGroups[name]];
  });
  Object.entries(unitGroups).forEach(([name, list]) => {
    spaceGroups[name] = [...list, ...(spaceGroups[name] || [])];
  });
  // Inside its own room heading a person's room is already stated, so it is not repeated
  // under their name.
  const spaceGroupsForRender = Object.fromEntries(
    Object.entries(spaceGroups).map(([name, list]) => [name, list.map((p) => ({ ...p, unit_name: null }))])
  );

  const patients = presentWithoutUnit.filter((n) => n.sceneRole === 'patient');
  const inmates = presentWithoutUnit.filter((n) => n.sceneRole === 'inmate');
  const realEmployees = presentWithoutUnit.filter((n) => n.sceneRole === 'on-shift employee' && n.isNpc !== true);
  const npcEmployees = presentWithoutUnit.filter((n) => n.sceneRole === 'on-shift employee' && n.isNpc === true);
  const realResidents = presentWithoutUnit.filter((n) => n.sceneRole === 'home resident' && n.isNpc !== true);
  const npcResidents = presentWithoutUnit.filter((n) => n.sceneRole === 'home resident' && n.isNpc === true);
  const realVisitors = presentWithoutUnit.filter((n) => n.sceneRole === 'visitor' && n.isNpc !== true);
  const npcVisitors = presentWithoutUnit.filter((n) => n.sceneRole === 'visitor' && n.isNpc === true);

  // Candidates from allPossibleNpcs (not already present) that are not already listed
  // under their own room above.
  const candRealEmployees = candidatesWithoutSpace.filter((n) => n.sceneRole === 'on-shift employee' && n.isNpc !== true);
  const candNpcEmployees = candidatesWithoutSpace.filter((n) => n.sceneRole === 'on-shift employee' && n.isNpc === true);
  const candRealResidents = candidatesWithoutSpace.filter((n) => n.sceneRole === 'home resident' && n.isNpc !== true);
  const candNpcResidents = candidatesWithoutSpace.filter((n) => n.sceneRole === 'home resident' && n.isNpc === true);
  const candRealVisitors = candidatesWithoutSpace.filter((n) => n.sceneRole === 'visitor' && n.isNpc !== true);
  const candNpcVisitors = candidatesWithoutSpace.filter((n) => n.sceneRole === 'visitor' && n.isNpc === true);
  // The facility's own population is offered as people, never as staff.
  const candInmates = candidatesWithoutSpace.filter((n) => n.sceneRole === 'inmate');
  // Someone receiving care here stays in the directory whether or not a room is assigned
  // to them. A patient is never dropped from the list for lacking a room.
  const candPatients = candidatesWithoutSpace.filter((n) => n.sceneRole === 'patient');

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
              {/* PRESENT — grouped by the property's existing dwelling assignments */}
              <DwellingUnitGroups
                groups={spaceGroupsForRender}
                order={spaceOrder}
                locationCategory={locationCategory}
                renderParticipant={renderNpcWrapper}
              />

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
              {candPatients.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-rose-400/60 uppercase tracking-wider">Patients</p>
                  </div>
                  {candPatients.map(renderNpcWrapper)}
                </>
              )}
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
              {(candRealVisitors.length > 0 || candNpcVisitors.length > 0 || candInmates.length > 0) && (
                <>
                  <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                    <p className="text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Available People</p>
                  </div>
                  {candInmates.map(renderNpcWrapper)}
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