import React, { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, Home, Users, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CharacterAvatar from "@/components/chat/CharacterAvatar";

export default function MoveInPopup({
  isOpen,
  character,
  sourceHome,
  destinationHome,
  allCharacters = [],
  onApprove,
  onReject,
  onClose,
  isLoading = false,
}) {
  const [selectedResidents, setSelectedResidents] = useState(
    sourceHome?.resident_character_ids?.map(id => ({ id, selected: true })) || []
  );
  const [destinationName, setDestinationName] = useState(destinationHome?.name || "");
  const [showRename, setShowRename] = useState(false);

  if (!isOpen) return null;

  const moversCount = selectedResidents.filter(r => r.selected).length;
  const movingCharacters = allCharacters.filter(c =>
    selectedResidents.find(r => r.id === c.id && r.selected)
  );

  const handleToggleResident = (charId) => {
    setSelectedResidents(prev =>
      prev.map(r =>
        r.id === charId ? { ...r, selected: !r.selected } : r
      )
    );
  };

  const handleApprove = () => {
    const moversToMove = selectedResidents
      .filter(r => r.selected)
      .map(r => r.id);

    onApprove({
      moversToMove,
      newHomeName: destinationName,
    });
  };

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
        className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-6 space-y-4 max-h-[80vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Home className="w-5 h-5 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Move Confirmation</h3>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 flex gap-2">
          <AlertCircle className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-xs text-foreground">
            This character wants to move here, but the move will not happen until you approve it.
          </p>
        </div>

        {/* Source Home */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Moving from
          </p>
          <div className="p-3 rounded-lg bg-secondary/50 border border-border">
            <p className="text-sm font-medium text-foreground">{sourceHome?.name}</p>
          </div>
        </div>

        {/* Destination Home */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Moving to
          </p>
          {showRename ? (
            <div className="flex gap-2">
              <Input
                value={destinationName}
                onChange={e => setDestinationName(e.target.value)}
                placeholder="Enter home name"
                className="h-9 text-sm"
              />
              <Button
                size="sm"
                onClick={() => setShowRename(false)}
                className="rounded-lg"
              >
                Done
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setShowRename(true)}
              className="w-full text-left p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors"
            >
              <p className="text-sm font-medium text-foreground">{destinationName}</p>
              <p className="text-xs text-muted-foreground mt-1">Click to rename</p>
            </button>
          )}
        </div>

        {/* Who's Moving */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Who's moving? ({moversCount})
          </p>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {selectedResidents.map(resident => {
              const char = allCharacters.find(c => c.id === resident.id);
              if (!char) return null;

              return (
                <button
                  key={resident.id}
                  onClick={() => handleToggleResident(resident.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                    resident.selected
                      ? "bg-primary/10 border-primary"
                      : "bg-secondary/50 border-border"
                  }`}
                >
                  <CharacterAvatar character={char} size="sm" />
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium text-foreground">{char.name}</p>
                  </div>
                  <div
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                      resident.selected
                        ? "bg-primary border-primary"
                        : "border-border"
                    }`}
                  >
                    {resident.selected && (
                      <div className="w-2 h-2 rounded-full bg-primary-foreground" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Characters not selected will remain in {sourceHome?.name}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <Button
            onClick={onClose}
            variant="outline"
            className="flex-1 rounded-lg"
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleApprove}
            disabled={moversCount === 0 || isLoading}
            className="flex-1 rounded-lg gap-2"
          >
            {isLoading ? "Moving..." : `Approve Move (${moversCount})`}
          </Button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}