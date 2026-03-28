import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { Plus, Users, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import CharacterCard from "@/components/home/CharacterCard";
import DeleteCharacterDialog from "@/components/home/DeleteCharacterDialog";
import CharacterInteractionSimulator from "@/components/home/CharacterInteractionSimulator";
import BottomNav from "@/components/BottomNav";
import DailyAchievementReminder from "@/components/home/DailyAchievementReminder";
import { DEFAULT_CHARACTER_DATA, buildSystemPrompt } from "@/lib/defaultCharacter";

export default function Home() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState(null); // character being removed

  const { data: settings = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [], isLoading } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ created_by: currentUser.email }, "-created_date")
      : [],
    enabled: !!currentUser?.email,
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id, cause, closeness }) => {
      const activeOthers = characters.filter(c => c.id !== id && c.status !== "deleted");
      const departed = characters.find(c => c.id === id);
      if (departed) {
        await Promise.all(activeOthers.map(c =>
          base44.entities.Character.update(c.id, {
            departed_characters: [
              ...(c.departed_characters || []),
              { name: departed.name, cause, relationship_closeness: closeness }
            ]
          })
        ));
      }
      return base44.entities.Character.delete(id);
    },
    onSuccess: () => {
      setPendingDelete(null);
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    },
  });

  const moveAwayMutation = useMutation({
    mutationFn: async (id) => {
      const activeOthers = characters.filter(c => c.id !== id && c.status !== "deleted" && c.status !== "moved_away");
      const mover = characters.find(c => c.id === id);
      if (mover) {
        await Promise.all(activeOthers.map(c =>
          base44.entities.Character.update(c.id, {
            departed_characters: [
              ...(c.departed_characters || []),
              { name: mover.name, cause: "moved_away", relationship_closeness: "acquaintance" }
            ]
          })
        ));
      }
      return base44.entities.Character.update(id, { status: "moved_away" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] }),
  });

  const moveBackMutation = useMutation({
    mutationFn: async (id) => {
      return base44.entities.Character.update(id, { status: "active" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] }),
  });

  useEffect(() => {
    const defaultChar = characters.find(c => c.is_default);
    if (!defaultChar) return;
    // Only do a one-time migration if the character is missing core data
    // Never overwrite an already-complete character
    if (defaultChar.family_history && defaultChar.system_prompt) return;
    const updated = {
      ...DEFAULT_CHARACTER_DATA,
      name: defaultChar.name,
      avatar_url: defaultChar.avatar_url || undefined,
      reference_image_urls: defaultChar.reference_image_urls || undefined,
      emotional_state: defaultChar.emotional_state || "calm",
    };
    updated.system_prompt = buildSystemPrompt(updated);
    base44.entities.Character.update(defaultChar.id, updated).then(() => {
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    });
  }, [characters, currentUser?.email]);

  // Sync unread counts on page load — CRITICAL: force sync before any other data fetch
  useEffect(() => {
    if (!characters || characters.length === 0) return;
    
    // Sync unread counts for all characters in parallel (blocks on completion)
    const syncPromises = characters.map(char =>
      base44.functions.invoke('syncUnreadCounts', { characterId: char.id })
        .then(res => {
          console.log(`[Unread Sync COMPLETE] ${char.name}: actual unread = ${res?.data?.diagnostics?.actual_unread_count}, fixed = ${res?.data?.diagnostics?.invalid_unread_fixed}`);
          // FORCE invalidate and refetch
          return queryClient.invalidateQueries({ 
            queryKey: ['conversations', char.id],
            exact: false
          });
        })
        .catch(err => {
          console.error(`[Unread Sync] Failed for ${char.name}:`, err);
          return null;
        })
    );

    // Wait for all syncs to complete, then refetch
    Promise.all(syncPromises).then(() => {
      console.log('[Unread Sync] All syncs complete, invalidating all conversation queries');
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    });
  }, [characters.length, queryClient]);

  useEffect(() => {
    if (!isLoading && settings.length === 0) {
      navigate("/");
    }
  }, [isLoading, settings]);

  const defaultChar = characters.find(c => c.is_default);
  const customChars = characters.filter(c => !c.is_default && c.status !== "deleted");
  const activeCustomChars = customChars.filter(c => c.status === "active" || !c.status);
  const movedAwayChars = customChars.filter(c => c.status === "moved_away");
  // Slot opens when a character moves away (they still exist) or is deleted
  const canCreate = activeCustomChars.length < 10;
  const canMoveBack = movedAwayChars.length > 0 && activeCustomChars.length < 10;

  return (
    <div className="min-h-screen bg-background">
      <AnimatePresence>
        {pendingDelete && (
          <DeleteCharacterDialog
            character={pendingDelete}
            onConfirm={({ cause, closeness }) => deleteMutation.mutate({ id: pendingDelete.id, cause, closeness })}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </AnimatePresence>
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-border px-6 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">Pocketfriend</h1>
          <div className="flex items-center gap-2">
            <Link to="/groups">
              <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground hover:text-foreground">
                <Users className="w-5 h-5" />
              </Button>
            </Link>
            <Link to="/settings">
              <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground hover:text-foreground">
                <Settings className="w-5 h-5" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6 pb-32 space-y-6">
        {defaultChar && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Your character</p>
            <CharacterCard character={defaultChar} />
          </div>
        )}
        {(defaultChar && activeCustomChars.length >= 1) || activeCustomChars.length >= 2 ? (
          <CharacterInteractionSimulator characters={defaultChar ? [defaultChar, ...activeCustomChars] : activeCustomChars} />
        ) : null}
        
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Custom characters {activeCustomChars.length}/10</p>
            {canCreate && (
              <Link to="/create">
                <motion.button whileTap={{ scale: 0.95 }} className="flex items-center gap-1.5 text-xs text-primary font-medium">
                  <Plus className="w-3.5 h-3.5" /> Create
                </motion.button>
              </Link>
            )}
          </div>
          {activeCustomChars.length === 0 && movedAwayChars.length === 0 ? (
            <Link to="/create">
              <motion.div whileTap={{ scale: 0.98 }} className="border-2 border-dashed border-border rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:border-primary/30 transition-colors">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <Plus className="w-5 h-5 text-primary" />
                </div>
                <p className="text-sm font-medium text-foreground">Create a character</p>
                <p className="text-xs text-muted-foreground mt-1">Build someone with their own story</p>
              </motion.div>
            </Link>
          ) : (
            <div className="grid gap-3">
              {activeCustomChars.map(c => (
                <CharacterCard key={c.id} character={c}
                  onDelete={(id) => setPendingDelete(characters.find(ch => ch.id === id))}
                  onMoveAway={(id) => moveAwayMutation.mutate(id)}
                />
              ))}
              {movedAwayChars.map(c => (
                <CharacterCard key={c.id} character={c} onMoveAway={() => canMoveBack && moveBackMutation.mutate(c.id)} />
              ))}
              {canCreate && (
                <Link to="/create">
                  <motion.div whileTap={{ scale: 0.98 }} className="border-2 border-dashed border-border rounded-2xl p-6 flex items-center justify-center cursor-pointer hover:border-primary/30 transition-colors">
                    <Plus className="w-4 h-4 text-muted-foreground mr-2" />
                    <span className="text-sm text-muted-foreground">Add another</span>
                  </motion.div>
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
      <DailyAchievementReminder />
      <BottomNav />
    </div>
  );
}