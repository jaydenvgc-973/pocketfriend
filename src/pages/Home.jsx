import React, { useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { Plus, Users, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import CharacterCard from "@/components/home/CharacterCard";
import { DEFAULT_CHARACTER_DATA, buildSystemPrompt } from "@/lib/defaultCharacter";

export default function Home() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: settings = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const { data: characters = [], isLoading } = useQuery({
    queryKey: ["characters"],
    queryFn: () => base44.entities.Character.list("-created_date"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Character.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["characters"] }),
  });

  useEffect(() => {
    const defaultChar = characters.find(c => c.is_default);
    if (!defaultChar) return;
    if (!defaultChar.family_history?.includes("Marisol")) {
      const updated = {
        ...DEFAULT_CHARACTER_DATA,
        name: defaultChar.name,
        avatar_url: defaultChar.avatar_url || undefined,
        reference_image_urls: defaultChar.reference_image_urls || undefined,
        emotional_state: defaultChar.emotional_state || "calm",
      };
      updated.system_prompt = buildSystemPrompt(updated);
      base44.entities.Character.update(defaultChar.id, updated).then(() => {
        queryClient.invalidateQueries({ queryKey: ["characters"] });
      });
    }
  }, [characters]);

  useEffect(() => {
    if (!isLoading && settings.length === 0) {
      navigate("/");
    }
  }, [isLoading, settings]);

  const defaultChar = characters.find(c => c.is_default);
  const customChars = characters.filter(c => !c.is_default);
  const canCreate = customChars.length < 4;

  return (
    <div className="min-h-screen bg-background">
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

      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        {defaultChar && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Your character</p>
            <CharacterCard character={defaultChar} />
          </div>
        )}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Custom characters {customChars.length}/4</p>
            {canCreate && (
              <Link to="/create">
                <motion.button whileTap={{ scale: 0.95 }} className="flex items-center gap-1.5 text-xs text-primary font-medium">
                  <Plus className="w-3.5 h-3.5" /> Create
                </motion.button>
              </Link>
            )}
          </div>
          {customChars.length === 0 ? (
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
              {customChars.map(c => (
                <CharacterCard key={c.id} character={c} onDelete={(id) => deleteMutation.mutate(id)} />
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
    </div>
  );
}