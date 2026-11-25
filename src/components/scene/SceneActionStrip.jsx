import React, { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ArrestControl, NextSceneControl } from "@/components/scene/SceneStripTransitionControls";
import {
  DIRECTED_SCENE_ACTIONS,
  stripActions,
  buildActivitySections,
  generalStripKey,
  GENERAL_STRIP_ORDER,
  LIFE_NEED_LABELS,
} from "@/lib/sceneStripConfig";

// The three activity folders, with their established colours. Each control is always in
// reach: opening one only reveals that folder's own activities in the same horizontal strip.
const CATEGORY_FOLDERS = [
  {
    key: "place",
    label: "This Location",
    emoji: "📍",
    openClass: "bg-[#2563EB] border-[#2563EB] text-white",
    closedClass: "bg-[#2563EB]/10 border-[#2563EB]/40 text-[#2563EB]",
  },
  {
    key: "needs",
    label: "Life Needs",
    emoji: "❤️",
    openClass: "bg-[#EAB308] border-[#EAB308] text-[#171717]",
    closedClass: "bg-[#EAB308]/10 border-[#EAB308]/40 text-[#EAB308]",
  },
  {
    key: "general",
    label: "General",
    emoji: "⚙️",
    openClass: "bg-[#16A34A] border-[#16A34A] text-white",
    closedClass: "bg-[#16A34A]/10 border-[#16A34A]/40 text-[#16A34A]",
  },
];

/**
 * SceneActionStrip — the scene's activity strip.
 *
 * ORGANIZATION (the only thing this file decides):
 *   1. This Location — the venue's own activities, whatever their Life Need effect.
 *   2. Life Needs    — the everyday activities grouped under the eight established needs.
 *   3. General       — the general interactions in their established order, with Arrest.
 * Each group is a folder card inside that same horizontal strip: selecting it reveals its
 * activities inline, selecting it again hides them, and opening another folder closes it.
 * Next Scene is pinned at the right end of the strip, outside the folders. Nothing is
 * removed: every activity
 * appears exactly once, and no effect, price, availability rule or pipeline changes here —
 * the buttons call the same handlers Scene always passed them.
 */
