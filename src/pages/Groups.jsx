import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";
import CharacterSelector from "@/components/groupchat/CharacterSelector";

export default function Groups() {
  const navigate = useNavigate();
  const [showCharacterSelector, setShowCharacterSelector] = useState(false);

  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => base44.entities.Conversation.list(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: () => base44.entities.Character.list("-created_date"),
  });

  const activeCharacters = characters.filter(c => c.status === "active" || c.status === "moved_away" || !c.status);

  const createGroupMutation = async (characterIds) => {
    const selectedCharacters = characters.filter(c => characterIds.includes(c.id));
    const characterNames = selectedCharacters.map(c => c.name).join(", ");
    
    const conversation = await base44.entities.Conversation.create({
      title: characterNames,
      type: "group",
      character_ids: characterIds,
    });
    setShowCharacterSelector(false);
    navigate(`/group-chat/${conversation.id}`);
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/home" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
          <h2 className="text-sm font-semibold">Groups</h2>
        </div>
        <button onClick={() => setShowCharacterSelector(true)} className="text-muted-foreground hover:text-foreground">
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="max-w-lg mx-auto w-full px-4 py-4 space-y-2">
          {conversations.length === 0 ? (
            <div className="flex items-center justify-center h-96">
              <p className="text-muted-foreground text-sm">No group conversations yet</p>
            </div>
          ) : (
            conversations.map(conv => (
              <motion.button
                key={conv.id}
                onClick={() => navigate(`/group-chat/${conv.id}`)}
                whileTap={{ scale: 0.98 }}
                className="w-full text-left border border-border rounded-xl p-4 hover:border-primary/30 transition-colors bg-card/50"
              >
                <p className="text-sm font-medium text-foreground">{conv.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{conv.character_ids?.length || 0} participants</p>
              </motion.button>
            ))
          )}
        </div>
      </ScrollArea>

      <div className="pb-[60px]" />
      <BottomNav />

      <AnimatePresence>
        {showCharacterSelector && (
          <CharacterSelector
            characters={activeCharacters}
            onConfirm={createGroupMutation}
            onCancel={() => setShowCharacterSelector(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}