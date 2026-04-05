import React, { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, Home, AlertCircle, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CharacterAvatar from "@/components/chat/CharacterAvatar";

export default function MoveInPopup({
  isOpen,
  character,
  sourceHome,        // LocationReference of the character's current home
  destinationHome,   // LocationReference of the home being moved into
  allCharacters = [],
  broughtCharacters = [],
  onApprove,
  onClose,
  isLoading = false,
}) {
  // Build full candidate list from the SOURCE home:
  // - Active characters who live there
  // - NPC / family members (resident_family_members) listed at source home
  // Also include any brought characters not already in the source home
  const candidates = useMemo(() => {
    const seen = new Set();
    const list = [];

    // 1. Active characters from source home + brought characters
    const realIds = new Set();
    (sourceHome?.resident_character_ids || []).forEach(id => realIds.add(id));
    broughtCharacters.forEach(c => realIds.add(c.id));
    if (character?.id) realIds.add(character.id);

    realIds.forEach(id => {
      if (seen.has(id)) return;
      seen.add(id);
      const char = allCharacters.find(c => c.id === id);
      if (char) list.push({ id, name: char.name, isNpc: false, char });
    });

    // 2. NPC / family members living at source home
    (sourceHome?.resident_family_members || []).forEach((fm, idx) => {
      if (!fm.name) return;
      const npcId = `npc_fm_${fm.name.replace(/\s+/g, "_")}`;
      if (seen.has(npcId)) return;
      seen.add(npcId);
      list.push({
        id: npcId,
        name: fm.name,
        role: fm.relationship_type || "Family",
        isNpc: true,
        fmData: fm,
      });
    });

    return list;
  }, [sourceHome?.id, JSON.stringify(sourceHome?.resident_family_members), broughtCharacters.map(c=>c.id).join(","), character?.id]);

  const [selectedIds, setSelectedIds] = useState(() => new Set(candidates.map(c => c.id)));
  const [destinationName, setDestinationName] = useState(destinationHome?.name || "");
  const [showRename, setShowRename] = useState(false);

  // Sync when popup opens with different data
  useEffect(() => {
    setSelectedIds(new Set(candidates.map(c => c.id)));
  }, [candidates.map(c => c.id).join(",")]);

  useEffect(() => {
    setDestinationName(destinationHome?.name || "");
  }, [destinationHome?.id]);

  if (!isOpen) return null;

  const moversCount = selectedIds.size;

  const toggleCandidate = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleApprove = () => {
    const realMovers = candidates
      .filter(c => !c.isNpc && selectedIds.has(c.id))
      .map(c => c.id);
    const npcMovers = candidates
      .filter(c => c.isNpc && selectedIds.has(c.id))
      .map(c => ({ name: c.name, relationship_type: c.fmData?.relationship_type, source_character_id: c.fmData?.source_character_id, isNPC: c.fmData?.isNPC }));

    onApprove({ moversToMove: realMovers, npcMovers, newHomeName: destinationName });
  };

  // The "moving from" label — use source home name if available, fall back to character's known home
  const sourceLabel = sourceHome?.name
    || (character?.name ? `${character.name}'s current home` : "Current residence");

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Home className="w-5 h-5 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Move Confirmation</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 flex gap-2">
          <AlertCircle className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-xs text-foreground">
            Select who moves to the new home. Those not selected will remain at <strong>{sourceLabel}</strong>.
          </p>
        </div>

        {/* From → To */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Moving from</p>
            <div className="p-3 rounded-lg bg-secondary/50 border border-border">
              <p className="text-sm font-medium text-foreground">{sourceLabel}</p>
              {sourceHome && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {candidates.length} resident{candidates.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Moving to</p>
            {showRename ? (
              <div className="flex gap-1.5">
                <Input
                  value={destinationName}
                  onChange={e => setDestinationName(e.target.value)}
                  placeholder="Home name"
                  className="h-9 text-sm"
                />
                <Button size="sm" onClick={() => setShowRename(false)} className="rounded-lg px-3">✓</Button>
              </div>
            ) : (
              <button
                onClick={() => setShowRename(true)}
                className="w-full text-left p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors"
              >
                <p className="text-sm font-medium text-foreground">{destinationName || "New home"}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Tap to rename</p>
              </button>
            )}
          </div>
        </div>

        {/* Who's moving */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Who's moving? ({moversCount} of {candidates.length})
          </p>

          {candidates.length === 0 ? (
            <div className="py-4 text-center">
              <p className="text-xs text-muted-foreground">No residents found at {sourceLabel}.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Only the active character will move.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {candidates.map(candidate => {
                const isSelected = selectedIds.has(candidate.id);
                return (
                  <button
                    key={candidate.id}
                    onClick={() => toggleCandidate(candidate.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                      isSelected ? "bg-primary/10 border-primary" : "bg-secondary/50 border-border"
                    }`}
                  >
                    {candidate.isNpc ? (
                      <div className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center flex-shrink-0">
                        <User className="w-4 h-4 text-muted-foreground" />
                      </div>
                    ) : (
                      <CharacterAvatar character={candidate.char} size="sm" />
                    )}
                    <div className="flex-1 text-left">
                      <p className="text-sm font-medium text-foreground">{candidate.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {candidate.role && (
                          <span className="text-[10px] text-muted-foreground capitalize">{candidate.role}</span>
                        )}
                        {candidate.isNpc && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">NPC</span>
                        )}
                      </div>
                    </div>
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                      isSelected ? "bg-primary border-primary" : "border-border"
                    }`}>
                      {isSelected && <div className="w-2 h-2 rounded-full bg-primary-foreground" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button onClick={onClose} variant="outline" className="flex-1 rounded-lg" disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleApprove}
            disabled={moversCount === 0 || isLoading}
            className="flex-1 rounded-lg"
          >
            {isLoading ? "Moving..." : `Approve Move (${moversCount})`}
          </Button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}