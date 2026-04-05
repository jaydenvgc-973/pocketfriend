import React, { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { X, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import CharacterAvatar from "@/components/chat/CharacterAvatar";

export default function GuestSelectorModal({ location, onSelect, onClose }) {
  const [selectedGuest, setSelectedGuest] = useState(null);

  // Fetch active characters
  const { data: characters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: async () => {
      const user = await base44.auth.me();
      if (!user?.email) return [];
      return base44.entities.Character.filter({
        created_by: user.email,
        status: "active",
      }, "-created_date");
    },
  });

  // Build guest list: active characters + their NPC friends + their NPC family
  const guestList = useMemo(() => {
    const guests = [];
    const seen = new Set();

    // Add all active characters
    characters.forEach(char => {
      if (!seen.has(char.id)) {
        guests.push({
          id: char.id,
          name: char.name,
          type: "character",
          avatar_url: char.avatar_url,
          character: char,
        });
        seen.add(char.id);
      }

      // Add this character's NPC fictional relationships (friends)
      (char.fictional_relationships || []).forEach(rel => {
        const npcKey = `npc_friend_${char.id}_${rel.person_name}`;
        if (!seen.has(npcKey) && rel.person_name) {
          guests.push({
            id: npcKey,
            name: rel.person_name,
            type: "npc_friend",
            avatar_url: rel.avatar_url || null,
            sourceCharacterId: char.id,
            sourceCharacterName: char.name,
          });
          seen.add(npcKey);
        }
      });

      // Add this character's NPC family members
      (char.resident_family_members || []).forEach(member => {
        const familyKey = `npc_family_${char.id}_${member.name}`;
        if (!seen.has(familyKey) && member.name) {
          guests.push({
            id: familyKey,
            name: member.name,
            type: "npc_family",
            avatar_url: null,
            sourceCharacterId: char.id,
            sourceCharacterName: char.name,
            relationshipType: member.relationship_type,
          });
          seen.add(familyKey);
        }
      });
    });

    return guests;
  }, [characters]);

  const handleSelect = () => {
    if (selectedGuest) {
      onSelect(selectedGuest);
    }
  };

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 p-4">
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground">Invite a Guest</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Choose from active characters and their connections
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Guest list */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {guestList.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                No guests available to invite
              </p>
            ) : (
              guestList.map((guest) => (
                <motion.button
                  key={guest.id}
                  onClick={() => setSelectedGuest(guest)}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    selectedGuest?.id === guest.id
                      ? "bg-primary/10 border-primary/40"
                      : "bg-secondary/30 border-border hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {guest.avatar_url ? (
                      <img
                        src={guest.avatar_url}
                        alt={guest.name}
                        className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-semibold text-primary">
                          {guest.name[0]}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {guest.name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {guest.type === "character" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                            Active Character
                          </span>
                        )}
                        {guest.type === "npc_friend" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-medium">
                            Friend of {guest.sourceCharacterName}
                          </span>
                        )}
                        {guest.type === "npc_family" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
                            {guest.relationshipType} of {guest.sourceCharacterName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.button>
              ))
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-2 border-t border-border">
            <Button
              onClick={onClose}
              variant="outline"
              size="sm"
              className="flex-1 rounded-lg"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSelect}
              disabled={!selectedGuest}
              size="sm"
              className="flex-1 rounded-lg gap-2"
            >
              <Users className="w-3.5 h-3.5" />
              Invite Guest
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}