export default function SceneActionStrip({
  actions,
  traitCrimeActions,
  courtCase,
  getCourtActionAuthority,
  courtActors,
  activeZone,
  recipientTargets,
  observeMode,
  observeActors,
  activityActors,
  eligibleForAction,
  isGovernmentActionId,
  handleGovernmentAction,
  startCourtAction,
  CRIME_ACTIVITY_IDS,
  handleCrimeAction,
  setActorAction,
  setRecipientAction,
  handleZoneChange,
  setActiveZone,
  handleObserveAction,
  handleAction,
  directedAvailable,
  handleDirectedSelect,
  directedPickableTargets,
  governmentVenueType,
  setShowVenueSetup,
  cityHallPlan,
  setShowChangeClothesModal,
  characterInviter,
  setShowInviteModal,
  location,
  arrestTargets,
  setArrestPicker,
  setShowNextScene,
  actionCooldown,
}) {
  const list = stripActions(courtCase
    ? actions.filter((a) => !getCourtActionAuthority(a.id) || courtActors(courtCase, a.id).length > 0)
    : [...actions, ...traitCrimeActions]);

  const { place, needs, general } = buildActivitySections(list);
  const generalByKey = new Map(general.map((a) => [generalStripKey(a), a]));

  const generalItems = GENERAL_STRIP_ORDER.flatMap((key) => {
    const directed = DIRECTED_SCENE_ACTIONS.find((d) => d.id === key);
    if (directed) return directedPickableTargets.length > 0 ? [{ directed }] : [];
    const action = generalByKey.get(key);
    return action ? [action] : [];
  });

  // One folder at a time. Opening a folder closes the previous one, so switching folders
  // never means scrolling past another folder's activities. `null` means untouched, which
  // shows the venue's own activities first.
  const stripRef = useRef(null);
  const [openFolder, setOpenFolder] = useState(null);
  const defaultFolder = place.length > 0 ? "place" : needs.length > 0 ? "needs" : "general";
  const activeFolder = openFolder === null ? defaultFolder : openFolder;
  const folderIsOpen = (key) => activeFolder === key;
  const toggleFolder = (key) => {
    setOpenFolder(folderIsOpen(key) ? "" : key);
    stripRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  };

  const renderFolder = (folder) => {
    const open = folderIsOpen(folder.key);
    return (
      <button
        key={`folder_${folder.key}`}
        onClick={() => toggleFolder(folder.key)}
        aria-expanded={open}
        title={open ? `Hide ${folder.label} activities` : `Show ${folder.label} activities`}
        className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all text-center flex-shrink-0 snap-center ${open ? `${folder.openClass} border-2` : folder.closedClass}`}
      >
        <span className="text-base leading-none">{folder.emoji}</span>
        <span className="flex items-center gap-0.5 text-[9px] font-bold leading-tight whitespace-nowrap">
          {folder.label}
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
    );
  };

  const renderItem = (action) => {
    // Flirt With / Kiss / Argue With / Fight With / Moonwink — a moment between two chosen
    // people. Same selector Scene has always used for them.
    if (action.directed) {
      const directed = action.directed;
      const canPair = directedAvailable(directed);
      // An adults-only activity stays reachable so its picker can open; whether the
      // interaction can actually happen is decided by who is here, never by graying the
      // button out or by offering someone from outside the scene.
      const blocked = actionCooldown || (!canPair && !directed.adults_only);
      return (
        <button key={directed.id} onClick={() => handleDirectedSelect(directed)} disabled={blocked} title={canPair ? `${directed.label} — choose who` : directed.adults_only ? "Only for adults — two adults need to be here" : "No one else is here to choose"} className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all text-center flex-shrink-0 snap-center ${blocked ? "opacity-40 cursor-not-allowed" : "bg-secondary border-border hover:border-primary/30"}`}>
          <span className="text-base leading-none">{directed.emoji}</span>
          <span className="text-[9px] text-foreground font-medium leading-tight whitespace-nowrap">{directed.label}</span>
        </button>
      );
    }

    const needsZone = action.suggested_zone_name && activeZone !== action.suggested_zone_name;
    // An activity that acts on a chosen character needs someone here to involve.
    const needsCharacter = action.requires_selected_character === true && recipientTargets.length === 0;
    // An adults-only activity needs an adult here to take part.
    const needsAdult = action.adults_only === true && observeMode && eligibleForAction(observeActors, action).length === 0;
    const isDisabled = action.disabled || actionCooldown || needsCharacter || needsAdult;
    return (
      <button key={action.scene_instance_id || action.id} onClick={() => { if (isDisabled) return; if (isGovernmentActionId(action.id)) { handleGovernmentAction(action); return; } if (courtCase && getCourtActionAuthority(action.id)) { startCourtAction(action); return; } if (CRIME_ACTIVITY_IDS.includes(action.id)) { const pool = observeMode ? observeActors : activityActors; if (pool.length > 1) { setActorAction({ action, mode: "activity" }); return; } handleCrimeAction(action, pool.length === 1 ? [pool[0]] : null); return; } if (action.requires_selected_character) { setRecipientAction(action); return; } if (action.requires_actor && !observeMode && activityActors.length > 0) { if (needsZone) handleZoneChange(action.suggested_zone_name); setActorAction({ action, mode: "activity" }); return; } if (observeMode) { if (needsZone) setActiveZone(action.suggested_zone_name); handleObserveAction(action); return; } if (needsZone) { handleZoneChange(action.suggested_zone_name); setTimeout(() => handleAction(action), 400); } else handleAction(action); }} disabled={isDisabled} title={action.disabledReason || (needsAdult ? "Only for adults — no adult is here" : needsCharacter ? "No one here to involve" : action.requires_selected_character ? `${action.label} — choose who` : needsZone ? `Go to ${action.suggested_zone_name}` : undefined)} className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all text-center flex-shrink-0 snap-center ${isDisabled ? "opacity-40 cursor-not-allowed" : action.type === "negative" ? "bg-destructive/10 border-destructive/30 hover:bg-destructive/20" : action.cost > 0 ? "bg-green-500/10 border-green-500/30 hover:bg-green-500/20" : needsZone ? "bg-primary/5 border-primary/20 hover:border-primary/40" : "bg-secondary border-border hover:border-primary/30"}`}>
        <span className="text-base leading-none">{action.emoji}</span>
        <span className="text-[9px] text-foreground font-medium leading-tight whitespace-nowrap">{action.label}</span>
        {action.need_tag && <span className="text-[8px] text-muted-foreground/70 leading-none">{LIFE_NEED_LABELS[action.need_tag]}</span>}
        {action.cost > 0 && <span className="text-[9px] text-green-500">${action.cost}</span>}{action.no_staff_warning && <span className="text-[8px] text-amber-500 leading-tight">no staff</span>}
      </button>
    );
  };

  return (
    <div className="px-3 py-2 border-t border-border bg-card/50 flex-shrink-0 overflow-hidden">
      {/* ONE horizontal strip: the folder cards sit inside it beside the activity cards they
          open, and Next Scene stays pinned at its right end. */}
      <div className="flex items-center gap-1.5">
        <div ref={stripRef} className="flex gap-1.5 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-hide flex-1 min-w-0">
          {/* The setup is always reachable: cancelling it only leaves the venue unpopulated. */}
          {governmentVenueType && !courtCase && !cityHallPlan && (
            <button onClick={() => setShowVenueSetup(true)} className="flex flex-col items-center gap-1 p-2 rounded-xl border transition-all text-center flex-shrink-0 snap-center bg-primary/10 border-primary/40 hover:border-primary/60" title={governmentVenueType === "courthouse" ? "Set up the court case and who is in the room" : "Set up what you are here for and who is with you"}>
              <span className="text-base leading-none">{governmentVenueType === "courthouse" ? "⚖️" : "🏛️"}</span>
              <span className="text-[9px] text-primary font-medium leading-tight whitespace-nowrap">{governmentVenueType === "courthouse" ? "Begin Court Case" : "Begin City Hall Visit"}</span>
            </button>
          )}
          <button onClick={() => setShowChangeClothesModal(true)} disabled={actionCooldown} className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all text-center flex-shrink-0 snap-center ${actionCooldown ? "opacity-40 cursor-not-allowed" : "bg-secondary border-border hover:border-primary/30"}`} title={observeMode ? "Change their clothes" : "Change your outfit"}><span className="text-base leading-none">👕</span><span className="text-[9px] text-foreground font-medium leading-tight whitespace-nowrap">Change Clothes</span></button>

          {/* The three folders, as cards in this same strip. */}
          {CATEGORY_FOLDERS.map(renderFolder)}

          {/* Only the open folder's own activities appear, inline, in the established order
              and with the established card layout. */}
          {folderIsOpen("place") && place.map(renderItem)}
          {folderIsOpen("needs") && needs.map(({ action, need }) => renderItem({ ...action, need_tag: need }))}
          {folderIsOpen("general") && generalItems.map(renderItem)}

          {(() => {
            if (!activeFolder) return null;
            const count = activeFolder === "place" ? place.length
              : activeFolder === "needs" ? needs.length
                : generalItems.length + (arrestTargets.length > 0 ? 1 : 0);
            if (count > 0) return null;
            const folder = CATEGORY_FOLDERS.find((f) => f.key === activeFolder);
            return (
              <span className="flex items-center px-2 text-[9px] text-muted-foreground/60 whitespace-nowrap flex-shrink-0">
                No {folder.label} activities here
              </span>
            );
          })()}

          {characterInviter && (
            <button onClick={() => setShowInviteModal(true)} title={`${characterInviter.name} invites someone to ${location.name}`} className="flex flex-col items-center gap-1 p-2 rounded-xl border transition-all text-center flex-shrink-0 snap-center bg-secondary border-border hover:border-primary/30">
              <span className="text-base leading-none">🙋</span>
              <span className="text-[9px] text-foreground font-medium leading-tight whitespace-nowrap">Invite Character</span>
            </button>
          )}
          {/* Arrest is a general activity, so it lives in that folder. Next Scene is the scene
              control pinned at the right of the strip, outside every folder. */}
          {folderIsOpen("general") && (
            <ArrestControl
              onArrest={() => setArrestPicker({ id: "arrest", label: "Arrest", emoji: "🚔" })}
              arrestDisabled={arrestTargets.length === 0 || actionCooldown}
            />
          )}
        </div>
        <NextSceneControl onNextScene={() => setShowNextScene(true)} />
      </div>
    </div>
  );
}