import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Trash2, RotateCcw, BookOpen } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import DeleteCharacterDialog from "@/components/home/DeleteCharacterDialog";

export default function Settings() {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState(null);

  const { data: settingsList = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: () => base44.entities.Character.list("-created_date"),
  });

  const settings = settingsList[0] || {};

  const mutation = useMutation({
    mutationFn: (data) =>
      settings.id
        ? base44.entities.UserSettings.update(settings.id, data)
        : base44.entities.UserSettings.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["userSettings"] }),
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
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    },
  });

  const moveBackMutation = useMutation({
    mutationFn: async (id) => {
      return base44.entities.Character.update(id, { status: "active" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["characters"] }),
  });

  const movedAwayChars = characters.filter(c => c.status === "moved_away");

  return (
    <div className="min-h-screen bg-background">
      {pendingDelete && (
        <DeleteCharacterDialog
          character={pendingDelete}
          onConfirm={({ cause, closeness }) => deleteMutation.mutate({ id: pendingDelete.id, cause, closeness })}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/home" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
        <h2 className="text-sm font-semibold">Settings</h2>
      </div>
      <div className="max-w-lg mx-auto px-6 py-6 space-y-8">
        <div className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Response Length</p>
          <Select value={settings.response_length || "medium"} onValueChange={v => mutation.mutate({ response_length: v })}>
            <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="short">Short</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="long">Long</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Emotional Intensity</p>
          <Select value={settings.emotional_intensity || "medium"} onValueChange={v => mutation.mutate({ emotional_intensity: v })}>
            <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-sm text-foreground">Voice Input</Label>
          <Switch
            checked={settings.voice_enabled || false}
            onCheckedChange={v => mutation.mutate({ voice_enabled: v })}
          />
        </div>
        <div className="pt-4 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Characters</p>
          <Link to="/edit-character-story">
            <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <BookOpen className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Edit Character Stories</p>
                <p className="text-xs text-muted-foreground">Update backstory, situation, family history & more</p>
              </div>
            </button>
          </Link>
        </div>
        {movedAwayChars.length > 0 && (
          <div className="space-y-4 pt-4 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Characters Away ({movedAwayChars.length})</p>
            <div className="space-y-3">
              {movedAwayChars.map(char => (
                <div key={char.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
                  <CharacterAvatar character={char} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{char.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{char.personality_summary?.split(".")[0]}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => moveBackMutation.mutate(char.id)}
                      disabled={moveBackMutation.isPending}
                      className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                      title="Move back"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setPendingDelete(char)}
                      className="p-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="pb-28" />
      <BottomNav />
    </div>
  );
}